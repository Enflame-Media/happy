import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { AppError, ErrorCodes } from '@/utils/errors';

const AUTH_KEY = 'auth_credentials';
const ENCRYPTION_KEY = 'auth_enc_key';
const AES_GCM_IV_LENGTH = 12;

// Web Crypto API utilities for secure localStorage storage
// These functions are only used on web platform
// Note: This encryption provides protection against casual inspection but not against
// active XSS attacks, as the key must be stored client-side. For maximum security,
// use the native mobile apps which utilize hardware-backed secure storage.

function isSecureContext(): boolean {
    return typeof window !== 'undefined' && window.isSecureContext;
}

function isValidCredentials(value: unknown): value is AuthCredentials {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;
    if (typeof obj.token !== 'string' || typeof obj.secret !== 'string') return false;
    // expiresAt is optional - if present, must be a number
    if (obj.expiresAt !== undefined && typeof obj.expiresAt !== 'number') return false;
    return true;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

async function getOrCreateEncryptionKey(): Promise<CryptoKey> {
    const stored = localStorage.getItem(ENCRYPTION_KEY);
    if (stored) {
        const keyData = base64ToArrayBuffer(stored);
        return crypto.subtle.importKey('raw', keyData, 'AES-GCM', true, ['encrypt', 'decrypt']);
    }
    const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
    const exported = await crypto.subtle.exportKey('raw', key);
    localStorage.setItem(ENCRYPTION_KEY, arrayBufferToBase64(exported));
    return key;
}

async function encryptForWeb(data: string): Promise<string> {
    if (!isSecureContext()) {
        throw new AppError(ErrorCodes.NOT_CONFIGURED, 'Web Crypto API requires a secure context (HTTPS)');
    }
    const key = await getOrCreateEncryptionKey();
    const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_LENGTH));
    const encoded = new TextEncoder().encode(data);
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoded
    );
    // Concatenate IV + ciphertext
    const result = new Uint8Array(iv.length + ciphertext.byteLength);
    result.set(iv);
    result.set(new Uint8Array(ciphertext), iv.length);
    return arrayBufferToBase64(result.buffer);
}

async function decryptForWeb(encrypted: string): Promise<string> {
    const key = await getOrCreateEncryptionKey();
    const data = base64ToArrayBuffer(encrypted);
    const iv = new Uint8Array(data.slice(0, AES_GCM_IV_LENGTH));
    const ciphertext = data.slice(AES_GCM_IV_LENGTH);
    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext
    );
    return new TextDecoder().decode(decrypted);
}

// Cache for synchronous access (currently unused - kept for future sync access)
let _credentialsCache: string | null = null;

export interface AuthCredentials {
    token: string;
    secret: string;
    /** Unix timestamp (ms) when the token expires. If not set, token is treated as never expiring (legacy). */
    expiresAt?: number;
}

export const TokenStorage = {
    async getCredentials(): Promise<AuthCredentials | null> {
        console.log('[TokenStorage] getCredentials called, platform:', Platform.OS);
        if (Platform.OS === 'web') {
            const stored = localStorage.getItem(AUTH_KEY);
            console.log('[TokenStorage] Raw stored value exists:', !!stored);
            if (!stored) return null;
            try {
                // Try to decrypt (new encrypted format)
                const decrypted = await decryptForWeb(stored);
                const parsed: unknown = JSON.parse(decrypted);
                if (!isValidCredentials(parsed)) {
                    throw new AppError(ErrorCodes.VALIDATION_FAILED, 'Invalid credentials format');
                }
                console.log('[TokenStorage] Retrieved token (first 30 chars):', parsed.token.substring(0, 30) + '...');
                return parsed;
            } catch (decryptError) {
                console.log('[TokenStorage] Decrypt failed, trying plaintext:', decryptError);
                // Migration: try parsing as plaintext JSON (old format)
                try {
                    const parsed: unknown = JSON.parse(stored);
                    if (!isValidCredentials(parsed)) {
                        throw new AppError(ErrorCodes.VALIDATION_FAILED, 'Invalid credentials format');
                    }
                    console.log('[TokenStorage] Migrating plaintext token (first 30 chars):', (parsed as AuthCredentials).token.substring(0, 30) + '...');
                    // Re-encrypt and save in new format
                    const encrypted = await encryptForWeb(JSON.stringify(parsed));
                    localStorage.setItem(AUTH_KEY, encrypted);
                    return parsed;
                } catch {
                    // Corrupted data, clear it
                    console.log('[TokenStorage] Data corrupted, clearing');
                    localStorage.removeItem(AUTH_KEY);
                    localStorage.removeItem(ENCRYPTION_KEY);
                    return null;
                }
            }
        }
        try {
            const stored = await SecureStore.getItemAsync(AUTH_KEY);
            if (!stored) return null;
            _credentialsCache = stored; // Update cache
            return JSON.parse(stored) as AuthCredentials;
        } catch (error) {
            console.error('Error getting credentials:', error);
            return null;
        }
    },

    async setCredentials(credentials: AuthCredentials): Promise<boolean> {
        console.log('[TokenStorage] setCredentials called');
        console.log('[TokenStorage] Storing token (first 30 chars):', credentials.token.substring(0, 30) + '...');
        if (Platform.OS === 'web') {
            try {
                const json = JSON.stringify(credentials);
                const encrypted = await encryptForWeb(json);
                localStorage.setItem(AUTH_KEY, encrypted);
                console.log('[TokenStorage] Token encrypted and stored successfully');
                return true;
            } catch (error) {
                console.error('[TokenStorage] Error encrypting credentials:', error);
                return false;
            }
        }
        try {
            const json = JSON.stringify(credentials);
            await SecureStore.setItemAsync(AUTH_KEY, json);
            _credentialsCache = json; // Update cache
            return true;
        } catch (error) {
            console.error('Error setting credentials:', error);
            return false;
        }
    },

    async removeCredentials(): Promise<boolean> {
        if (Platform.OS === 'web') {
            localStorage.removeItem(AUTH_KEY);
            localStorage.removeItem(ENCRYPTION_KEY);
            return true;
        }
        try {
            await SecureStore.deleteItemAsync(AUTH_KEY);
            _credentialsCache = null; // Clear cache
            return true;
        } catch (error) {
            console.error('Error removing credentials:', error);
            return false;
        }
    },
};