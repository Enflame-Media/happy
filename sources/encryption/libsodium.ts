import { getRandomBytes } from 'expo-crypto';
import sodium from '@/encryption/libsodium.lib';
import { AppError, ErrorCodes } from '@/utils/errors';

/**
 * Module-level counter for hybrid nonce generation.
 * Combined with random bytes to eliminate any theoretical nonce collision risk.
 */
let nonceCounter = 0n;
const MAX_UINT64 = (2n ** 64n) - 1n;

/**
 * Generate a hybrid nonce combining random bytes with a monotonic counter.
 * This eliminates theoretical collision risk in high-throughput scenarios
 * while maintaining cryptographic randomness.
 *
 * Structure: [random bytes][8-byte counter (big-endian)]
 * - 24-byte nonce (NaCl box/secretbox): 16 random + 8 counter
 * - 12-byte nonce (if ever needed): 4 random + 8 counter
 *
 * @param totalLength - Total nonce length in bytes
 * @returns Hybrid nonce as Uint8Array
 */
function generateHybridNonce(totalLength: number): Uint8Array {
    const counterBytes = 8;
    const randomLength = totalLength - counterBytes;

    if (randomLength < 0) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, `Nonce length ${totalLength} is too short for hybrid nonce (minimum 8 bytes)`);
    }

    // CRITICAL: Capture and increment counter atomically (in JS single-threaded sense)
    // to prevent any theoretical race conditions in async scenarios.
    // The increment happens BEFORE the counter value is used, ensuring each call
    // gets a unique counter value even in high-concurrency scenarios.
    if (nonceCounter >= MAX_UINT64) {
        // This should be practically impossible (2^64 encryptions)
        // but handle it securely: throw error instead of wrapping
        throw new AppError(ErrorCodes.ENCRYPTION_ERROR, "CRITICAL: Nonce counter limit reached after 2^64 operations. Application must be restarted immediately to maintain cryptographic security.");
    }
    const currentCounter = nonceCounter;
    nonceCounter = nonceCounter + 1n;  // Increment immediately after capture

    const nonce = new Uint8Array(totalLength);

    // Random prefix for cross-process/cross-machine uniqueness
    if (randomLength > 0) {
        const randomPart = getRandomBytes(randomLength);
        nonce.set(randomPart, 0);
    }

    // Counter suffix for within-process uniqueness (big-endian)
    const counterView = new DataView(nonce.buffer, nonce.byteOffset + randomLength, counterBytes);
    counterView.setBigUint64(0, currentCounter, false);

    return nonce;
}

/**
 * Reset the nonce counter. Primarily for testing purposes.
 * @internal
 */
export function _resetNonceCounter(): void {
    nonceCounter = 0n;
}

/**
 * Get the current nonce counter value. For testing purposes.
 * @internal
 */
export function _getNonceCounter(): bigint {
    return nonceCounter;
}

export function getPublicKeyForBox(secretKey: Uint8Array): Uint8Array {
    return sodium.crypto_box_seed_keypair(secretKey).publicKey;
}

export function encryptBox(data: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
    const ephemeralKeyPair = sodium.crypto_box_keypair();
    // Generate hybrid nonce (24 bytes: 16 random + 8 counter) to prevent collision risk
    const nonce = generateHybridNonce(sodium.crypto_box_NONCEBYTES);
    const encrypted = sodium.crypto_box_easy(data, nonce, recipientPublicKey, ephemeralKeyPair.privateKey);

    // Bundle format: ephemeral public key (32 bytes) + nonce (24 bytes) + encrypted data
    const result = new Uint8Array(ephemeralKeyPair.publicKey.length + nonce.length + encrypted.length);
    result.set(ephemeralKeyPair.publicKey, 0);
    result.set(nonce, ephemeralKeyPair.publicKey.length);
    result.set(encrypted, ephemeralKeyPair.publicKey.length + nonce.length);

    return result;
}

export function decryptBox(encryptedBundle: Uint8Array, recipientSecretKey: Uint8Array): Uint8Array | null {
    // Extract components from bundle: ephemeral public key (32 bytes) + nonce (24 bytes) + encrypted data
    const ephemeralPublicKey = encryptedBundle.slice(0, sodium.crypto_box_PUBLICKEYBYTES);
    const nonce = encryptedBundle.slice(sodium.crypto_box_PUBLICKEYBYTES, sodium.crypto_box_PUBLICKEYBYTES + sodium.crypto_box_NONCEBYTES);
    const encrypted = encryptedBundle.slice(sodium.crypto_box_PUBLICKEYBYTES + sodium.crypto_box_NONCEBYTES);

    try {
        const decrypted = sodium.crypto_box_open_easy(encrypted, nonce, ephemeralPublicKey, recipientSecretKey);
        return decrypted;
    } catch {
        // Decryption failures are expected for invalid/tampered data - return null
        return null;
    }
}

export function encryptSecretBox(data: any, secret: Uint8Array): Uint8Array {
    // Generate hybrid nonce (24 bytes: 16 random + 8 counter) to prevent collision risk
    const nonce = generateHybridNonce(sodium.crypto_secretbox_NONCEBYTES);
    const encrypted = sodium.crypto_secretbox_easy(new TextEncoder().encode(JSON.stringify(data)), nonce, secret);
    const result = new Uint8Array(nonce.length + encrypted.length);
    result.set(nonce);
    result.set(encrypted, nonce.length);
    return result;
}

export function decryptSecretBox(data: Uint8Array, secret: Uint8Array): any | null {
    const nonce = data.slice(0, sodium.crypto_secretbox_NONCEBYTES);
    const encrypted = data.slice(sodium.crypto_secretbox_NONCEBYTES);

    try {
        const decrypted = sodium.crypto_secretbox_open_easy(encrypted, nonce, secret);
        if (!decrypted) {
            return null;
        }
        return JSON.parse(new TextDecoder().decode(decrypted));
    } catch {
        // Decryption or JSON parse failures are expected for invalid data - return null
        return null;
    }
}