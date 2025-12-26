/**
 * Delta Sync Utilities (HAP-486)
 *
 * Pure utility functions for delta sync logic, extracted for testability.
 * These functions map update types to entity types for sequence tracking.
 *
 * @module sync/deltaSyncUtils
 * @see HAP-441 - Delta sync implementation
 * @see HAP-486 - Unit tests for delta sync
 */

/**
 * Entity types that support sequence-based delta sync.
 * These correspond to database tables with `seq` columns.
 */
export type DeltaSyncEntityType = 'sessions' | 'machines' | 'artifacts';

/**
 * Map update types to their corresponding entity types for seq tracking.
 *
 * @param updateType - The update type from WebSocket message (e.g., 'new-session', 'update-machine')
 * @returns The entity type for seq tracking, or null if the update type is not tracked
 *
 * @example
 * getEntityTypeFromUpdate('new-session') // 'sessions'
 * getEntityTypeFromUpdate('update-machine') // 'machines'
 * getEntityTypeFromUpdate('typing') // null (not tracked)
 */
export function getEntityTypeFromUpdate(updateType: string): DeltaSyncEntityType | null {
    switch (updateType) {
        case 'new-session':
        case 'update-session':
        case 'delete-session':
        case 'new-message':
            return 'sessions';
        case 'new-machine':
        case 'update-machine':
            return 'machines';
        case 'new-artifact':
        case 'update-artifact':
        case 'delete-artifact':
            return 'artifacts';
        default:
            return null;
    }
}

/**
 * Track the highest sequence number for an entity type.
 * Only updates if the new seq is higher than the current tracked value.
 *
 * @param seqMap - The Map tracking sequence numbers per entity type
 * @param entityType - The entity type to update
 * @param seq - The new sequence number (can be undefined)
 * @returns true if the map was updated, false otherwise
 *
 * @example
 * const seqMap = new Map();
 * trackSeq(seqMap, 'sessions', 5); // returns true, map has sessions=5
 * trackSeq(seqMap, 'sessions', 3); // returns false, 3 < 5
 * trackSeq(seqMap, 'sessions', 10); // returns true, map has sessions=10
 */
export function trackSeq(
    seqMap: Map<string, number>,
    entityType: string,
    seq: number | undefined
): boolean {
    if (seq === undefined) return false;
    const currentSeq = seqMap.get(entityType) ?? 0;
    if (seq > currentSeq) {
        seqMap.set(entityType, seq);
        return true;
    }
    return false;
}

/**
 * Get the last known sequence number for an entity type.
 *
 * @param seqMap - The Map tracking sequence numbers per entity type
 * @param entityType - The entity type to look up
 * @returns The last known seq, or 0 if not tracked yet
 */
export function getLastKnownSeq(seqMap: Map<string, number>, entityType: string): number {
    return seqMap.get(entityType) ?? 0;
}
