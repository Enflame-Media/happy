/**
 * Delta Sync Orchestrator (HAP-558)
 *
 * Extracted orchestration logic for delta sync reconnection flow.
 * This module enables comprehensive testing of the requestDeltaSync
 * behavior without requiring class instantiation or WebSocket mocking.
 *
 * Strategy: Option A (Extract to Testable Module)
 * - Pure function with dependency injection
 * - All side effects passed as callbacks
 * - Follows pattern established in HAP-486 (deltaSyncUtils.ts)
 *
 * @module sync/deltaSyncOrchestrator
 * @see HAP-441 - Delta sync implementation
 * @see HAP-486 - Unit tests for delta sync utilities
 * @see HAP-558 - Integration tests for delta sync orchestration
 */

/**
 * Response shape from the server's 'request-updates-since' handler.
 * Matches the DeltaSyncResponse interface in sync.ts.
 */
export interface DeltaSyncResponse {
    success: boolean;
    error?: string;
    updates?: DeltaSyncUpdate[];
    counts?: DeltaSyncCounts;
}

/**
 * Individual update from delta sync response.
 */
export interface DeltaSyncUpdate {
    type: string;
    data: unknown;
    seq: number;
    createdAt: number;
}

/**
 * Counts of updates returned by delta sync.
 * Used to detect limit overflow conditions.
 */
export interface DeltaSyncCounts {
    sessions: number;
    machines: number;
    artifacts: number;
}

/**
 * Sequence numbers for delta sync request.
 */
export interface DeltaSyncSeqNumbers {
    sessions: number;
    machines: number;
    artifacts: number;
}

/**
 * Result of delta sync orchestration.
 */
export type DeltaSyncResult = 'delta' | 'full';

/**
 * Reason for falling back to full sync.
 * Used for logging and testing.
 */
export type DeltaSyncFallbackReason =
    | 'fresh_connection'
    | 'error_response'
    | 'network_error'
    | 'timeout'
    | 'sessions_limit'
    | 'machines_limit'
    | 'artifacts_limit';

/**
 * Detailed result with reason for test assertions.
 */
export interface DeltaSyncDetailedResult {
    result: DeltaSyncResult;
    fallbackReason?: DeltaSyncFallbackReason;
    updatesProcessed: number;
}

/**
 * Limit thresholds for delta sync.
 * If counts exceed these, fall back to full sync.
 */
export const DELTA_SYNC_LIMITS = {
    sessions: 100,
    machines: 50,
    artifacts: 100,
} as const;

/**
 * Timeout for delta sync request in milliseconds.
 */
export const DELTA_SYNC_TIMEOUT_MS = 10000;

/**
 * Dependencies required for delta sync orchestration.
 * These are injected to enable pure testing.
 */
export interface DeltaSyncDependencies {
    /**
     * Get the last known sequence number for an entity type.
     */
    getSeq: (entityType: 'sessions' | 'machines' | 'artifacts') => number;

    /**
     * Emit WebSocket request and wait for acknowledgement.
     * Should throw on timeout or network error.
     */
    emitWithAck: (
        event: string,
        data: DeltaSyncSeqNumbers,
        timeoutMs: number
    ) => Promise<DeltaSyncResponse>;

    /**
     * Handle a single update from the delta sync response.
     * Wraps the update in the expected container format.
     */
    handleUpdate: (update: {
        seq: number;
        createdAt: number;
        body: unknown;
    }) => Promise<void>;

    /**
     * Perform full invalidation (fallback behavior).
     */
    performFullInvalidation: () => void;

    /**
     * Invalidate non-delta syncs on success.
     * Called for friendsSync, friendRequestsSync, feedSync, gitStatusSync.
     */
    invalidateNonDeltaSyncs: () => void;

    /**
     * Optional logger for debugging.
     */
    log?: (message: string) => void;
}

/**
 * Orchestrate delta sync on reconnection.
 *
 * This function encapsulates the core logic of requestDeltaSync:
 * 1. Check if this is a fresh connection (all seqs are 0)
 * 2. Request delta updates from server
 * 3. Handle error responses
 * 4. Process updates through handleUpdate
 * 5. Detect limit overflow and fallback
 * 6. Invalidate non-delta syncs on success
 *
 * @param deps - Injected dependencies for testability
 * @returns Detailed result with sync mode and reason
 *
 * @example
 * // In Sync class
 * const result = await orchestrateDeltaSync({
 *     getSeq: (type) => this.getLastKnownSeq(type),
 *     emitWithAck: apiSocket.emitWithAck.bind(apiSocket),
 *     handleUpdate: this.handleUpdate,
 *     performFullInvalidation: this.performFullInvalidation,
 *     invalidateNonDeltaSyncs: () => {
 *         this.friendsSync.invalidate();
 *         // ...
 *     },
 *     log: (msg) => log.log(msg),
 * });
 */
