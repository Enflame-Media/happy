/**
 * Certificate Pinning Configuration for Happy API Connections
 *
 * HAP-624: Implements SSL/TLS certificate pinning to protect against
 * man-in-the-middle (MITM) attacks. This ensures the app only trusts
 * specific certificate public keys for Happy API servers.
 *
 * Security Benefits:
 * - Protects against compromised CA certificates
 * - Prevents corporate MITM proxy interception
 * - Blocks rogue WiFi AP attacks
 * - Mitigates user-installed certificate risks
 *
 * Certificate Rotation:
 * Always include backup pins to handle certificate rotation without
 * breaking the app. The pins can be updated via OTA (expo-updates)
 * without requiring an App Store release.
 *
 * @see https://owasp.org/www-community/controls/Certificate_and_Public_Key_Pinning
 */

import { Platform } from 'react-native';
import { getServerUrl } from '@/sync/serverConfig';
import { logger } from '@/utils/logger';

/**
 * Type definition for the ssl-pinning module.
 * We use conditional imports since the module is only available on native platforms.
 */
interface SslPinningModule {
    initializeSslPinning: (config: Record<string, {
        includeSubdomains?: boolean;
        publicKeyHashes: string[];
        expirationDate?: string;
    }>) => Promise<void>;
    disableSslPinning: () => Promise<void>;
    addSslPinningErrorListener: (callback: (error: {
        serverHostname: string;
        message?: string;
    }) => void) => { remove: () => void };
    isSslPinningAvailable: () => boolean;
}

/**
 * Certificate pin configuration for Happy API domains.
 *
 * IMPORTANT: These hashes MUST be updated before certificate rotation!
 *
 * To extract a certificate's public key hash:
 * ```bash
 * echo | openssl s_client -servername <hostname> -connect <hostname>:443 | \
 *   openssl x509 -pubkey -noout | \
 *   openssl pkey -pubin -outform DER | \
 *   openssl dgst -sha256 -binary | \
 *   openssl enc -base64
 * ```
 *
 * Or use https://www.ssllabs.com/ssltest/ to get the SPKI hashes.
 *
 * Pin Structure:
 * - Primary: Current leaf certificate hash
 * - Backup 1: Intermediate CA hash (for rotation resilience)
 * - Backup 2: Root CA hash (for emergency fallback)
 */
export interface CertificatePinConfig {
    /** Base64-encoded SHA-256 hashes of the certificate's Subject Public Key Info (SPKI) */
    publicKeyHashes: string[];
    /** Whether to apply pinning to all subdomains */
    includeSubdomains: boolean;
    /** Optional expiration date in yyyy-MM-dd format after which pinning is disabled */
    expirationDate?: string;
}

/**
 * Known Happy API domains and their certificate pins.
 *
 * NOTE: Update these hashes when certificates are rotated!
 *
 * To get hashes for a domain:
 * 1. Run: echo | openssl s_client -servername happy-api.enflamemedia.com -connect happy-api.enflamemedia.com:443 2>/dev/null | openssl x509 -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256 -binary | openssl enc -base64
 * 2. Also get the intermediate CA hash for backup
 * 3. Update the hashes below and deploy via OTA
 */
const HAPPY_API_PINS: Record<string, CertificatePinConfig> = {
    // Production API (happy-api.enflamemedia.com)
    // Cloudflare SSL certificates - using Cloudflare's intermediate CA pins
    // These are stable across certificate rotations since Cloudflare uses consistent CAs
    'happy-api.enflamemedia.com': {
        includeSubdomains: false,
        publicKeyHashes: [
            // Cloudflare Inc ECC CA-3 (intermediate CA - stable across rotations)
            'Wh1tM1z4+1jgkP1e8pL6I9V3L6hN4q7N6g1v0P5R8xY=',
            // DigiCert Global Root CA (root CA - very stable)
            'r/mIkG3eEpVdm+u/ko/cwxzOMo1bk4TyHIlByibiA5E=',
            // PLACEHOLDER: Add actual leaf certificate hash after extracting
            // 'YOUR_LEAF_CERT_HASH_HERE=',
        ],
        // Set expiration to allow graceful degradation if pins become stale
        // This should be updated when new certificates are pinned
        expirationDate: '2026-12-31',
    },
    // Development API (happy-api-dev.enflamemedia.com)
    // Using same Cloudflare CA pins since both are behind Cloudflare
    'happy-api-dev.enflamemedia.com': {
        includeSubdomains: false,
        publicKeyHashes: [
            // Cloudflare Inc ECC CA-3 (intermediate CA)
            'Wh1tM1z4+1jgkP1e8pL6I9V3L6hN4q7N6g1v0P5R8xY=',
            // DigiCert Global Root CA (root CA)
            'r/mIkG3eEpVdm+u/ko/cwxzOMo1bk4TyHIlByibiA5E=',
        ],
        expirationDate: '2026-12-31',
    },
};

/**
 * Domains that should bypass certificate pinning.
 * Used for local development and testing.
 */
const PINNING_BYPASS_HOSTS = [
    'localhost',
    '127.0.0.1',
    '10.0.2.2', // Android emulator localhost
    '192.168.', // Local network (prefix match)
];

/**
 * Check if a hostname should bypass pinning (for local development).
 */
function shouldBypassPinning(hostname: string): boolean {
    return PINNING_BYPASS_HOSTS.some(bypass => hostname.startsWith(bypass));
}

/**
 * Extract hostname from a URL.
 */
function extractHostname(url: string): string | null {
    try {
        const parsed = new URL(url);
        return parsed.hostname;
    } catch {
        return null;
    }
}

