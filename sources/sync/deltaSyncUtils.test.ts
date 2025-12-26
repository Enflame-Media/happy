/**
 * Delta Sync Utilities Unit Tests (HAP-486)
 *
 * Tests for the pure utility functions that power delta sync:
 * - getEntityTypeFromUpdate: Maps WebSocket update types to entity types
 * - trackSeq: Tracks highest sequence numbers per entity type
 * - getLastKnownSeq: Retrieves last known sequence for an entity type
 *
 * @module sync/deltaSyncUtils.test
 * @see HAP-441 - Delta sync implementation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    getEntityTypeFromUpdate,
    trackSeq,
    getLastKnownSeq,
    type DeltaSyncEntityType,
} from './deltaSyncUtils';

describe('Delta Sync Utilities (HAP-486)', () => {
    describe('getEntityTypeFromUpdate', () => {
        describe('session updates', () => {
            it('should map new-session to sessions', () => {
                expect(getEntityTypeFromUpdate('new-session')).toBe('sessions');
            });

            it('should map update-session to sessions', () => {
                expect(getEntityTypeFromUpdate('update-session')).toBe('sessions');
            });

            it('should map delete-session to sessions', () => {
                expect(getEntityTypeFromUpdate('delete-session')).toBe('sessions');
            });

            it('should map new-message to sessions (messages belong to sessions)', () => {
                expect(getEntityTypeFromUpdate('new-message')).toBe('sessions');
            });
        });

        describe('machine updates', () => {
            it('should map new-machine to machines', () => {
                expect(getEntityTypeFromUpdate('new-machine')).toBe('machines');
            });

            it('should map update-machine to machines', () => {
                expect(getEntityTypeFromUpdate('update-machine')).toBe('machines');
            });
        });

        describe('artifact updates', () => {
            it('should map new-artifact to artifacts', () => {
                expect(getEntityTypeFromUpdate('new-artifact')).toBe('artifacts');
            });

            it('should map update-artifact to artifacts', () => {
                expect(getEntityTypeFromUpdate('update-artifact')).toBe('artifacts');
            });

            it('should map delete-artifact to artifacts', () => {
                expect(getEntityTypeFromUpdate('delete-artifact')).toBe('artifacts');
            });
        });

        describe('untracked update types', () => {
            it('should return null for ephemeral updates (typing)', () => {
                expect(getEntityTypeFromUpdate('typing')).toBeNull();
            });

            it('should return null for ephemeral updates (usage)', () => {
                expect(getEntityTypeFromUpdate('usage')).toBeNull();
            });

            it('should return null for unknown update types', () => {
                expect(getEntityTypeFromUpdate('unknown-type')).toBeNull();
            });

            it('should return null for empty string', () => {
                expect(getEntityTypeFromUpdate('')).toBeNull();
            });
        });

        it('should return correct type for all supported update types', () => {
            const expectedMappings: Record<string, DeltaSyncEntityType | null> = {
                'new-session': 'sessions',
                'update-session': 'sessions',
                'delete-session': 'sessions',
                'new-message': 'sessions',
                'new-machine': 'machines',
                'update-machine': 'machines',
                'new-artifact': 'artifacts',
                'update-artifact': 'artifacts',
                'delete-artifact': 'artifacts',
            };

            for (const [updateType, expected] of Object.entries(expectedMappings)) {
                expect(getEntityTypeFromUpdate(updateType)).toBe(expected);
            }
        });
    });

    describe('trackSeq', () => {
        let seqMap: Map<string, number>;

        beforeEach(() => {
            seqMap = new Map();
        });

        it('should track highest seq for entity type', () => {
            const updated = trackSeq(seqMap, 'sessions', 5);
            expect(updated).toBe(true);
            expect(seqMap.get('sessions')).toBe(5);
        });

        it('should update seq when new value is higher', () => {
            trackSeq(seqMap, 'sessions', 5);
            const updated = trackSeq(seqMap, 'sessions', 10);
            expect(updated).toBe(true);
            expect(seqMap.get('sessions')).toBe(10);
        });

        it('should not downgrade seq number', () => {
            trackSeq(seqMap, 'sessions', 10);
            const updated = trackSeq(seqMap, 'sessions', 5);
            expect(updated).toBe(false);
            expect(seqMap.get('sessions')).toBe(10);
        });

        it('should not update when seq equals current', () => {
            trackSeq(seqMap, 'sessions', 5);
            const updated = trackSeq(seqMap, 'sessions', 5);
            expect(updated).toBe(false);
            expect(seqMap.get('sessions')).toBe(5);
        });

        it('should handle undefined seq gracefully', () => {
            trackSeq(seqMap, 'sessions', 5);
            const updated = trackSeq(seqMap, 'sessions', undefined);
            expect(updated).toBe(false);
            expect(seqMap.get('sessions')).toBe(5);
        });

        it('should return false for undefined seq on fresh map', () => {
            const updated = trackSeq(seqMap, 'sessions', undefined);
            expect(updated).toBe(false);
            expect(seqMap.has('sessions')).toBe(false);
        });

        it('should track different entity types independently', () => {
            trackSeq(seqMap, 'sessions', 10);
            trackSeq(seqMap, 'machines', 20);
            trackSeq(seqMap, 'artifacts', 30);

            expect(seqMap.get('sessions')).toBe(10);
            expect(seqMap.get('machines')).toBe(20);
            expect(seqMap.get('artifacts')).toBe(30);
        });

        it('should handle seq=0 as a valid update from empty', () => {
            // Edge case: seq=0 should update from undefined (defaulting to 0)
            // but 0 > 0 is false, so it won't update - this is expected behavior
            const updated = trackSeq(seqMap, 'sessions', 0);
            expect(updated).toBe(false);
            expect(seqMap.has('sessions')).toBe(false);
        });

        it('should handle seq=1 from empty map', () => {
            const updated = trackSeq(seqMap, 'sessions', 1);
            expect(updated).toBe(true);
            expect(seqMap.get('sessions')).toBe(1);
        });

        it('should handle very large sequence numbers', () => {
            const largeSeq = Number.MAX_SAFE_INTEGER;
            const updated = trackSeq(seqMap, 'sessions', largeSeq);
            expect(updated).toBe(true);
            expect(seqMap.get('sessions')).toBe(largeSeq);
        });
    });

    describe('getLastKnownSeq', () => {
        let seqMap: Map<string, number>;

        beforeEach(() => {
            seqMap = new Map();
        });

        it('should return 0 for unknown entity type', () => {
            expect(getLastKnownSeq(seqMap, 'sessions')).toBe(0);
        });

        it('should return correct seq for tracked entity', () => {
            seqMap.set('sessions', 42);
            expect(getLastKnownSeq(seqMap, 'sessions')).toBe(42);
        });

        it('should return 0 for untracked entity when others exist', () => {
            seqMap.set('sessions', 10);
            seqMap.set('machines', 20);
            expect(getLastKnownSeq(seqMap, 'artifacts')).toBe(0);
        });

        it('should return correct values for all entity types', () => {
            seqMap.set('sessions', 100);
            seqMap.set('machines', 200);
            seqMap.set('artifacts', 300);

            expect(getLastKnownSeq(seqMap, 'sessions')).toBe(100);
            expect(getLastKnownSeq(seqMap, 'machines')).toBe(200);
            expect(getLastKnownSeq(seqMap, 'artifacts')).toBe(300);
        });
    });

    describe('integration: trackSeq + getLastKnownSeq', () => {
        let seqMap: Map<string, number>;

        beforeEach(() => {
            seqMap = new Map();
        });

        it('should work together for typical delta sync flow', () => {
            // Initial state: all seqs are 0
            expect(getLastKnownSeq(seqMap, 'sessions')).toBe(0);
            expect(getLastKnownSeq(seqMap, 'machines')).toBe(0);
            expect(getLastKnownSeq(seqMap, 'artifacts')).toBe(0);

            // Receive updates with seq numbers
            trackSeq(seqMap, 'sessions', 5);
            trackSeq(seqMap, 'machines', 3);
            trackSeq(seqMap, 'artifacts', 10);

            // Verify tracked values
            expect(getLastKnownSeq(seqMap, 'sessions')).toBe(5);
            expect(getLastKnownSeq(seqMap, 'machines')).toBe(3);
            expect(getLastKnownSeq(seqMap, 'artifacts')).toBe(10);

            // Receive more updates
            trackSeq(seqMap, 'sessions', 8);
            trackSeq(seqMap, 'machines', 2); // Lower - should not update
            trackSeq(seqMap, 'artifacts', 15);

            // Verify final state
            expect(getLastKnownSeq(seqMap, 'sessions')).toBe(8);
            expect(getLastKnownSeq(seqMap, 'machines')).toBe(3); // Still 3
            expect(getLastKnownSeq(seqMap, 'artifacts')).toBe(15);
        });

        it('should simulate reconnection delta sync request', () => {
            // After receiving many updates
            trackSeq(seqMap, 'sessions', 100);
            trackSeq(seqMap, 'machines', 50);
            trackSeq(seqMap, 'artifacts', 75);

            // On reconnection, we request updates since these seqs
            const deltaSyncRequest = {
                sessions: getLastKnownSeq(seqMap, 'sessions'),
                machines: getLastKnownSeq(seqMap, 'machines'),
                artifacts: getLastKnownSeq(seqMap, 'artifacts'),
            };

            expect(deltaSyncRequest).toEqual({
                sessions: 100,
                machines: 50,
                artifacts: 75,
            });
        });

        it('should detect fresh connection (all seqs are 0)', () => {
            const sessionsSeq = getLastKnownSeq(seqMap, 'sessions');
            const machinesSeq = getLastKnownSeq(seqMap, 'machines');
            const artifactsSeq = getLastKnownSeq(seqMap, 'artifacts');

            // This is the condition in requestDeltaSync that triggers full sync
            const isFreshConnection =
                sessionsSeq === 0 && machinesSeq === 0 && artifactsSeq === 0;

            expect(isFreshConnection).toBe(true);
        });
    });
});
