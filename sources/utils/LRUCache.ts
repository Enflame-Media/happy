/**
 * A simple LRU (Least Recently Used) cache implementation.
 *
 * When the cache exceeds maxSize, the least recently used entries are evicted.
 * An optional onEvict callback is called for each evicted entry, useful for cleanup.
 *
 * Access order is tracked by re-inserting entries on get/set operations.
 * Map iteration order preserves insertion order, so the first entries are oldest.
 */
export class LRUCache<K, V> {
    private cache = new Map<K, V>();
    private readonly maxSize: number;
    private readonly onEvict?: (key: K, value: V) => void;

    constructor(maxSize: number, onEvict?: (key: K, value: V) => void) {
        if (maxSize < 1) {
            throw new Error('LRUCache maxSize must be at least 1');
        }
        this.maxSize = maxSize;
        this.onEvict = onEvict;
    }

    /**
     * Get a value and mark it as recently used.
     */
    get(key: K): V | undefined {
        const value = this.cache.get(key);
        if (value !== undefined) {
            // Move to end (most recently used) by re-inserting
            this.cache.delete(key);
            this.cache.set(key, value);
        }
        return value;
    }

    /**
     * Set a value and mark it as recently used.
     * Evicts least recently used entries if over maxSize.
     */
    set(key: K, value: V): void {
        // If key exists, delete first to update access order
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }

        // Add new entry
        this.cache.set(key, value);

        // Evict oldest entries if over limit
        while (this.cache.size > this.maxSize) {
            const oldestKey = this.cache.keys().next().value as K;
            const oldestValue = this.cache.get(oldestKey)!;
            this.cache.delete(oldestKey);
            this.onEvict?.(oldestKey, oldestValue);
        }
    }

    /**
     * Check if key exists. Does NOT update access order.
     */
    has(key: K): boolean {
        return this.cache.has(key);
    }

    /**
     * Delete an entry.
     */
    delete(key: K): boolean {
        const value = this.cache.get(key);
        const deleted = this.cache.delete(key);
        if (deleted && value !== undefined) {
            this.onEvict?.(key, value);
        }
        return deleted;
    }

    /**
     * Get the current number of entries.
     */
    get size(): number {
        return this.cache.size;
    }

    /**
     * Clear all entries, calling onEvict for each.
     */
    clear(): void {
        for (const [key, value] of this.cache) {
            this.onEvict?.(key, value);
        }
        this.cache.clear();
    }
}
