import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    getValidationStats,
    resetValidationStats,
    flushValidationMetrics,
    startValidationMetricsReporting,
    stopValidationMetricsReporting,
    normalizeRawMessage,
} from './typesRaw';

// Mock the apiAnalytics module
vi.mock('./apiAnalytics', () => ({
    reportValidationMetrics: vi.fn(),
}));

import { reportValidationMetrics } from './apiAnalytics';

describe('Validation Metrics (HAP-577)', () => {
    beforeEach(() => {
        // Reset stats before each test
        resetValidationStats();
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        // Stop any running reporting intervals
        stopValidationMetricsReporting();
        vi.useRealTimers();
    });

    describe('getValidationStats', () => {
        it('should return initial zero stats', () => {
            const stats = getValidationStats();
            expect(stats.schemaFailures).toBe(0);
            expect(stats.unknownTypes).toBe(0);
            expect(stats.strictValidationFailures).toBe(0);
            expect(stats.unknownTypeBreakdown).toEqual({});
            expect(stats.firstFailureAt).toBeNull();
            expect(stats.lastFailureAt).toBeNull();
        });

        it('should return a copy (Readonly type prevents mutation at compile time)', () => {
            const stats = getValidationStats();
            // Readonly<T> is a compile-time check only - at runtime, JavaScript objects
            // don't enforce immutability. This test verifies we get separate copies.
            const stats2 = getValidationStats();
            expect(stats).not.toBe(stats2); // Different object references
        });

        it('should return a copy, not a reference', () => {
            const stats1 = getValidationStats();
            const stats2 = getValidationStats();
            expect(stats1).not.toBe(stats2);
            expect(stats1.unknownTypeBreakdown).not.toBe(stats2.unknownTypeBreakdown);
        });
    });

    describe('resetValidationStats', () => {
        it('should reset all stats to initial values', () => {
            // Trigger some failures first
            normalizeRawMessage('id1', null, Date.now(), { role: 'invalid' } as any);

            const beforeReset = getValidationStats();
            expect(beforeReset.schemaFailures).toBeGreaterThan(0);

            resetValidationStats();

            const afterReset = getValidationStats();
            expect(afterReset.schemaFailures).toBe(0);
            expect(afterReset.unknownTypes).toBe(0);
            expect(afterReset.strictValidationFailures).toBe(0);
            expect(afterReset.unknownTypeBreakdown).toEqual({});
            expect(afterReset.firstFailureAt).toBeNull();
            expect(afterReset.lastFailureAt).toBeNull();
        });
    });

    describe('normalizeRawMessage - validation tracking', () => {
        it('should track schema validation failures', () => {
            // Pass an invalid record that fails schema validation
            normalizeRawMessage('id1', null, Date.now(), { role: 'invalid' } as any);

            const stats = getValidationStats();
            expect(stats.schemaFailures).toBe(1);
            expect(stats.firstFailureAt).not.toBeNull();
            expect(stats.lastFailureAt).not.toBeNull();
        });

        it('should track unknown type encounters', () => {
            // Create a valid agent record with an unknown output type
            const unknownTypeRecord = {
                role: 'agent' as const,
                content: {
                    type: 'output' as const,
                    data: {
                        type: 'thinking', // Unknown type
                        uuid: 'test-uuid',
                    },
                },
            };

            normalizeRawMessage('id1', null, Date.now(), unknownTypeRecord as any);

            const stats = getValidationStats();
            expect(stats.unknownTypes).toBe(1);
            expect(stats.unknownTypeBreakdown['thinking']).toBe(1);
        });

        it('should aggregate unknown type breakdown', () => {
            const createUnknownRecord = (typeName: string) => ({
                role: 'agent' as const,
                content: {
                    type: 'output' as const,
                    data: {
                        type: typeName,
                        uuid: 'test-uuid',
                    },
                },
            });

            normalizeRawMessage('id1', null, Date.now(), createUnknownRecord('thinking') as any);
            normalizeRawMessage('id2', null, Date.now(), createUnknownRecord('thinking') as any);
            normalizeRawMessage('id3', null, Date.now(), createUnknownRecord('status') as any);

            const stats = getValidationStats();
            expect(stats.unknownTypes).toBe(3);
            expect(stats.unknownTypeBreakdown['thinking']).toBe(2);
            expect(stats.unknownTypeBreakdown['status']).toBe(1);
        });

        it('should update timestamps correctly', () => {
            const now = Date.now();
            vi.setSystemTime(now);

            normalizeRawMessage('id1', null, now, { role: 'invalid' } as any);
            const stats1 = getValidationStats();
            expect(stats1.firstFailureAt).toBe(now);
            expect(stats1.lastFailureAt).toBe(now);

            // Advance time and trigger another failure
            vi.advanceTimersByTime(1000);
            normalizeRawMessage('id2', null, now + 1000, { role: 'invalid' } as any);

            const stats2 = getValidationStats();
            expect(stats2.firstFailureAt).toBe(now); // First should stay the same
            expect(stats2.lastFailureAt).toBe(now + 1000); // Last should update
        });
    });

    describe('flushValidationMetrics', () => {
        it('should not report when no failures exist', () => {
            flushValidationMetrics();
            expect(reportValidationMetrics).not.toHaveBeenCalled();
        });

        it('should report when failures exist', () => {
            normalizeRawMessage('id1', null, Date.now(), { role: 'invalid' } as any);

            flushValidationMetrics();

            expect(reportValidationMetrics).toHaveBeenCalledTimes(1);
            expect(reportValidationMetrics).toHaveBeenCalledWith(
                expect.objectContaining({
                    schemaFailures: 1,
                    unknownTypes: 0,
                    strictValidationFailures: 0,
                })
            );
        });

        it('should convert unknownTypeBreakdown to array format', () => {
            const createUnknownRecord = (typeName: string) => ({
                role: 'agent' as const,
                content: {
                    type: 'output' as const,
                    data: {
                        type: typeName,
                        uuid: 'test-uuid',
                    },
                },
            });

            normalizeRawMessage('id1', null, Date.now(), createUnknownRecord('thinking') as any);
            normalizeRawMessage('id2', null, Date.now(), createUnknownRecord('thinking') as any);

            flushValidationMetrics();

            expect(reportValidationMetrics).toHaveBeenCalledWith(
                expect.objectContaining({
                    unknownTypeBreakdown: [{ typeName: 'thinking', count: 2 }],
                })
            );
        });

        it('should reset stats after reporting', () => {
            normalizeRawMessage('id1', null, Date.now(), { role: 'invalid' } as any);
            flushValidationMetrics();

            const stats = getValidationStats();
            expect(stats.schemaFailures).toBe(0);
        });

        it('should not double-report when called twice without new failures', () => {
            normalizeRawMessage('id1', null, Date.now(), { role: 'invalid' } as any);
            flushValidationMetrics();
            flushValidationMetrics(); // Second call

            expect(reportValidationMetrics).toHaveBeenCalledTimes(1);
        });

        it('should include session duration in report', () => {
            const now = Date.now();
            vi.setSystemTime(now);

            // Trigger failure after some time
            vi.advanceTimersByTime(5000);
            normalizeRawMessage('id1', null, Date.now(), { role: 'invalid' } as any);

            flushValidationMetrics();

            expect(reportValidationMetrics).toHaveBeenCalledWith(
                expect.objectContaining({
                    sessionDurationMs: expect.any(Number),
                })
            );
        });
    });

    describe('startValidationMetricsReporting', () => {
        it('should start periodic reporting', () => {
            normalizeRawMessage('id1', null, Date.now(), { role: 'invalid' } as any);

            startValidationMetricsReporting();

            // Fast-forward 5 minutes
            vi.advanceTimersByTime(5 * 60 * 1000);

            expect(reportValidationMetrics).toHaveBeenCalledTimes(1);
        });

        it('should not start multiple intervals', () => {
            startValidationMetricsReporting();
            startValidationMetricsReporting();
            startValidationMetricsReporting();

            normalizeRawMessage('id1', null, Date.now(), { role: 'invalid' } as any);

            // Fast-forward 5 minutes
            vi.advanceTimersByTime(5 * 60 * 1000);

            // Should only have been called once, not three times
            expect(reportValidationMetrics).toHaveBeenCalledTimes(1);
        });

        it('should report when failures exist at interval', () => {
            // Add failures before starting
            normalizeRawMessage('id1', null, Date.now(), { role: 'invalid' } as any);

            startValidationMetricsReporting();

            // First interval - reports the failure
            vi.advanceTimersByTime(5 * 60 * 1000);
            expect(reportValidationMetrics).toHaveBeenCalledTimes(1);

            // Stats are reset after reporting - no new failures means no new report
            vi.advanceTimersByTime(5 * 60 * 1000);
            // Should still be 1 since there were no new failures
            expect(reportValidationMetrics).toHaveBeenCalledTimes(1);
        });
    });

    describe('stopValidationMetricsReporting', () => {
        it('should stop periodic reporting', () => {
            // Create failures first
            normalizeRawMessage('id1', null, Date.now(), { role: 'invalid' } as any);

            startValidationMetricsReporting();
            stopValidationMetricsReporting(); // This flushes existing failures

            // Flush should have been called once
            expect(reportValidationMetrics).toHaveBeenCalledTimes(1);
            vi.clearAllMocks();

            // New failures after stopping
            normalizeRawMessage('id2', null, Date.now(), { role: 'invalid' } as any);

            // Fast-forward 10 minutes - should not report since stopped
            vi.advanceTimersByTime(10 * 60 * 1000);

            // Should not have been called again (interval was stopped)
            expect(reportValidationMetrics).not.toHaveBeenCalled();
        });

        it('should flush pending metrics when stopped', () => {
            normalizeRawMessage('id1', null, Date.now(), { role: 'invalid' } as any);

            stopValidationMetricsReporting();

            expect(reportValidationMetrics).toHaveBeenCalledTimes(1);
        });

        it('should be safe to call multiple times', () => {
            stopValidationMetricsReporting();
            stopValidationMetricsReporting();
            stopValidationMetricsReporting();

            // Should not throw
            expect(true).toBe(true);
        });
    });
});
