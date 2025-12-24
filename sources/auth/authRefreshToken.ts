/**
 * Token refresh API module.
 *
 * Handles refreshing authentication tokens before or shortly after expiration.
 * The server allows a 7-day grace period for refreshing expired tokens.
 *
 * @see HAP-451 for server-side token expiration implementation
 * @see HAP-512 for client-side proactive refresh implementation
 */

import axios from 'axios';
import { getServerUrl } from '@/sync/serverConfig';

/** Response from successful token refresh */
interface RefreshSuccessResponse {
    success: true;
    /** New authentication token */
    token: string;
    /** Token validity in seconds (typically 30 days = 2592000) */
    expiresIn: number;
}

/** Response from failed token refresh */
interface RefreshFailedResponse {
    success: false;
    error: string;
    code: 'TOKEN_EXPIRED' | 'TOKEN_INVALID' | 'TOKEN_REVOKED';
}

type RefreshResponse = RefreshSuccessResponse | RefreshFailedResponse;

/**
 * Result of a token refresh attempt.
 * Returns new token and expiration time on success, null on failure.
 */
export interface TokenRefreshResult {
    token: string;
    /** Unix timestamp (ms) when the new token expires */
    expiresAt: number;
}

/**
 * Attempts to refresh an authentication token.
 *
 * The server allows refreshing tokens within a 7-day grace period after expiration.
 * Returns null if the token is too old or invalid.
 *
 * @param currentToken - The current (possibly expired) authentication token
 * @returns New token with expiration time, or null if refresh failed
 *
 * @example
 * ```typescript
 * const result = await authRefreshToken(oldToken);
 * if (result) {
 *   // Update stored credentials with new token and expiresAt
 *   await TokenStorage.setCredentials({ token: result.token, secret, expiresAt: result.expiresAt });
 * } else {
 *   // Token is too old or invalid, user must re-authenticate
 *   await logout();
 * }
 * ```
 */
export async function authRefreshToken(currentToken: string): Promise<TokenRefreshResult | null> {
    const API_ENDPOINT = getServerUrl();

    try {
        const response = await axios.post<RefreshResponse>(
            `${API_ENDPOINT}/v1/auth/refresh`,
            {},
            {
                headers: {
                    Authorization: `Bearer ${currentToken}`,
                },
                timeout: 10000, // 10 second timeout
            }
        );

        const data = response.data;

        if (data.success) {
            // Calculate expiration timestamp from expiresIn (seconds)
            const expiresAt = Date.now() + data.expiresIn * 1000;

            console.log('[authRefreshToken] Token refreshed successfully, expires at:', new Date(expiresAt).toISOString());

            return {
                token: data.token,
                expiresAt,
            };
        }

        // Server returned success: false
        console.log('[authRefreshToken] Refresh failed:', data.code, data.error);
        return null;
    } catch (error) {
        // Handle HTTP errors (401 for expired tokens, network errors, etc.)
        if (axios.isAxiosError(error)) {
            const status = error.response?.status;
            const errorData = error.response?.data as RefreshFailedResponse | undefined;

            if (status === 401) {
                console.log('[authRefreshToken] Token refresh failed (401):', errorData?.code || 'unknown');
            } else {
                console.log('[authRefreshToken] Network error during refresh:', error.message);
            }
        } else {
            console.log('[authRefreshToken] Unexpected error during refresh:', error);
        }

        return null;
    }
}

/**
 * Time constants for token refresh logic.
 */
export const TOKEN_REFRESH_CONSTANTS = {
    /** Tokens should be refreshed when less than 7 days remain (in ms) */
    REFRESH_THRESHOLD_MS: 7 * 24 * 60 * 60 * 1000,
    /** Server's grace period for refreshing expired tokens (in ms) */
    GRACE_PERIOD_MS: 7 * 24 * 60 * 60 * 1000,
    /** Default token lifetime from server (30 days in ms) */
    DEFAULT_LIFETIME_MS: 30 * 24 * 60 * 60 * 1000,
} as const;

/**
 * Checks if a token needs to be refreshed based on its expiration time.
 *
 * @param expiresAt - Unix timestamp (ms) when the token expires, or undefined for legacy tokens
 * @returns true if the token should be refreshed (expires within 7 days or already expired within grace period)
 */
export function shouldRefreshToken(expiresAt: number | undefined): boolean {
    // Legacy tokens without expiration don't need refresh
    if (expiresAt === undefined) {
        return false;
    }

    const now = Date.now();
    const timeUntilExpiry = expiresAt - now;

    // Refresh if expiring within threshold or already expired but within grace period
    return timeUntilExpiry < TOKEN_REFRESH_CONSTANTS.REFRESH_THRESHOLD_MS;
}

/**
 * Checks if a token is still within the grace period for refresh after expiration.
 *
 * @param expiresAt - Unix timestamp (ms) when the token expires
 * @returns true if the token is expired but can still be refreshed
 */
export function isWithinGracePeriod(expiresAt: number | undefined): boolean {
    if (expiresAt === undefined) {
        return true; // Legacy tokens are always valid
    }

    const now = Date.now();
    const timeSinceExpiry = now - expiresAt;

    // Token is not yet expired, or expired but within grace period
    return timeSinceExpiry < TOKEN_REFRESH_CONSTANTS.GRACE_PERIOD_MS;
}
