/**
 * API helper utilities for handling common response patterns.
 *
 * This module provides centralized handling for:
 * - 401 Unauthorized responses (triggers logout)
 * - Common error response parsing
 * - Request deduplication for concurrent identical requests
 */

import { AppError, ErrorCodes } from '@/utils/errors';

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