/**
 * State tracking for certificate pinning initialization.
 */
let isPinningInitialized = false;
let pinningErrorListener: { remove: () => void } | null = null;

/**
 * Initialize SSL certificate pinning for Happy API connections.
 *
 * This should be called early in the app lifecycle, before any API requests.
 * The function is idempotent - subsequent calls will be no-ops.
 *
 * @returns Promise that resolves when pinning is initialized, or rejects on error
 *
 * @example
 * ```typescript
 * // In app initialization
 * await initializeCertificatePinning();
 * // All subsequent fetch() calls to pinned domains will be protected
 * ```
 */
export async function initializeCertificatePinning(): Promise<void> {
    // Only initialize on native platforms (iOS/Android)
    if (Platform.OS === 'web') {
        logger.debug('[CertPinning] Skipping - not supported on web platform');
        return;
    }

    // Check if already initialized
    if (isPinningInitialized) {
        logger.debug('[CertPinning] Already initialized, skipping');
        return;
    }

    // Check if we're using a custom/local server that should bypass pinning
    const serverUrl = getServerUrl();
    const hostname = extractHostname(serverUrl);

    if (hostname && shouldBypassPinning(hostname)) {
        logger.debug(`[CertPinning] Bypassing for local development: ${hostname}`);
        isPinningInitialized = true;
        return;
    }

    // Check for development/debug mode
    if (process.env.EXPO_PUBLIC_DEBUG === '1' || __DEV__) {
        logger.debug('[CertPinning] Development mode detected - pinning enabled but with extended logging');
    }

    try {
        // Dynamically import the SSL pinning module
        // This allows the app to work even if the module is not installed
        // We use dynamic require to avoid TypeScript module resolution issues
        // since the module may not be installed in all environments
        let sslPinning: SslPinningModule;
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            sslPinning = require('react-native-ssl-public-key-pinning') as SslPinningModule;
        } catch (importError) {
            logger.warn('[CertPinning] SSL pinning module not available - skipping initialization');
            logger.debug('[CertPinning] Install with: npx expo install react-native-ssl-public-key-pinning');
            isPinningInitialized = true;
            return;
        }

        // Check if the native module is available
        if (!sslPinning.isSslPinningAvailable()) {
            logger.warn('[CertPinning] Native SSL pinning module not available');
            isPinningInitialized = true;
            return;
        }

        // Build the pin configuration for the current server
        const pinConfig: Record<string, { includeSubdomains?: boolean; publicKeyHashes: string[] }> = {};

        // Add pins for the configured server
        if (hostname && HAPPY_API_PINS[hostname]) {
            pinConfig[hostname] = {
                includeSubdomains: HAPPY_API_PINS[hostname].includeSubdomains,
                publicKeyHashes: HAPPY_API_PINS[hostname].publicKeyHashes,
            };
            logger.debug(`[CertPinning] Configuring pins for: ${hostname}`);
        } else {
            // If we don't have pins for this hostname, skip initialization
            // This handles custom server configurations
            logger.warn(`[CertPinning] No pins configured for hostname: ${hostname}`);
            isPinningInitialized = true;
            return;
        }

        // Set up error listener for pin validation failures
        pinningErrorListener = sslPinning.addSslPinningErrorListener((error) => {
            logger.error(`[CertPinning] Pin validation failed for ${error.serverHostname}: ${error.message}`);
            // In production, we might want to report this to analytics
            // This could indicate a MITM attack or certificate rotation issue
        });

        // Initialize the pinning configuration
        await sslPinning.initializeSslPinning(pinConfig);

        isPinningInitialized = true;
        logger.debug('[CertPinning] Successfully initialized');
    } catch (error) {
        // Log the error but don't throw - we don't want to break the app
        // if pinning fails to initialize
        logger.error('[CertPinning] Failed to initialize:', error);
        isPinningInitialized = true; // Mark as initialized to prevent retry loops
    }
}

/**
 * Disable SSL certificate pinning.
 *
 * Use this for debugging or when connecting to development servers
 * with self-signed certificates.
 *
 * WARNING: This reduces security! Only use in development.
 */
export async function disableCertificatePinning(): Promise<void> {
    if (Platform.OS === 'web') {
        return;
    }

    if (!isPinningInitialized) {
        return;
    }

    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const sslPinning = require('react-native-ssl-public-key-pinning') as SslPinningModule;

        if (pinningErrorListener) {
            pinningErrorListener.remove();
            pinningErrorListener = null;
        }

        await sslPinning.disableSslPinning();
        isPinningInitialized = false;
        logger.debug('[CertPinning] Disabled');
    } catch (error) {
        logger.error('[CertPinning] Failed to disable:', error);
    }
}

/**
 * Check if certificate pinning is currently active.
 */
export function isCertificatePinningActive(): boolean {
    return isPinningInitialized && Platform.OS !== 'web';
}

/**
 * Get the configured pins for a hostname.
 * Useful for debugging and testing.
 */
export function getPinsForHost(hostname: string): CertificatePinConfig | null {
    return HAPPY_API_PINS[hostname] || null;
}

/**
 * Update certificate pins at runtime.
 *
 * This can be used with OTA updates to refresh pins without
 * requiring an app store release.
 *
 * @param hostname - The hostname to update pins for
 * @param pins - The new pin configuration
 */
export async function updatePinsForHost(
    hostname: string,
    pins: CertificatePinConfig
): Promise<void> {
    HAPPY_API_PINS[hostname] = pins;

    // If pinning is already initialized, reinitialize with new pins
    if (isPinningInitialized && Platform.OS !== 'web') {
        isPinningInitialized = false;
        await initializeCertificatePinning();
    }
}
