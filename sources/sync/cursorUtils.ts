/**
 * Cursor Utilities for Feed Pagination
 *
 * Feed cursors follow the format: "0-{counter}"
 * - "0-" is a fixed prefix (version identifier)
 * - {counter} is a monotonically increasing integer
 *
 * Examples:
 *   Valid:   "0-12345", "0-0", "0-999999"
 *   Invalid: "", "12345", "0-", "0-abc", "1-12345"
 *
 * @module cursorUtils
 */

/**
 * Regular expression for valid cursor format.
 * Matches: "0-" followed by one or more digits
 */
const CURSOR_REGEX = /^0-\d+$/;

/**
 * Validates if a string is a properly formatted cursor.
 *
 * @param cursor - The cursor string to validate
 * @returns true if the cursor matches the expected format
 *
 * @example
 * isValidCursor("0-12345") // true
 * isValidCursor("0-0")     // true
 * isValidCursor("")        // false
 * isValidCursor("0-")      // false
 * isValidCursor("0-abc")   // false
 */
export function isValidCursor(cursor: unknown): cursor is string {
    return typeof cursor === 'string' && CURSOR_REGEX.test(cursor);
}

/**
 * Extracts the counter value from a cursor string.
 * Returns null if the cursor is invalid, allowing graceful fallback.
 *
 * @param cursor - The cursor string to parse
 * @returns The counter as a number, or null if invalid
 *
 * @example
 * parseCursorCounter("0-12345") // 12345
 * parseCursorCounter("0-0")     // 0
 * parseCursorCounter("")        // null
 * parseCursorCounter("0-abc")   // null
 * parseCursorCounter(undefined) // null
 */
export function parseCursorCounter(cursor: unknown): number | null {
    if (!isValidCursor(cursor)) {
        return null;
    }
    // Safe to substring after validation
    const counter = parseInt(cursor.substring(2), 10);
    // Double-check for NaN (shouldn't happen with regex, but defensive)
    return Number.isNaN(counter) ? null : counter;
}

/**
 * Safely parses a cursor and returns counter, with fallback for invalid cursors.
 * Use this when you need a counter value and can accept a default.
 *
 * @param cursor - The cursor string to parse
 * @param fallback - Value to return if cursor is invalid (default: 0)
 * @returns The counter as a number, or the fallback value
 *
 * @example
 * parseCursorCounterOrDefault("0-12345")     // 12345
 * parseCursorCounterOrDefault("")            // 0
 * parseCursorCounterOrDefault("invalid", -1) // -1
 */
export function parseCursorCounterOrDefault(cursor: unknown, fallback: number = 0): number {
    return parseCursorCounter(cursor) ?? fallback;
}

/**
 * Compares two cursors and returns which has a higher counter.
 * Invalid cursors are treated as less than valid cursors.
 * Two invalid cursors are considered equal (returns 0).
 *
 * @param a - First cursor
 * @param b - Second cursor
 * @returns Negative if a < b, positive if a > b, zero if equal
 *
 * @example
 * compareCursors("0-100", "0-50")  // positive (100 > 50)
 * compareCursors("0-50", "0-100")  // negative (50 < 100)
 * compareCursors("0-50", "0-50")   // 0
 * compareCursors("", "0-50")       // negative (invalid < valid)
 * compareCursors("", "")           // 0 (both invalid)
 */
export function compareCursors(a: unknown, b: unknown): number {
    const counterA = parseCursorCounter(a);
    const counterB = parseCursorCounter(b);

    // Both invalid → equal
    if (counterA === null && counterB === null) {
        return 0;
    }
    // Only first invalid → less than
    if (counterA === null) {
        return -1;
    }
    // Only second invalid → greater than
    if (counterB === null) {
        return 1;
    }
    // Both valid → normal comparison
    return counterA - counterB;
}

/**
 * Constructs a cursor string from a counter value.
 *
 * @param counter - The counter value
 * @returns A properly formatted cursor string
 *
 * @example
 * buildCursor(12345) // "0-12345"
 */
export function buildCursor(counter: number): string {
    return `0-${counter}`;
}
