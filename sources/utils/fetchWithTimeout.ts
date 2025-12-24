/**
 * Utility for making HTTP requests with timeout support.
 *
 * This module provides a wrapper around fetch() that:
 * - Adds timeout support using AbortController
 * - Throws a dedicated TimeoutError when requests exceed the timeout
 * - Allows external abort signals to be combined with timeout
 * - Properly cleans up timeout timers to prevent memory leaks
 * - Automatically includes correlation IDs for request tracing (HAP-510)
 */

import { AppError, ErrorCodes } from '@/utils/errors';
import {
    CORRELATION_ID_HEADER,
    generateRequestCorrelationId,
    setLastFailedCorrelationId,
} from '@/utils/correlationId';

/**
 * Default timeout for fetch requests in milliseconds.
 * 30 seconds is a reasonable default that balances:
 * - Allowing slow networks to complete
 * - Not leaving users waiting too long
 */
export const DEFAULT_FETCH_TIMEOUT_MS = 30000;

/**
 * Options for fetchWithTimeout, extending standard RequestInit.
 */
export interface FetchWithTimeoutOptions extends RequestInit {
    /**
     * Timeout in milliseconds. Defaults to DEFAULT_FETCH_TIMEOUT_MS (30s).
     * Pass 0 to disable timeout.
     */
    timeoutMs?: number;
}

/**
 * Makes an HTTP request with a timeout.
 *
 * If the request doesn't complete within the specified timeout, it will be
 * aborted and an AppError with TIMEOUT code will be thrown.
 *
 * @param url - The URL to fetch
 * @param options - Fetch options plus optional timeoutMs
 * @returns Promise that resolves with the Response
 * @throws AppError with TIMEOUT code if request times out
 * @throws AppError with FETCH_ABORTED code if request is externally aborted
 *
 * @example
 * ```typescript
 * // Basic usage with default 30s timeout
 * const response = await fetchWithTimeout('https://api.example.com/data', {
 *     headers: { 'Authorization': `Bearer ${token}` }
 * });
 *
 * // Custom timeout
 * const response = await fetchWithTimeout(url, {
 *     timeoutMs: 10000, // 10 seconds
 *     method: 'POST',
 *     body: JSON.stringify(data)
 * });
 *
 * // Combine with external abort signal
 * const controller = new AbortController();
 * const response = await fetchWithTimeout(url, {
 *     signal: controller.signal,
 *     timeoutMs: 5000
 * });
 * ```
 */
export async function fetchWithTimeout(
    url: string,
    options: FetchWithTimeoutOptions = {}
): Promise<Response> {
    const { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, signal: externalSignal, ...fetchOptions } = options;

    // HAP-510: Generate correlation ID for request tracing
    const correlationId = generateRequestCorrelationId();
    const headersWithCorrelation = {
        [CORRELATION_ID_HEADER]: correlationId,
        ...fetchOptions.headers,
    };

    // If timeout is disabled, just pass through to fetch
    if (timeoutMs === 0) {
        return fetch(url, { ...fetchOptions, headers: headersWithCorrelation, signal: externalSignal });
    }

    // Create our own AbortController for the timeout
    const timeoutController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    // If there's an external signal, we need to handle both
    // The request should abort if EITHER the timeout fires OR the external signal aborts
    const handleExternalAbort = () => {
        timeoutController.abort();
    };

    if (externalSignal) {
        // If already aborted, throw immediately
        if (externalSignal.aborted) {
            throw new AppError(
                ErrorCodes.FETCH_ABORTED,
                'Request was aborted',
                { canTryAgain: true }
            );
        }
        externalSignal.addEventListener('abort', handleExternalAbort);
    }

    // Set up the timeout
    timeoutId = setTimeout(() => {
        timeoutController.abort();
    }, timeoutMs);

    try {
        const response = await fetch(url, {
            ...fetchOptions,
            headers: headersWithCorrelation,
            signal: timeoutController.signal
        });
        return response;
    } catch (error) {
        // HAP-510: Store correlation ID for failed requests
        setLastFailedCorrelationId(correlationId);
        // Check if this was a timeout (our controller aborted, not external)
        if (error instanceof Error && error.name === 'AbortError') {
            // Determine if this was our timeout or an external abort
            if (externalSignal?.aborted) {
                throw new AppError(
                    ErrorCodes.FETCH_ABORTED,
                    'Request was aborted',
                    { canTryAgain: true }
                );
            }
            throw new AppError(
                ErrorCodes.TIMEOUT,
                `Request timed out after ${timeoutMs}ms`,
                { canTryAgain: true }
            );
        }
        // Re-throw other errors
        throw error;
    } finally {
        // Clean up
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
        }
        if (externalSignal) {
            externalSignal.removeEventListener('abort', handleExternalAbort);
        }
    }
}