export async function orchestrateDeltaSync(
    deps: DeltaSyncDependencies
): Promise<DeltaSyncDetailedResult> {
    const { getSeq, emitWithAck, handleUpdate, performFullInvalidation, invalidateNonDeltaSyncs, log } = deps;

    const sessionsSeq = getSeq('sessions');
    const machinesSeq = getSeq('machines');
    const artifactsSeq = getSeq('artifacts');

    // Fresh connection detection: all seqs are 0
    if (sessionsSeq === 0 && machinesSeq === 0 && artifactsSeq === 0) {
        log?.('🔌 No previous seq data, performing full sync');
        performFullInvalidation();
        return {
            result: 'full',
            fallbackReason: 'fresh_connection',
            updatesProcessed: 0,
        };
    }

    log?.(`🔌 Requesting delta sync since: sessions=${sessionsSeq}, machines=${machinesSeq}, artifacts=${artifactsSeq}`);

    try {
        // Request delta updates from server
        const response = await emitWithAck(
            'request-updates-since',
            {
                sessions: sessionsSeq,
                machines: machinesSeq,
                artifacts: artifactsSeq,
            },
            DELTA_SYNC_TIMEOUT_MS
        );

        // Error response handling
        if (!response.success) {
            log?.('🔌 Delta sync failed, falling back to full sync');
            performFullInvalidation();
            return {
                result: 'full',
                fallbackReason: 'error_response',
                updatesProcessed: 0,
            };
        }

        log?.(
            `🔌 Delta sync received: sessions=${response.counts?.sessions ?? 0}, machines=${response.counts?.machines ?? 0}, artifacts=${response.counts?.artifacts ?? 0}`
        );

        // Process updates through handleUpdate
        let updatesProcessed = 0;
        if (response.updates && response.updates.length > 0) {
            for (const update of response.updates) {
                // Wrap in update container format expected by handleUpdate
                await handleUpdate({
                    seq: update.seq,
                    createdAt: update.createdAt,
                    body: update.data,
                });
                updatesProcessed++;
            }
        }

        // Limit threshold fallback
        const sessionsCount = response.counts?.sessions ?? 0;
        const machinesCount = response.counts?.machines ?? 0;
        const artifactsCount = response.counts?.artifacts ?? 0;

        if (sessionsCount >= DELTA_SYNC_LIMITS.sessions) {
            log?.('🔌 Delta sync hit sessions limit, performing full sync for completeness');
            performFullInvalidation();
            return {
                result: 'full',
                fallbackReason: 'sessions_limit',
                updatesProcessed,
            };
        }

        if (machinesCount >= DELTA_SYNC_LIMITS.machines) {
            log?.('🔌 Delta sync hit machines limit, performing full sync for completeness');
            performFullInvalidation();
            return {
                result: 'full',
                fallbackReason: 'machines_limit',
                updatesProcessed,
            };
        }

        if (artifactsCount >= DELTA_SYNC_LIMITS.artifacts) {
            log?.('🔌 Delta sync hit artifacts limit, performing full sync for completeness');
            performFullInvalidation();
            return {
                result: 'full',
                fallbackReason: 'artifacts_limit',
                updatesProcessed,
            };
        }

        // Delta sync successful - invalidate non-delta syncs
        log?.('🔌 Delta sync complete, invalidating non-delta syncs');
        invalidateNonDeltaSyncs();

        return {
            result: 'delta',
            updatesProcessed,
        };
    } catch (error) {
        // Network error or timeout
        const isTimeout = error instanceof Error &&
            (error.message.includes('timeout') || error.message.includes('Timeout'));

        log?.('🔌 Delta sync request failed, falling back to full sync: ' + String(error));
        performFullInvalidation();

        return {
            result: 'full',
            fallbackReason: isTimeout ? 'timeout' : 'network_error',
            updatesProcessed: 0,
        };
    }
}
