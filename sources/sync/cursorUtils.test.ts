import { describe, it, expect } from 'vitest';
import {
    isValidCursor,
    parseCursorCounter,
    parseCursorCounterOrDefault,
    compareCursors,
    buildCursor
} from './cursorUtils';

describe('cursorUtils', () => {
    describe('isValidCursor', () => {
        describe('valid cursors', () => {
            it('should accept standard cursor format', () => {
                expect(isValidCursor('0-12345')).toBe(true);
            });

            it('should accept zero counter', () => {
                expect(isValidCursor('0-0')).toBe(true);
            });

            it('should accept large counter values', () => {
                expect(isValidCursor('0-999999999')).toBe(true);
            });

            it('should accept single digit counter', () => {
                expect(isValidCursor('0-1')).toBe(true);
            });
        });

        describe('invalid cursors', () => {
            it('should reject empty string', () => {
                expect(isValidCursor('')).toBe(false);
            });

            it('should reject null', () => {
                expect(isValidCursor(null)).toBe(false);
            });

            it('should reject undefined', () => {
                expect(isValidCursor(undefined)).toBe(false);
            });

            it('should reject number type', () => {
                expect(isValidCursor(12345)).toBe(false);
            });

            it('should reject missing prefix', () => {
                expect(isValidCursor('12345')).toBe(false);
            });

            it('should reject incomplete prefix', () => {
                expect(isValidCursor('0')).toBe(false);
                expect(isValidCursor('0-')).toBe(false);
            });

            it('should reject wrong prefix version', () => {
                expect(isValidCursor('1-12345')).toBe(false);
                expect(isValidCursor('2-12345')).toBe(false);
            });

            it('should reject non-numeric counter', () => {
                expect(isValidCursor('0-abc')).toBe(false);
                expect(isValidCursor('0-12a34')).toBe(false);
            });

            it('should reject negative counter', () => {
                expect(isValidCursor('0--123')).toBe(false);
            });

            it('should reject floating point counter', () => {
                expect(isValidCursor('0-123.45')).toBe(false);
            });

            it('should reject leading zeros mixed with letters', () => {
                expect(isValidCursor('0-0x10')).toBe(false);
            });

            it('should reject whitespace', () => {
                expect(isValidCursor(' 0-123')).toBe(false);
                expect(isValidCursor('0-123 ')).toBe(false);
                expect(isValidCursor('0- 123')).toBe(false);
            });

            it('should reject extra characters', () => {
                expect(isValidCursor('0-123-456')).toBe(false);
                expect(isValidCursor('prefix0-123')).toBe(false);
            });
        });
    });

    describe('parseCursorCounter', () => {
        describe('valid cursors', () => {
            it('should parse standard cursor', () => {
                expect(parseCursorCounter('0-12345')).toBe(12345);
            });

            it('should parse zero counter', () => {
                expect(parseCursorCounter('0-0')).toBe(0);
            });

            it('should parse large counter', () => {
                expect(parseCursorCounter('0-999999999')).toBe(999999999);
            });

            it('should parse leading zeros correctly', () => {
                expect(parseCursorCounter('0-00123')).toBe(123);
            });
        });

        describe('invalid cursors', () => {
            it('should return null for empty string', () => {
                expect(parseCursorCounter('')).toBeNull();
            });

            it('should return null for null', () => {
                expect(parseCursorCounter(null)).toBeNull();
            });

            it('should return null for undefined', () => {
                expect(parseCursorCounter(undefined)).toBeNull();
            });

            it('should return null for invalid format', () => {
                expect(parseCursorCounter('0-abc')).toBeNull();
                expect(parseCursorCounter('invalid')).toBeNull();
                expect(parseCursorCounter('0-')).toBeNull();
            });

            it('should return null for numbers', () => {
                expect(parseCursorCounter(12345)).toBeNull();
            });
        });
    });

    describe('parseCursorCounterOrDefault', () => {
        describe('valid cursors', () => {
            it('should parse valid cursor', () => {
                expect(parseCursorCounterOrDefault('0-12345')).toBe(12345);
            });

            it('should not use fallback for valid cursor', () => {
                expect(parseCursorCounterOrDefault('0-100', 999)).toBe(100);
            });
        });

        describe('invalid cursors with default fallback', () => {
            it('should return 0 for empty string', () => {
                expect(parseCursorCounterOrDefault('')).toBe(0);
            });

            it('should return 0 for null', () => {
                expect(parseCursorCounterOrDefault(null)).toBe(0);
            });

            it('should return 0 for undefined', () => {
                expect(parseCursorCounterOrDefault(undefined)).toBe(0);
            });

            it('should return 0 for invalid format', () => {
                expect(parseCursorCounterOrDefault('invalid')).toBe(0);
            });
        });

        describe('invalid cursors with custom fallback', () => {
            it('should return custom fallback for empty string', () => {
                expect(parseCursorCounterOrDefault('', -1)).toBe(-1);
            });

            it('should return custom fallback for null', () => {
                expect(parseCursorCounterOrDefault(null, 999)).toBe(999);
            });

            it('should return custom fallback for invalid format', () => {
                expect(parseCursorCounterOrDefault('0-abc', 42)).toBe(42);
            });
        });
    });

    describe('compareCursors', () => {
        describe('both valid cursors', () => {
            it('should return positive when first is greater', () => {
                expect(compareCursors('0-100', '0-50')).toBeGreaterThan(0);
            });

            it('should return negative when first is less', () => {
                expect(compareCursors('0-50', '0-100')).toBeLessThan(0);
            });

            it('should return zero when equal', () => {
                expect(compareCursors('0-50', '0-50')).toBe(0);
            });

            it('should handle large differences', () => {
                expect(compareCursors('0-1000000', '0-1')).toBeGreaterThan(0);
            });
        });

        describe('one invalid cursor', () => {
            it('should treat invalid first cursor as less than valid', () => {
                expect(compareCursors('', '0-50')).toBeLessThan(0);
                expect(compareCursors(null, '0-50')).toBeLessThan(0);
            });

            it('should treat valid cursor as greater than invalid second', () => {
                expect(compareCursors('0-50', '')).toBeGreaterThan(0);
                expect(compareCursors('0-50', null)).toBeGreaterThan(0);
            });
        });

        describe('both invalid cursors', () => {
            it('should return zero when both are invalid', () => {
                expect(compareCursors('', '')).toBe(0);
                expect(compareCursors(null, undefined)).toBe(0);
                expect(compareCursors('invalid', 'also-invalid')).toBe(0);
            });
        });
    });

    describe('buildCursor', () => {
        it('should build cursor from positive integer', () => {
            expect(buildCursor(12345)).toBe('0-12345');
        });

        it('should build cursor from zero', () => {
            expect(buildCursor(0)).toBe('0-0');
        });

        it('should build cursor from large integer', () => {
            expect(buildCursor(999999999)).toBe('0-999999999');
        });
    });

    describe('roundtrip: buildCursor -> parseCursorCounter', () => {
        it('should roundtrip correctly', () => {
            const values = [0, 1, 100, 12345, 999999999];
            for (const value of values) {
                const cursor = buildCursor(value);
                expect(parseCursorCounter(cursor)).toBe(value);
            }
        });
    });

    describe('real-world edge cases', () => {
        it('should handle cursors from API responses', () => {
            // These are the kinds of cursors we see in production
            expect(isValidCursor('0-1703419200000')).toBe(true);
            expect(parseCursorCounter('0-1703419200000')).toBe(1703419200000);
        });

        it('should handle malformed server responses gracefully', () => {
            // Server might return empty or null
            expect(parseCursorCounterOrDefault(null)).toBe(0);
            expect(parseCursorCounterOrDefault('')).toBe(0);

            // Server might return unexpected format
            expect(parseCursorCounterOrDefault('cursor:12345')).toBe(0);
        });
    });
});
