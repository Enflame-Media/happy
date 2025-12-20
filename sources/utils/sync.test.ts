import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InvalidateSync, ValueSync } from './sync';

// Mock the backoff function to avoid delays in tests
vi.mock('@/utils/time', () => ({
    backoff: vi.fn(async (fn: () => Promise<void>) => {
        await fn();
    })
}));

describe('InvalidateSync', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('basic functionality', () => {
        it('should execute command on first invalidation', async () => {
            let syncCount = 0;
            const sync = new InvalidateSync(async () => {
                syncCount++;
            });

            sync.invalidate();

            // Allow async operations to complete
            await vi.runAllTimersAsync();

            expect(syncCount).toBe(1);
        });

        it('should not execute when stopped', async () => {
            let syncCount = 0;
            const sync = new InvalidateSync(async () => {
                syncCount++;
            });

            sync.stop();
            sync.invalidate();

            await vi.runAllTimersAsync();

            expect(syncCount).toBe(0);
        });

        it('should notify pendings after sync completes', async () => {
            let pendingResolved = false;
            const sync = new InvalidateSync(async () => {});

            const pendingPromise = sync.invalidateAndAwait().then(() => {
                pendingResolved = true;
            });

            await vi.runAllTimersAsync();
            await pendingPromise;

            expect(pendingResolved).toBe(true);
        });
    });

    describe('race condition fix - multiple rapid invalidations', () => {
        it('should handle 2 rapid invalidations during sync (baseline)', async () => {
            let syncCount = 0;
            let syncInProgress = false;

            const sync = new InvalidateSync(async () => {
                syncInProgress = true;
                syncCount++;
                // Simulate async work
                await new Promise(resolve => setTimeout(resolve, 100));
                syncInProgress = false;
            });

            // First invalidation starts sync
            sync.invalidate();

            // Wait for first sync to start
            await vi.advanceTimersByTimeAsync(10);
            expect(syncInProgress).toBe(true);

            // Second invalidation while first is in progress
            sync.invalidate();

            // Complete all syncs
            await vi.runAllTimersAsync();

            // Should have synced at least 2 times (initial + one for pending)
            expect(syncCount).toBeGreaterThanOrEqual(2);
        });

        it('should handle 5 rapid invalidations during sync without losing updates', async () => {
            let syncCount = 0;
            let syncInProgress = false;

            const sync = new InvalidateSync(async () => {
                syncInProgress = true;
                syncCount++;
                // Simulate async work
                await new Promise(resolve => setTimeout(resolve, 100));
                syncInProgress = false;
            });

            // First invalidation starts sync
            sync.invalidate();

            // Wait for first sync to start
            await vi.advanceTimersByTimeAsync(10);
            expect(syncInProgress).toBe(true);

            // 4 more rapid invalidations while first is in progress
            sync.invalidate();
            sync.invalidate();
            sync.invalidate();
            sync.invalidate();

            // Complete all syncs
            await vi.runAllTimersAsync();

            // With the fix: should sync at least 2 times (initial + collapsed pending)
            // The key is that we DO get a second sync to capture the latest state
            expect(syncCount).toBeGreaterThanOrEqual(2);
        });

        it('should collapse multiple pending invalidations to minimize syncs', async () => {
            let syncCount = 0;

            const sync = new InvalidateSync(async () => {
                syncCount++;
                await new Promise(resolve => setTimeout(resolve, 100));
            });

            // Start sync
            sync.invalidate();
            await vi.advanceTimersByTimeAsync(10);

            // 10 rapid invalidations
            for (let i = 0; i < 10; i++) {
                sync.invalidate();
            }

            await vi.runAllTimersAsync();

            // Should NOT sync 11 times - should collapse to a reasonable number
            // With the fix: 2 syncs (initial + 1 collapsed follow-up)
            expect(syncCount).toBeLessThanOrEqual(3);
            expect(syncCount).toBeGreaterThanOrEqual(2);
        });

        it('should await queue after multiple invalidations complete', async () => {
            let syncCount = 0;

            const sync = new InvalidateSync(async () => {
                syncCount++;
                await new Promise(resolve => setTimeout(resolve, 100));
            });

            // Trigger multiple invalidations
            sync.invalidate();
            await vi.advanceTimersByTimeAsync(10);
            sync.invalidate();
            sync.invalidate();
            sync.invalidate();

            // Await should wait for all syncs to complete
            const awaitPromise = sync.awaitQueue();

            await vi.runAllTimersAsync();
            await awaitPromise;

            expect(syncCount).toBeGreaterThanOrEqual(2);
        });

        it('should handle invalidations across multiple sync cycles', async () => {
            let syncCount = 0;

            const sync = new InvalidateSync(async () => {
                syncCount++;
                await new Promise(resolve => setTimeout(resolve, 50));
            });

            // First cycle: 1 invalidation
            sync.invalidate();
            await vi.runAllTimersAsync();
            expect(syncCount).toBe(1);

            // Second cycle: multiple invalidations
            sync.invalidate();
            await vi.advanceTimersByTimeAsync(10);
            sync.invalidate();
            sync.invalidate();
            await vi.runAllTimersAsync();

            // Total: 1 from first cycle + at least 2 from second cycle
            expect(syncCount).toBeGreaterThanOrEqual(3);
        });
    });

    describe('stop behavior', () => {
        it('should stop accepting invalidations after stop is called', async () => {
            let syncCount = 0;

            const sync = new InvalidateSync(async () => {
                syncCount++;
                await new Promise(resolve => setTimeout(resolve, 100));
            });

            sync.invalidate();
            await vi.advanceTimersByTimeAsync(10);

            // Stop while sync is in progress
            sync.stop();

            // These should be ignored
            sync.invalidate();
            sync.invalidate();

            await vi.runAllTimersAsync();

            expect(syncCount).toBe(1);
        });

        it('should notify pendings when stopped', async () => {
            let pendingResolved = false;

            const sync = new InvalidateSync(async () => {
                await new Promise(resolve => setTimeout(resolve, 100));
            });

            sync.invalidate();
            const pendingPromise = sync.awaitQueue().then(() => {
                pendingResolved = true;
            });

            await vi.advanceTimersByTimeAsync(10);
            sync.stop();

            await vi.runAllTimersAsync();
            await pendingPromise;

            expect(pendingResolved).toBe(true);
        });
    });

    describe('invalidateAndAwait', () => {
        it('should wait for sync to complete', async () => {
            let syncCompleted = false;

            const sync = new InvalidateSync(async () => {
                await new Promise(resolve => setTimeout(resolve, 100));
                syncCompleted = true;
            });

            const awaitPromise = sync.invalidateAndAwait();

            expect(syncCompleted).toBe(false);

            await vi.runAllTimersAsync();
            await awaitPromise;

            expect(syncCompleted).toBe(true);
        });

        it('should return immediately when stopped', async () => {
            let syncExecuted = false;
            const sync = new InvalidateSync(async () => {
                syncExecuted = true;
                await new Promise(resolve => setTimeout(resolve, 100));
            });

            sync.stop();

            // Should not throw or hang
            await sync.invalidateAndAwait();

            // Sync should not have been executed
            expect(syncExecuted).toBe(false);
        });
    });
});

describe('ValueSync', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('basic functionality', () => {
        it('should process value when set', async () => {
            let processedValues: number[] = [];

            const sync = new ValueSync<number>(async (value) => {
                processedValues.push(value);
            });

            sync.setValue(42);

            await vi.runAllTimersAsync();

            expect(processedValues).toEqual([42]);
        });

        it('should process latest value when multiple values set rapidly', async () => {
            let processedValues: number[] = [];

            const sync = new ValueSync<number>(async (value) => {
                processedValues.push(value);
                await new Promise(resolve => setTimeout(resolve, 100));
            });

            sync.setValue(1);
            await vi.advanceTimersByTimeAsync(10);
            sync.setValue(2);
            sync.setValue(3);
            sync.setValue(4);

            await vi.runAllTimersAsync();

            // Should process 1 (first) and 4 (latest)
            expect(processedValues).toContain(1);
            expect(processedValues[processedValues.length - 1]).toBe(4);
        });
    });
});
