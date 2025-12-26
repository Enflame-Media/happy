/**
 * Delta Sync Orchestrator Integration Tests (HAP-558)
 *
 * Comprehensive tests for the requestDeltaSync reconnection flow.
 * Uses dependency injection (Option A) for pure unit testing without
 * requiring WebSocket mocking or class instantiation.
 *
 * Mocking Strategy: Option A (Extract to Testable Module)
 * - All dependencies are injected via the DeltaSyncDependencies interface
 * - Tests verify behavior through mock function calls and return values
 * - No module mocking required - pure function testing
 *
 * Test Categories:
 * 1. Seq number transmission - verifies correct seq numbers are sent
 * 2. Fresh connection detection - verifies fallback when all seqs are 0
 * 3. Error handling - verifies fallback on various error conditions
 * 4. Limit threshold fallback - verifies fallback when counts exceed limits
 * 5. Update processing - verifies updates are processed correctly
 * 6. Non-delta sync invalidation - verifies correct syncs are invalidated
 *
 * @module sync/deltaSyncOrchestrator.test
 * @see HAP-441 - Delta sync implementation
 * @see HAP-486 - Unit tests for delta sync utilities
 * @see HAP-558 - Integration tests for delta sync orchestration
 */

import { describe, it, expect, vi } from 'vitest';
import {
    orchestrateDeltaSync,
    type DeltaSyncDependencies,
    type DeltaSyncResponse,
    type DeltaSyncUpdate,
    DELTA_SYNC_LIMITS,
    DELTA_SYNC_TIMEOUT_MS,
} from './deltaSyncOrchestrator';

/**
 * Creates a mock DeltaSyncDependencies object with configurable defaults.
 * All functions are vi.fn() mocks for assertion and can be overridden.
 */
function createMockDependencies(
    overrides: Partial<DeltaSyncDependencies> = {}
): DeltaSyncDependencies {
    return {
        getSeq: vi.fn((_entityType) => {
            // Default: return 0 for all entity types (fresh connection)
            return 0;
        }),
        emitWithAck: vi.fn().mockResolvedValue({
            success: true,
            updates: [],
            counts: { sessions: 0, machines: 0, artifacts: 0 },
        }),
        handleUpdate: vi.fn().mockResolvedValue(undefined),
        performFullInvalidation: vi.fn(),
        invalidateNonDeltaSyncs: vi.fn(),
        log: vi.fn(),
        ...overrides,
    };
}

/**
 * Creates a mock successful DeltaSyncResponse.
 */
function createSuccessResponse(
    overrides: Partial<DeltaSyncResponse> = {}
): DeltaSyncResponse {
    return {
        success: true,
        updates: [],
        counts: { sessions: 0, machines: 0, artifacts: 0 },
        ...overrides,
    };
}

/**
 * Creates a mock update for testing.
 */
function createMockUpdate(
    overrides: Partial<DeltaSyncUpdate> = {}
): DeltaSyncUpdate {
    return {
        type: 'update-session',
        data: { id: 'test-session-id' },
        seq: 1,
        createdAt: Date.now(),
        ...overrides,
    };
}

