/**
 * API helper utilities for handling common response patterns.
 *
 * This module provides centralized handling for:
 * - 401 Unauthorized responses (attempts token refresh before logout)
 * - Common error response parsing
 * - Request deduplication for concurrent identical requests
 */

import { AppError, ErrorCodes } from '@/utils/errors';
import { getCurrentAuth } from '@/auth/AuthContext';

// Re-export deduplication utilities for convenient access
export {
    deduplicatedFetch,
    generateCacheKey,
    getInFlightRequestCount,
    clearInFlightRequests,
    type DeduplicatedFetchOptions,
} from '@/utils/requestDeduplication';

/**
 * Checks an API response for authentication errors and throws TOKEN_EXPIRED if 401.
 * Should be called before any other response handling in API functions.
 *
 * Note: This is the synchronous version that immediately throws on 401.
 * For operations that should attempt token refresh first, use checkAuthErrorWithRefresh.
 *
 * @param response - The fetch Response object
 * @param context - Optional context string for error messages (e.g., 'fetch profile')
 * @throws AppError with TOKEN_EXPIRED code if response is 401
 *
 * @example
 * ```typescript
 * const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
 * checkAuthError(response, 'fetch profile');
 * // Continue with normal response handling...
 * ```
 */
export function checkAuthError(response: Response, context?: string): void {
    if (response.status === 401) {
        const message = context
            ? `Session expired while ${context}`
            : 'Session expired - please log in again';
        throw new AppError(ErrorCodes.TOKEN_EXPIRED, message, { canTryAgain: false });
    }
}

/**
 * Result of checkAuthErrorWithRefresh when token was refreshed.
 */
export interface AuthRefreshResult {
    /** True if the token was successfully refreshed */
    refreshed: true;
    /** The new token to use for retrying the request */
    newToken: string;
}

/**
 * Checks an API response for authentication errors and attempts token refresh on 401.
 *
 * On a 401 response:
 * 1. Attempts to refresh the token via AuthContext
 * 2. If refresh succeeds, returns the new token for retry
 * 3. If refresh fails, throws TOKEN_EXPIRED error
 *
 * @param response - The fetch Response object
 * @param context - Optional context string for error messages
 * @returns AuthRefreshResult if token was refreshed, undefined if response was not 401
 * @throws AppError with TOKEN_EXPIRED code if 401 and refresh failed
 *
 * @example
 * ```typescript
 * const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
 * const refreshResult = await checkAuthErrorWithRefresh(response, 'fetch profile');
 * if (refreshResult?.refreshed) {
 *   // Retry the request with refreshResult.newToken
 *   return retryRequest(refreshResult.newToken);
 * }
 * // Continue with normal response handling...
 * ```
 */
export async function checkAuthErrorWithRefresh(
    response: Response,
    context?: string
): Promise<AuthRefreshResult | undefined> {
    if (response.status !== 401) {
        return undefined;
    }

    console.log('[checkAuthErrorWithRefresh] Received 401, attempting token refresh...');

    // Try to refresh the token
    const auth = getCurrentAuth();
    if (auth?.refreshToken) {
        const refreshed = await auth.refreshToken();
        if (refreshed && auth.credentials?.token) {
            console.log('[checkAuthErrorWithRefresh] Token refreshed successfully');
            return { refreshed: true, newToken: auth.credentials.token };
        }
    }

    // Refresh failed or not available - throw the error
    console.log('[checkAuthErrorWithRefresh] Token refresh failed, throwing TOKEN_EXPIRED');
    const message = context
        ? `Session expired while ${context}`
        : 'Session expired - please log in again';
    throw new AppError(ErrorCodes.TOKEN_EXPIRED, message, { canTryAgain: false });
}

/**
 * Checks if an error is an authentication error that should trigger logout.
 *
 * @param error - Any error value
 * @returns true if the error indicates the user should be logged out
 */
export function isAuthError(error: unknown): boolean {
    if (error instanceof AppError) {
        return error.code === ErrorCodes.TOKEN_EXPIRED;
    }
    // Also check for error message patterns (for errors from other sources)
    if (error instanceof Error) {
        const message = error.message.toLowerCase();
        return message.includes('401') ||
               message.includes('unauthorized') ||
               message.includes('invalid token') ||
               message.includes('expired token') ||
               message.includes('session expired');
    }
    return false;
}

/**
 * Checks if an error is a 404 Not Found error.
 * 404 errors should use gradual backoff with a timeout instead of infinite retries.
 *
 * @param error - Any error value
 * @returns true if the error indicates a 404 Not Found response
 */
export function is404Error(error: unknown): boolean {
    if (error instanceof AppError) {
        return error.code === ErrorCodes.NOT_FOUND;
    }
    // Also check for error message patterns (for errors from other sources)
    if (error instanceof Error) {
        const message = error.message.toLowerCase();
        return message.includes('404') ||
               message.includes('not found');
    }
    return false;
}
