/**
 * Request deduplication utility for avoiding duplicate concurrent API calls.
 *
 * When the same API request is made multiple times concurrently, this utility
 * ensures only one actual network request is made. All concurrent callers
 * share the same Promise and receive the same result.
 *
 * This is particularly useful for:
 * - UI components that mount simultaneously and fetch the same data
 * - Rapid user interactions that trigger duplicate requests
 * - Race conditions in concurrent code paths
 *
 * @example
 * ```typescript
 * // Instead of this (makes 3 network requests):
 * await Promise.all([
 *     fetch('/api/user'),
 *     fetch('/api/user'),
 *     fetch('/api/user')
 * ]);
 *
 * // Use this (makes 1 network request, shared by all 3):
 * await Promise.all([
 *     deduplicatedFetch('/api/user'),
 *     deduplicatedFetch('/api/user'),
 *     deduplicatedFetch('/api/user')
 * ]);
 * ```
 */

import { fetchWithTimeout, FetchWithTimeoutOptions } from './fetchWithTimeout';

/**
 * Extended options for deduplicatedFetch.
 */
export interface DeduplicatedFetchOptions extends FetchWithTimeoutOptions {
    /**
     * Skip deduplication for this request. Useful for POST requests that
     * should always execute (e.g., form submissions, mutations).
     * Default: false
     */
    skipDeduplication?: boolean;
}

/**
 * In-flight request entry containing the promise and metadata.
 */
interface InFlightRequest {
    promise: Promise<Response>;
    createdAt: number;
}

/**
 * Map of in-flight requests keyed by their cache key.
 * This is a module-level singleton that tracks all pending requests.
 */
const inFlightRequests = new Map<string, InFlightRequest>();

/**
 * Maximum age for an in-flight request entry before it's considered stale.
 * This is a safety mechanism to prevent memory leaks if a request somehow
 * never resolves (shouldn't happen, but defensive coding).
 */
const MAX_INFLIGHT_AGE_MS = 60000; // 1 minute

/**
 * Generates a unique cache key for a request based on URL, method, and body.
 *
 * The key is designed to uniquely identify semantically identical requests.
 * Two requests with the same URL, method, and body will produce the same key.
 *
 * @param url - The request URL
 * @param options - The fetch options (method, body, headers are considered)
 * @returns A string cache key
 *
 * @example
 * ```typescript
 * const key = generateCacheKey('/api/users', { method: 'GET' });
 * // Returns: "GET:/api/users"
 *
 * const key = generateCacheKey('/api/users', {
 *     method: 'POST',
 *     body: JSON.stringify({ name: 'John' })
 * });
 * // Returns: "POST:/api/users:{"name":"John"}"
 * ```
 */
export function generateCacheKey(url: string, options: RequestInit = {}): string {
    const method = (options.method || 'GET').toUpperCase();

    // For requests with a body, include the body in the key
    // This ensures POST/PUT requests with different payloads are distinguished
    let bodyKey = '';
    if (options.body) {
        if (typeof options.body === 'string') {
            bodyKey = `:${options.body}`;
        } else if (options.body instanceof FormData) {
            // FormData can't be easily serialized, so we use a hash or just note it exists
            // For now, we'll skip deduplication for FormData requests
            bodyKey = `:formdata:${Date.now()}`;
        } else if (options.body instanceof URLSearchParams) {
            bodyKey = `:${options.body.toString()}`;
        } else if (options.body instanceof ArrayBuffer || ArrayBuffer.isView(options.body)) {
            // Binary data - skip deduplication
            bodyKey = `:binary:${Date.now()}`;
        } else if (options.body instanceof Blob) {
            // Blob - skip deduplication
            bodyKey = `:blob:${Date.now()}`;
        } else if (options.body instanceof ReadableStream) {
            // Streams can't be deduplicated
            bodyKey = `:stream:${Date.now()}`;
        }
    }

    return `${method}:${url}${bodyKey}`;
}

/**
 * Cleans up stale entries from the in-flight request map.
 * Called periodically to prevent memory leaks.
 */
function cleanupStaleEntries(): void {
    const now = Date.now();
    for (const [key, entry] of inFlightRequests.entries()) {
        if (now - entry.createdAt > MAX_INFLIGHT_AGE_MS) {
            inFlightRequests.delete(key);
        }
    }
}

/**
 * Makes an HTTP request with deduplication for concurrent identical requests.
 *
 * If an identical request (same URL, method, and body) is already in flight,
 * this function returns the existing Promise instead of making a new request.
 * All callers share the same response.
 *
 * **Important**: The Response object is cloned for each caller, so each caller
 * can independently consume the response body.
 *
 * @param url - The URL to fetch
 * @param options - Fetch options plus deduplication control
 * @returns Promise that resolves with a cloned Response
 *
 * @example
 * ```typescript
 * // Basic usage - deduplication is automatic
 * const response = await deduplicatedFetch('/api/data');
 *
 * // Skip deduplication for mutations
 * const response = await deduplicatedFetch('/api/submit', {
 *     method: 'POST',
 *     body: JSON.stringify(data),
 *     skipDeduplication: true
 * });
 * ```
 */
export async function deduplicatedFetch(
    url: string,
    options: DeduplicatedFetchOptions = {}
): Promise<Response> {
    const { skipDeduplication = false, ...fetchOptions } = options;

    // Generate cache key
    const cacheKey = generateCacheKey(url, fetchOptions);

    // Check if deduplication should be skipped
    // - Explicitly requested skip
    // - Non-idempotent methods by default (POST, PUT, DELETE, PATCH)
    // - Requests with bodies that can't be compared (FormData, streams, etc.)
    const method = (fetchOptions.method || 'GET').toUpperCase();
    const isNonIdempotent = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);
    const hasUncomparableBody = cacheKey.includes(':formdata:') ||
                                 cacheKey.includes(':binary:') ||
                                 cacheKey.includes(':blob:') ||
                                 cacheKey.includes(':stream:');

    if (skipDeduplication || hasUncomparableBody) {
        // No deduplication - just make the request directly
        return fetchWithTimeout(url, fetchOptions);
    }

    // For non-idempotent methods, skip deduplication by default
    // but allow explicit opt-in via the cache key matching
    // (e.g., if someone explicitly wants to dedupe a POST)
    if (isNonIdempotent) {
        return fetchWithTimeout(url, fetchOptions);
    }

    // Cleanup stale entries periodically (every 100 requests or so)
    if (Math.random() < 0.01) {
        cleanupStaleEntries();
    }

    // Check for existing in-flight request
    const existing = inFlightRequests.get(cacheKey);
    if (existing) {
        // Return a clone of the response so each caller can consume it independently
        // We await the original promise and clone the response
        const response = await existing.promise;
        return response.clone();
    }

    // Create the new request promise
    const requestPromise = fetchWithTimeout(url, fetchOptions);

    // Store it in the map
    inFlightRequests.set(cacheKey, {
        promise: requestPromise,
        createdAt: Date.now()
    });

    try {
        // Wait for the response
        const response = await requestPromise;

        // Return a clone so the original can be cloned again for other waiters
        return response.clone();
    } finally {
        // Always remove from the map when done (success or failure)
        // This ensures the next request will make a fresh call
        inFlightRequests.delete(cacheKey);
    }
}

/**
 * Gets the current number of in-flight requests.
 * Useful for debugging and testing.
 */
export function getInFlightRequestCount(): number {
    return inFlightRequests.size;
}

/**
 * Clears all in-flight requests.
 * Primarily for testing purposes.
 */
export function clearInFlightRequests(): void {
    inFlightRequests.clear();
}
