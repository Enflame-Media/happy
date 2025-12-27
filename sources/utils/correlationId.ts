/**
 * Correlation ID utilities for request tracing.
 *
 * Correlation IDs enable end-to-end request tracing across:
 * - Mobile/web app → Server API
 * - Mobile/web app → WebSocket connections
 * - Server logs → Support debugging
 *
 * The server (HAP-480) logs these IDs, allowing support to trace
 * user-reported issues through the entire request flow.
 *
 * @module utils/correlationId
 */

import * as Crypto from 'expo-crypto';

/**
 * HTTP header name for correlation ID.
 * Standard header used across the Happy infrastructure.
 */
export const CORRELATION_ID_HEADER = 'X-Correlation-ID';

/**
 * Session-scoped correlation ID.
 * Generated once per app session and reused for all requests.
 * This allows grouping all requests from a single app session.
 */
let sessionCorrelationId: string | null = null;

/**
 * Get or generate the session-scoped correlation ID.
 *
 * The session ID persists for the lifetime of the app process.
 * All HTTP and WebSocket requests will include this ID,
 * making it easy to trace all activity from a single session.
 *
 * @returns The session correlation ID (UUID format)
 *
 * @example
 * ```typescript
 * const correlationId = getSessionCorrelationId();
 * // "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
 * ```
 */
export function getSessionCorrelationId(): string {
    if (!sessionCorrelationId) {
        sessionCorrelationId = Crypto.randomUUID();
    }
    return sessionCorrelationId;
}

/**
 * Generate a unique correlation ID for a single request.
 *
 * Use this when you need to trace a specific request independently
 * of the session. The format includes the session ID prefix for
 * easy correlation.
 *
 * @returns A unique correlation ID (format: "sessionId:requestId")
 *
 * @example
 * ```typescript
 * const correlationId = generateRequestCorrelationId();
 * // "a1b2c3d4-e5f6-7890-abcd-ef1234567890:req-f1e2d3c4"
 * ```
 */
export function generateRequestCorrelationId(): string {
    const sessionId = getSessionCorrelationId();
    const requestId = Crypto.randomUUID().substring(0, 8);
    return `${sessionId}:req-${requestId}`;
}

/**
 * Reset the session correlation ID.
 * Called when the user logs out or the app is reset.
 *
 * @internal
 */
export function resetSessionCorrelationId(): void {
    sessionCorrelationId = null;
}

/**
 * Get the current correlation ID for display to users.
 *
 * Returns a shortened version suitable for error messages and
 * support tickets. Users can report this ID when contacting support.
 *
 * @returns Short correlation ID for user display (last 12 chars)
 *
 * @example
 * ```typescript
 * const shortId = getDisplayCorrelationId();
 * // "ef1234567890"
 * ```
 */
export function getDisplayCorrelationId(): string {
    const fullId = getSessionCorrelationId();
    // Return last 12 characters for brevity while maintaining uniqueness
    return fullId.slice(-12);
}

/**
 * Last correlation ID used in a failed request.
 * Stored for display in error messages.
 */
let lastFailedCorrelationId: string | null = null;

/**
 * Set the correlation ID from a failed request.
 * Called when an API request fails to store the ID for error display.
 *
 * @param correlationId - The correlation ID from the failed request
 */
export function setLastFailedCorrelationId(correlationId: string): void {
    lastFailedCorrelationId = correlationId;
}

/**
 * Get the correlation ID from the last failed request.
 * Used to display the ID in error messages for support.
 *
 * @returns The last failed correlation ID, or null if none
 */
export function getLastFailedCorrelationId(): string | null {
    return lastFailedCorrelationId;
}

/**
 * Clear the last failed correlation ID.
 * Called after the ID has been displayed to the user.
 */
export function clearLastFailedCorrelationId(): void {
    lastFailedCorrelationId = null;
}

/**
 * Get a short version of a correlation ID suitable for log messages.
 *
 * Extracts the request-specific suffix (e.g., "req-f1e2d3c4") from
 * a full correlation ID for compact logging.
 *
 * @param correlationId - Full correlation ID (format: "sessionId:req-xxxxxxxx")
 * @returns Short form for logging (e.g., "f1e2d3c4")
 *
 * @example
 * ```typescript
 * const short = getShortCorrelationId("a1b2c3d4-e5f6-7890-abcd-ef1234567890:req-f1e2d3c4");
 * // "f1e2d3c4"
 * ```
 */
export function getShortCorrelationId(correlationId: string): string {
    // Extract the request ID suffix after "req-"
    const reqMatch = correlationId.match(/:req-([a-f0-9]+)$/);
    if (reqMatch) {
        return reqMatch[1];
    }
    // Fallback: return last 8 characters
    return correlationId.slice(-8);
}
