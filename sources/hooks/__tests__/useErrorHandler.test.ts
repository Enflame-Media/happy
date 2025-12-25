/**
 * Unit tests for useErrorHandler hook.
 *
 * HAP-538: Tests for the error handling hook created in HAP-530.
 *
 * @module hooks/__tests__/useErrorHandler.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted() for mock functions that need to be hoisted with vi.mock
const { mockModalAlert, mockToastShow, mockSetStringAsync } = vi.hoisted(() => ({
    mockModalAlert: vi.fn(),
    mockToastShow: vi.fn(),
    mockSetStringAsync: vi.fn(),
}));

// Mock React's useCallback to just return the function directly
// This allows us to test the hook without a React render context
vi.mock('react', () => ({
    useCallback: <T extends (...args: unknown[]) => unknown>(fn: T, _deps: unknown[]): T => fn,
}));

vi.mock('@/modal', () => ({
    Modal: {
        alert: mockModalAlert,
    },
}));

vi.mock('@/toast', () => ({
    Toast: {
        show: mockToastShow,
    },
}));

vi.mock('expo-clipboard', () => ({
    setStringAsync: mockSetStringAsync,
}));

// Mock translation function - returns the key for testing
vi.mock('@/text', () => ({
    t: (key: string) => key,
}));

// Mock correlation ID utilities
vi.mock('@/utils/correlationId', () => ({
    getLastFailedCorrelationId: vi.fn(() => 'test-correlation-id'),
    getDisplayCorrelationId: vi.fn(() => 'session-correlation-id'),
}));

// Import after mocks are set up
import { useErrorHandler } from '../useErrorHandler';
import { AppError, ErrorCodes } from '@happy/errors';

describe('useErrorHandler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('getErrorMessage', () => {
        it('returns smart message for server AppError (includes Support ID)', () => {
            const { getErrorMessage } = useErrorHandler();

            // FETCH_FAILED is a server error code
            const error = new AppError(ErrorCodes.FETCH_FAILED, 'Network error');
            const message = getErrorMessage(error);

            // Server errors include Support ID
            expect(message).toContain('Support ID:');
            expect(message).toContain('test-correlation-id');
        });

        it('returns message without Support ID for local AppError', () => {
            const { getErrorMessage } = useErrorHandler();

            // INVALID_INPUT is a local error code
            const error = new AppError(ErrorCodes.INVALID_INPUT, 'Bad input');
            const message = getErrorMessage(error);

            // Local errors don't include Support ID
            expect(message).not.toContain('Support ID:');
            expect(message).toContain('Please check your input');
        });

        it('returns error.message for standard Error instances', () => {
            const { getErrorMessage } = useErrorHandler();

            const error = new Error('Standard error message');
            const message = getErrorMessage(error);

            expect(message).toBe('Standard error message');
        });

        it('returns fallback message for non-Error values', () => {
            const { getErrorMessage } = useErrorHandler();

            const message = getErrorMessage('string error', 'Custom fallback');

            expect(message).toBe('Custom fallback');
        });

        it('returns default t("errors.unknownError") when no fallback provided', () => {
            const { getErrorMessage } = useErrorHandler();

            const message = getErrorMessage(null);

            expect(message).toBe('errors.unknownError');
        });

        it('handles undefined errors', () => {
            const { getErrorMessage } = useErrorHandler();

            const message = getErrorMessage(undefined);

            expect(message).toBe('errors.unknownError');
        });

        it('handles number errors with fallback', () => {
            const { getErrorMessage } = useErrorHandler();

            const message = getErrorMessage(404, 'Not found fallback');

            expect(message).toBe('Not found fallback');
        });

        it('handles object errors with fallback', () => {
            const { getErrorMessage } = useErrorHandler();

            const message = getErrorMessage({ code: 500 }, 'Object fallback');

            expect(message).toBe('Object fallback');
        });
    });

    describe('showError', () => {
        it('calls Modal.alert with default title t("common.error")', () => {
            const { showError } = useErrorHandler();

            const error = new Error('Test error');
            showError(error);

            expect(mockModalAlert).toHaveBeenCalledTimes(1);
            expect(mockModalAlert).toHaveBeenCalledWith(
                'common.error',
                'Test error',
                expect.any(Array)
            );
        });

        it('calls Modal.alert with custom title when provided', () => {
            const { showError } = useErrorHandler();

            const error = new Error('Test error');
            showError(error, { title: 'Custom Title' });

            expect(mockModalAlert).toHaveBeenCalledWith(
                'Custom Title',
                'Test error',
                expect.any(Array)
            );
        });

        it('uses getErrorMessage for message extraction', () => {
            const { showError } = useErrorHandler();

            // For standard Error, should use error.message
            const error = new Error('Extracted message');
            showError(error);

            expect(mockModalAlert).toHaveBeenCalledWith(
                'common.error',
                'Extracted message',
                expect.any(Array)
            );
        });

        it('uses fallbackMessage option when error is not Error instance', () => {
            const { showError } = useErrorHandler();

            showError('string error', { fallbackMessage: 'Fallback used' });

            expect(mockModalAlert).toHaveBeenCalledWith(
                'common.error',
                'Fallback used',
                expect.any(Array)
            );
        });

        it('passes custom buttons array when provided', () => {
            const { showError } = useErrorHandler();
            const customOnPress = vi.fn();

            const customButtons = [
                { text: 'Retry', onPress: customOnPress },
                { text: 'Cancel', style: 'cancel' as const },
            ];

            showError(new Error('Test'), { buttons: customButtons });

            expect(mockModalAlert).toHaveBeenCalledWith(
                'common.error',
                'Test',
                customButtons
            );
        });

        it('shows OK button only for non-server errors', () => {
            const { showError } = useErrorHandler();

            // INVALID_INPUT is a local error, not a server error
            const error = new AppError(ErrorCodes.INVALID_INPUT, 'Bad input');
            showError(error);

            const buttons = mockModalAlert.mock.calls[0][2];
            expect(buttons).toHaveLength(1);
            expect(buttons[0].text).toBe('common.ok');
            expect(buttons[0].style).toBe('cancel');
        });

        it('shows Copy ID button for server errors', () => {
            const { showError } = useErrorHandler();

            // FETCH_FAILED is a server error
            const error = new AppError(ErrorCodes.FETCH_FAILED, 'Network error');
            showError(error);

            const buttons = mockModalAlert.mock.calls[0][2];
            expect(buttons).toHaveLength(2);
            expect(buttons[0].text).toBe('errors.copySupportId');
            expect(buttons[1].text).toBe('common.ok');
        });

        it('Copy ID button copies support ID to clipboard and shows toast', async () => {
            const { showError } = useErrorHandler();

            const error = new AppError(ErrorCodes.FETCH_FAILED, 'Network error');
            showError(error);

            // Get the Copy ID button's onPress handler
            const buttons = mockModalAlert.mock.calls[0][2];
            const copyButton = buttons[0];

            // Simulate button press
            await copyButton.onPress();

            expect(mockSetStringAsync).toHaveBeenCalledWith('test-correlation-id');
            expect(mockToastShow).toHaveBeenCalledWith({
                message: 'errors.supportIdCopied',
            });
        });
    });

    describe('integration', () => {
        it('hook returns stable function references (memoization)', () => {
            // Call the hook twice and verify it returns the same structure
            const result1 = useErrorHandler();
            const result2 = useErrorHandler();

            // Both should have the same interface
            expect(typeof result1.showError).toBe('function');
            expect(typeof result1.getErrorMessage).toBe('function');
            expect(typeof result2.showError).toBe('function');
            expect(typeof result2.getErrorMessage).toBe('function');
        });

        it('getErrorMessage is callable without showError', () => {
            const { getErrorMessage } = useErrorHandler();

            // Should be able to use getErrorMessage independently
            const message = getErrorMessage(new Error('Independent call'));

            expect(message).toBe('Independent call');
            // Modal should NOT be called
            expect(mockModalAlert).not.toHaveBeenCalled();
        });

        it('handles different error types in sequence', () => {
            const { showError, getErrorMessage } = useErrorHandler();

            // Test different error types
            const appError = new AppError(ErrorCodes.AUTH_FAILED, 'Auth failed');
            const standardError = new Error('Standard error');
            const stringError = 'String error';

            // Get messages
            const msg1 = getErrorMessage(appError);
            const msg2 = getErrorMessage(standardError);
            const msg3 = getErrorMessage(stringError, 'fallback');

            expect(msg1).toContain('sign in');
            expect(msg2).toBe('Standard error');
            expect(msg3).toBe('fallback');

            // Show errors
            showError(appError);
            showError(standardError);

            expect(mockModalAlert).toHaveBeenCalledTimes(2);
        });
    });

    describe('edge cases', () => {
        it('handles empty string error with fallback', () => {
            const { getErrorMessage } = useErrorHandler();

            const message = getErrorMessage('', 'Empty string fallback');

            expect(message).toBe('Empty string fallback');
        });

        it('handles Error with empty message', () => {
            const { getErrorMessage } = useErrorHandler();

            const error = new Error('');
            const message = getErrorMessage(error);

            expect(message).toBe('');
        });

        it('handles AppError with unknown error code', () => {
            const { getErrorMessage } = useErrorHandler();

            // Create an AppError with an unknown code
            const error = new AppError('UNKNOWN_CODE', 'Unknown error');
            const message = getErrorMessage(error);

            // Should return the fallback message from getUserFriendlyMessage
            expect(message).toContain('Something went wrong');
        });
    });
});