describe('Delta Sync Orchestrator (HAP-558)', () => {
    describe('seq number transmission', () => {
        it('should send correct seq numbers via emitWithAck', async () => {
            const deps = createMockDependencies({
                getSeq: vi.fn((entityType) => {
                    if (entityType === 'sessions') return 10;
                    if (entityType === 'machines') return 20;
                    if (entityType === 'artifacts') return 30;
                    return 0;
                }),
            });

            await orchestrateDeltaSync(deps);

            expect(deps.emitWithAck).toHaveBeenCalledWith(
                'request-updates-since',
                {
                    sessions: 10,
                    machines: 20,
                    artifacts: 30,
                },
                DELTA_SYNC_TIMEOUT_MS
            );
        });

        it('should use 10 second timeout for delta sync request', async () => {
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1), // Non-zero to avoid fresh connection detection
            });

            await orchestrateDeltaSync(deps);

            expect(deps.emitWithAck).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(Object),
                10000 // 10 seconds
            );
            expect(DELTA_SYNC_TIMEOUT_MS).toBe(10000);
        });

        it('should call getSeq for all three entity types', async () => {
            const getSeqMock = vi.fn(() => 1);
            const deps = createMockDependencies({ getSeq: getSeqMock });

            await orchestrateDeltaSync(deps);

            expect(getSeqMock).toHaveBeenCalledWith('sessions');
            expect(getSeqMock).toHaveBeenCalledWith('machines');
            expect(getSeqMock).toHaveBeenCalledWith('artifacts');
            expect(getSeqMock).toHaveBeenCalledTimes(3);
        });
    });

    describe('fresh connection detection', () => {
        it('should fallback to full sync when all seqs are 0', async () => {
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 0), // All seqs are 0
            });

            const result = await orchestrateDeltaSync(deps);

            expect(result.result).toBe('full');
            expect(result.fallbackReason).toBe('fresh_connection');
            expect(result.updatesProcessed).toBe(0);
            expect(deps.performFullInvalidation).toHaveBeenCalledOnce();
        });

        it('should NOT call emitWithAck when all seqs are 0', async () => {
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 0),
            });

            await orchestrateDeltaSync(deps);

            expect(deps.emitWithAck).not.toHaveBeenCalled();
        });

        it('should NOT call invalidateNonDeltaSyncs when falling back to full sync', async () => {
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 0),
            });

            await orchestrateDeltaSync(deps);

            expect(deps.invalidateNonDeltaSyncs).not.toHaveBeenCalled();
        });

        it('should proceed with delta sync if any seq is non-zero', async () => {
            const deps = createMockDependencies({
                getSeq: vi.fn((entityType) => {
                    // Only sessions has data
                    return entityType === 'sessions' ? 5 : 0;
                }),
            });

            await orchestrateDeltaSync(deps);

            expect(deps.emitWithAck).toHaveBeenCalled();
            expect(deps.performFullInvalidation).not.toHaveBeenCalled();
        });

        it('should log fresh connection message', async () => {
            const logMock = vi.fn();
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 0),
                log: logMock,
            });

            await orchestrateDeltaSync(deps);

            expect(logMock).toHaveBeenCalledWith(
                expect.stringContaining('No previous seq data')
            );
        });
    });

    describe('error handling', () => {
        it('should fallback to full sync on error response (success: false)', async () => {
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                emitWithAck: vi.fn().mockResolvedValue({
                    success: false,
                    error: 'Server error',
                }),
            });

            const result = await orchestrateDeltaSync(deps);

            expect(result.result).toBe('full');
            expect(result.fallbackReason).toBe('error_response');
            expect(deps.performFullInvalidation).toHaveBeenCalledOnce();
            expect(deps.invalidateNonDeltaSyncs).not.toHaveBeenCalled();
        });

        it('should fallback to full sync on emitWithAck timeout', async () => {
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                emitWithAck: vi.fn().mockRejectedValue(new Error('Request timeout')),
            });

            const result = await orchestrateDeltaSync(deps);

            expect(result.result).toBe('full');
            expect(result.fallbackReason).toBe('timeout');
            expect(deps.performFullInvalidation).toHaveBeenCalledOnce();
        });

        it('should fallback to full sync on emitWithAck network error', async () => {
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                emitWithAck: vi.fn().mockRejectedValue(new Error('Network error')),
            });

            const result = await orchestrateDeltaSync(deps);

            expect(result.result).toBe('full');
            expect(result.fallbackReason).toBe('network_error');
            expect(deps.performFullInvalidation).toHaveBeenCalledOnce();
        });

        it('should detect timeout errors by message content', async () => {
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                emitWithAck: vi.fn().mockRejectedValue(new Error('Timeout waiting for ack')),
            });

            const result = await orchestrateDeltaSync(deps);

            expect(result.fallbackReason).toBe('timeout');
        });

        it('should log error message on network failure', async () => {
            const logMock = vi.fn();
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                emitWithAck: vi.fn().mockRejectedValue(new Error('Connection refused')),
                log: logMock,
            });

            await orchestrateDeltaSync(deps);

            expect(logMock).toHaveBeenCalledWith(
                expect.stringContaining('Delta sync request failed')
            );
        });
    });

    describe('limit threshold fallback', () => {
        it('should fallback to full sync when sessions count >= 100', async () => {
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                emitWithAck: vi.fn().mockResolvedValue(
                    createSuccessResponse({
                        counts: { sessions: 100, machines: 0, artifacts: 0 },
                    })
                ),
            });

            const result = await orchestrateDeltaSync(deps);

            expect(result.result).toBe('full');
            expect(result.fallbackReason).toBe('sessions_limit');
            expect(deps.performFullInvalidation).toHaveBeenCalledOnce();
        });

        it('should fallback to full sync when machines count >= 50', async () => {
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                emitWithAck: vi.fn().mockResolvedValue(
                    createSuccessResponse({
                        counts: { sessions: 0, machines: 50, artifacts: 0 },
                    })
                ),
            });

            const result = await orchestrateDeltaSync(deps);

            expect(result.result).toBe('full');
            expect(result.fallbackReason).toBe('machines_limit');
            expect(deps.performFullInvalidation).toHaveBeenCalledOnce();
        });

        it('should fallback to full sync when artifacts count >= 100', async () => {
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                emitWithAck: vi.fn().mockResolvedValue(
                    createSuccessResponse({
                        counts: { sessions: 0, machines: 0, artifacts: 100 },
                    })
                ),
            });

            const result = await orchestrateDeltaSync(deps);

            expect(result.result).toBe('full');
            expect(result.fallbackReason).toBe('artifacts_limit');
            expect(deps.performFullInvalidation).toHaveBeenCalledOnce();
        });

        it('should NOT fallback when all counts are below limits', async () => {
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                emitWithAck: vi.fn().mockResolvedValue(
                    createSuccessResponse({
                        counts: { sessions: 99, machines: 49, artifacts: 99 },
                    })
                ),
            });

            const result = await orchestrateDeltaSync(deps);

            expect(result.result).toBe('delta');
            expect(result.fallbackReason).toBeUndefined();
            expect(deps.performFullInvalidation).not.toHaveBeenCalled();
        });

        it('should use correct limit constants', () => {
            expect(DELTA_SYNC_LIMITS.sessions).toBe(100);
            expect(DELTA_SYNC_LIMITS.machines).toBe(50);
            expect(DELTA_SYNC_LIMITS.artifacts).toBe(100);
        });

        it('should process updates before checking limits', async () => {
            const handleUpdateMock = vi.fn().mockResolvedValue(undefined);
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                handleUpdate: handleUpdateMock,
                emitWithAck: vi.fn().mockResolvedValue(
                    createSuccessResponse({
                        updates: [createMockUpdate({ seq: 1 }), createMockUpdate({ seq: 2 })],
                        counts: { sessions: 100, machines: 0, artifacts: 0 }, // Will trigger limit fallback
                    })
                ),
            });

            const result = await orchestrateDeltaSync(deps);

            // Updates should still be processed before fallback
            expect(handleUpdateMock).toHaveBeenCalledTimes(2);
            expect(result.updatesProcessed).toBe(2);
            expect(result.fallbackReason).toBe('sessions_limit');
        });
    });

    describe('update processing', () => {
        it('should call handleUpdate for each update in response', async () => {
            const handleUpdateMock = vi.fn().mockResolvedValue(undefined);
            const updates = [
                createMockUpdate({ seq: 1, type: 'update-session' }),
                createMockUpdate({ seq: 2, type: 'new-machine' }),
                createMockUpdate({ seq: 3, type: 'update-artifact' }),
            ];

            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                handleUpdate: handleUpdateMock,
                emitWithAck: vi.fn().mockResolvedValue(
                    createSuccessResponse({ updates })
                ),
            });

            const result = await orchestrateDeltaSync(deps);

            expect(handleUpdateMock).toHaveBeenCalledTimes(3);
            expect(result.updatesProcessed).toBe(3);
        });

        it('should wrap updates in correct container format', async () => {
            const handleUpdateMock = vi.fn().mockResolvedValue(undefined);
            const update = createMockUpdate({
                seq: 42,
                createdAt: 1234567890,
                data: { id: 'test-id', status: 'active' },
            });

            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                handleUpdate: handleUpdateMock,
                emitWithAck: vi.fn().mockResolvedValue(
                    createSuccessResponse({ updates: [update] })
                ),
            });

            await orchestrateDeltaSync(deps);

            expect(handleUpdateMock).toHaveBeenCalledWith({
                seq: 42,
                createdAt: 1234567890,
                body: { id: 'test-id', status: 'active' },
            });
        });

        it('should process updates in order', async () => {
            const callOrder: number[] = [];
            const handleUpdateMock = vi.fn().mockImplementation(async (update) => {
                callOrder.push(update.seq);
            });

            const updates = [
                createMockUpdate({ seq: 1 }),
                createMockUpdate({ seq: 2 }),
                createMockUpdate({ seq: 3 }),
            ];

            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                handleUpdate: handleUpdateMock,
                emitWithAck: vi.fn().mockResolvedValue(
                    createSuccessResponse({ updates })
                ),
            });

            await orchestrateDeltaSync(deps);

            expect(callOrder).toEqual([1, 2, 3]);
        });

        it('should handle empty updates array', async () => {
            const handleUpdateMock = vi.fn().mockResolvedValue(undefined);
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                handleUpdate: handleUpdateMock,
                emitWithAck: vi.fn().mockResolvedValue(
                    createSuccessResponse({ updates: [] })
                ),
            });

            const result = await orchestrateDeltaSync(deps);

            expect(handleUpdateMock).not.toHaveBeenCalled();
            expect(result.updatesProcessed).toBe(0);
            expect(result.result).toBe('delta');
        });

        it('should handle undefined updates', async () => {
            const handleUpdateMock = vi.fn().mockResolvedValue(undefined);
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                handleUpdate: handleUpdateMock,
                emitWithAck: vi.fn().mockResolvedValue(
                    createSuccessResponse({ updates: undefined })
                ),
            });

            const result = await orchestrateDeltaSync(deps);

            expect(handleUpdateMock).not.toHaveBeenCalled();
            expect(result.updatesProcessed).toBe(0);
        });
    });

    describe('non-delta sync invalidation', () => {
        it('should invalidate non-delta syncs on success', async () => {
            const invalidateNonDeltaSyncsMock = vi.fn();
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                invalidateNonDeltaSyncs: invalidateNonDeltaSyncsMock,
            });

            await orchestrateDeltaSync(deps);

            expect(invalidateNonDeltaSyncsMock).toHaveBeenCalledOnce();
        });

        it('should NOT invalidate when falling back to full sync due to error', async () => {
            const invalidateNonDeltaSyncsMock = vi.fn();
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                invalidateNonDeltaSyncs: invalidateNonDeltaSyncsMock,
                emitWithAck: vi.fn().mockResolvedValue({ success: false }),
            });

            await orchestrateDeltaSync(deps);

            expect(invalidateNonDeltaSyncsMock).not.toHaveBeenCalled();
        });

        it('should NOT invalidate when falling back due to limits', async () => {
            const invalidateNonDeltaSyncsMock = vi.fn();
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                invalidateNonDeltaSyncs: invalidateNonDeltaSyncsMock,
                emitWithAck: vi.fn().mockResolvedValue(
                    createSuccessResponse({
                        counts: { sessions: 100, machines: 0, artifacts: 0 },
                    })
                ),
            });

            await orchestrateDeltaSync(deps);

            expect(invalidateNonDeltaSyncsMock).not.toHaveBeenCalled();
        });

        it('should NOT invalidate when falling back due to fresh connection', async () => {
            const invalidateNonDeltaSyncsMock = vi.fn();
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 0),
                invalidateNonDeltaSyncs: invalidateNonDeltaSyncsMock,
            });

            await orchestrateDeltaSync(deps);

            expect(invalidateNonDeltaSyncsMock).not.toHaveBeenCalled();
        });

        it('should NOT invalidate when falling back due to network error', async () => {
            const invalidateNonDeltaSyncsMock = vi.fn();
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                invalidateNonDeltaSyncs: invalidateNonDeltaSyncsMock,
                emitWithAck: vi.fn().mockRejectedValue(new Error('Network error')),
            });

            await orchestrateDeltaSync(deps);

            expect(invalidateNonDeltaSyncsMock).not.toHaveBeenCalled();
        });
    });

    describe('result reporting', () => {
        it('should return delta result on success', async () => {
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
            });

            const result = await orchestrateDeltaSync(deps);

            expect(result.result).toBe('delta');
            expect(result.fallbackReason).toBeUndefined();
        });

        it('should return correct updatesProcessed count', async () => {
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                emitWithAck: vi.fn().mockResolvedValue(
                    createSuccessResponse({
                        updates: [
                            createMockUpdate({ seq: 1 }),
                            createMockUpdate({ seq: 2 }),
                            createMockUpdate({ seq: 3 }),
                            createMockUpdate({ seq: 4 }),
                            createMockUpdate({ seq: 5 }),
                        ],
                    })
                ),
            });

            const result = await orchestrateDeltaSync(deps);

            expect(result.updatesProcessed).toBe(5);
        });

        it('should return full result with reason on fresh connection', async () => {
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 0),
            });

            const result = await orchestrateDeltaSync(deps);

            expect(result).toEqual({
                result: 'full',
                fallbackReason: 'fresh_connection',
                updatesProcessed: 0,
            });
        });

        it('should return full result with reason on error response', async () => {
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                emitWithAck: vi.fn().mockResolvedValue({ success: false }),
            });

            const result = await orchestrateDeltaSync(deps);

            expect(result).toEqual({
                result: 'full',
                fallbackReason: 'error_response',
                updatesProcessed: 0,
            });
        });
    });

    describe('logging', () => {
        it('should log seq numbers when starting delta sync', async () => {
            const logMock = vi.fn();
            const deps = createMockDependencies({
                getSeq: vi.fn((entityType) => {
                    if (entityType === 'sessions') return 10;
                    if (entityType === 'machines') return 20;
                    if (entityType === 'artifacts') return 30;
                    return 0;
                }),
                log: logMock,
            });

            await orchestrateDeltaSync(deps);

            expect(logMock).toHaveBeenCalledWith(
                expect.stringContaining('sessions=10')
            );
            expect(logMock).toHaveBeenCalledWith(
                expect.stringContaining('machines=20')
            );
            expect(logMock).toHaveBeenCalledWith(
                expect.stringContaining('artifacts=30')
            );
        });

        it('should log received counts', async () => {
            const logMock = vi.fn();
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                log: logMock,
                emitWithAck: vi.fn().mockResolvedValue(
                    createSuccessResponse({
                        counts: { sessions: 5, machines: 3, artifacts: 2 },
                    })
                ),
            });

            await orchestrateDeltaSync(deps);

            expect(logMock).toHaveBeenCalledWith(
                expect.stringContaining('sessions=5')
            );
        });

        it('should log completion message on success', async () => {
            const logMock = vi.fn();
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                log: logMock,
            });

            await orchestrateDeltaSync(deps);

            expect(logMock).toHaveBeenCalledWith(
                expect.stringContaining('Delta sync complete')
            );
        });

        it('should work without log function', async () => {
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                log: undefined,
            });

            // Should not throw
            await expect(orchestrateDeltaSync(deps)).resolves.not.toThrow();
        });
    });

    describe('edge cases', () => {
        it('should handle response with null counts', async () => {
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                emitWithAck: vi.fn().mockResolvedValue({
                    success: true,
                    updates: [],
                    counts: null,
                }),
            });

            const result = await orchestrateDeltaSync(deps);

            expect(result.result).toBe('delta');
        });

        it('should handle response with undefined counts', async () => {
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                emitWithAck: vi.fn().mockResolvedValue({
                    success: true,
                    updates: [],
                }),
            });

            const result = await orchestrateDeltaSync(deps);

            expect(result.result).toBe('delta');
        });

        it('should handle response with partial counts', async () => {
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                emitWithAck: vi.fn().mockResolvedValue({
                    success: true,
                    updates: [],
                    counts: { sessions: 5 }, // Missing machines and artifacts
                }),
            });

            const result = await orchestrateDeltaSync(deps);

            expect(result.result).toBe('delta');
        });

        it('should handle very large seq numbers', async () => {
            const largeSeq = Number.MAX_SAFE_INTEGER;
            const deps = createMockDependencies({
                getSeq: vi.fn(() => largeSeq),
            });

            await orchestrateDeltaSync(deps);

            expect(deps.emitWithAck).toHaveBeenCalledWith(
                'request-updates-since',
                {
                    sessions: largeSeq,
                    machines: largeSeq,
                    artifacts: largeSeq,
                },
                expect.any(Number)
            );
        });

        it('should handle update with minimal data', async () => {
            const handleUpdateMock = vi.fn().mockResolvedValue(undefined);
            const deps = createMockDependencies({
                getSeq: vi.fn(() => 1),
                handleUpdate: handleUpdateMock,
                emitWithAck: vi.fn().mockResolvedValue(
                    createSuccessResponse({
                        updates: [{
                            type: 'update-session',
                            data: null,
                            seq: 0,
                            createdAt: 0,
                        }],
                    })
                ),
            });

            await orchestrateDeltaSync(deps);

            expect(handleUpdateMock).toHaveBeenCalledWith({
                seq: 0,
                createdAt: 0,
                body: null,
            });
        });
    });
});
