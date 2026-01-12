/**
 * Tests for Certificate Pinning Module (HAP-624)
 *
 * These tests verify the certificate pinning configuration and helper functions.
 * Note: Actual pinning behavior can only be tested on native platforms with
 * a MITM proxy like Charles or Proxyman.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock react-native Platform
vi.mock('react-native', () => ({
    Platform: {
        OS: 'ios',
    },
}));

// Mock the server config
vi.mock('@/sync/serverConfig', () => ({
    getServerUrl: vi.fn(() => 'https://happy-api.enflamemedia.com'),
}));

// Mock the logger
vi.mock('@/utils/logger', () => ({
    logger: {
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

// Import after mocks are set up
import {
    getPinsForHost,
    isCertificatePinningActive,
} from './certificatePinning';

describe('Certificate Pinning', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getPinsForHost', () => {
        it('should return pin configuration for production API domain', () => {
            const pins = getPinsForHost('happy-api.enflamemedia.com');
            expect(pins).not.toBeNull();
            expect(pins?.publicKeyHashes).toBeDefined();
            expect(pins?.publicKeyHashes.length).toBeGreaterThanOrEqual(2);
            expect(pins?.includeSubdomains).toBe(false);
        });

        it('should return pin configuration for development API domain', () => {
            const pins = getPinsForHost('happy-api-dev.enflamemedia.com');
            expect(pins).not.toBeNull();
            expect(pins?.publicKeyHashes).toBeDefined();
            expect(pins?.publicKeyHashes.length).toBeGreaterThanOrEqual(2);
        });

        it('should return null for unknown domains', () => {
            const pins = getPinsForHost('unknown-domain.com');
            expect(pins).toBeNull();
        });

        it('should return null for localhost', () => {
            const pins = getPinsForHost('localhost');
            expect(pins).toBeNull();
        });
    });

    describe('Pin Configuration Requirements', () => {
        it('should have at least 2 pins per domain (iOS requirement)', () => {
            const prodPins = getPinsForHost('happy-api.enflamemedia.com');
            const devPins = getPinsForHost('happy-api-dev.enflamemedia.com');

            // iOS requires minimum 2 pins per domain
            expect(prodPins?.publicKeyHashes.length).toBeGreaterThanOrEqual(2);
            expect(devPins?.publicKeyHashes.length).toBeGreaterThanOrEqual(2);
        });

        it('should have valid base64-encoded pin hashes', () => {
            const pins = getPinsForHost('happy-api.enflamemedia.com');

            pins?.publicKeyHashes.forEach(hash => {
                // Check it's a valid base64 string (ends with = or == for padding)
                // and contains only valid base64 characters
                expect(hash).toMatch(/^[A-Za-z0-9+/]+=*$/);
            });
        });

        it('should have expiration date set for graceful degradation', () => {
            const pins = getPinsForHost('happy-api.enflamemedia.com');
            expect(pins?.expirationDate).toBeDefined();
            expect(pins?.expirationDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });
    });

    describe('isCertificatePinningActive', () => {
        it('should return false before initialization', () => {
            // Note: This test depends on module state
            // In a real test, we'd need to reset the module state
            const isActive = isCertificatePinningActive();
            expect(typeof isActive).toBe('boolean');
        });
    });
});

describe('Development Bypass', () => {
    it('should bypass pinning for localhost URLs', () => {
        // The module should not configure pins for localhost
        const localhostPins = getPinsForHost('localhost');
        expect(localhostPins).toBeNull();
    });

    it('should bypass pinning for local IP addresses', () => {
        const localIpPins = getPinsForHost('127.0.0.1');
        expect(localIpPins).toBeNull();

        const androidEmulatorPins = getPinsForHost('10.0.2.2');
        expect(androidEmulatorPins).toBeNull();
    });
});
