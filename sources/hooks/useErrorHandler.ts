/**
 * Error handler hook for consistent error display across the app.
 *
 * HAP-530: This hook provides standardized error handling that:
 * - Uses getSmartErrorMessage() for AppErrors (includes Support ID for server errors)
 * - Falls back to error.message for standard errors
 * - Provides user-friendly messages for unknown errors
 *
 * HAP-527: For server errors (network, API, sync), the error dialog includes a
 * "Copy ID" button that copies the Support ID to clipboard for easy reporting.
 *
 * @module hooks/useErrorHandler
 *
 * @example
 * ```typescript
 * function MyComponent() {
 *     const { showError } = useErrorHandler();
 *
 *     const handleAction = async () => {
 *         try {
 *             await someApiCall();
 *         } catch (error) {
 *             showError(error);
 *         }
 *     };
 * }
 * ```
 */

import { useCallback } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Modal } from '@/modal';
import { Toast } from '@/toast';
import { t } from '@/text';
import { AppError, getSmartErrorMessage, getSupportId, isServerError } from '@/utils/errors';

export interface ErrorHandlerOptions {
    /**
     * Custom title for the error dialog.
     * Defaults to t('common.error').
     */
    title?: string;

    /**
     * Custom fallback message when error is not an Error instance.
     * Defaults to t('errors.unknownError').
     */
    fallbackMessage?: string;

    /**
     * Additional buttons to show in the alert.
     * If not provided, shows a single "OK" button.
     */
    buttons?: Array<{
        text: string;
        style?: 'default' | 'cancel' | 'destructive';
        onPress?: () => void;
    }>;
}

export interface ErrorHandler {
    /**
     * Show an error dialog with smart message formatting.
     *
     * For AppError instances:
     * - Uses getSmartErrorMessage() which includes Support ID for server errors
     * - Falls back to user-friendly message for local errors
     *
     * For standard Error instances:
     * - Uses error.message
     *
     * For unknown values:
     * - Uses fallback message
     *
     * @param error - The error to display
     * @param options - Optional customization for the dialog
     */
    showError: (error: unknown, options?: ErrorHandlerOptions) => void;

    /**
     * Get the appropriate message for an error without showing a dialog.
     * Useful when you need to display the error in a custom way.
     *
     * @param error - The error to get message from
     * @param fallbackMessage - Custom fallback for non-Error values
     * @returns The appropriate error message
     */
    getErrorMessage: (error: unknown, fallbackMessage?: string) => string;
}

/**
 * Hook for consistent error handling across the app.
 *
 * @returns Error handler functions
 *
 * @example
 * ```typescript
 * const { showError, getErrorMessage } = useErrorHandler();
 *
 * // Show error dialog
 * showError(error);
 *
 * // Show error with custom title
 * showError(error, { title: 'Connection Failed' });
 *
 * // Get error message without showing dialog
 * const message = getErrorMessage(error);
 * ```
 */
export function useErrorHandler(): ErrorHandler {
    const getErrorMessage = useCallback(
        (error: unknown, fallbackMessage?: string): string => {
            if (AppError.isAppError(error)) {
                // Use smart message which includes Support ID for server errors
                return getSmartErrorMessage(error);
            }

            if (error instanceof Error) {
                return error.message;
            }

            return fallbackMessage ?? t('errors.unknownError');
        },
        []
    );

    const showError = useCallback(
        (error: unknown, options?: ErrorHandlerOptions): void => {
            const title = options?.title ?? t('common.error');
            const message = getErrorMessage(error, options?.fallbackMessage);

            // Build buttons array
            let buttons = options?.buttons;

            if (!buttons) {
                // Default buttons: OK only for non-server errors
                // For server errors with AppError, add "Copy ID" button
                // HAP-527: Allow users to copy Support ID for easier support reporting
                if (AppError.isAppError(error) && isServerError(error.code)) {
                    buttons = [
                        {
                            text: t('errors.copySupportId'),
                            style: 'default' as const,
                            onPress: async () => {
                                const supportId = getSupportId();
                                await Clipboard.setStringAsync(supportId);
                                Toast.show({ message: t('errors.supportIdCopied') });
                            }
                        },
                        { text: t('common.ok'), style: 'cancel' as const }
                    ];
                } else {
                    buttons = [{ text: t('common.ok'), style: 'cancel' as const }];
                }
            }

            Modal.alert(title, message, buttons);
        },
        [getErrorMessage]
    );

    return {
        showError,
        getErrorMessage,
    };
}
