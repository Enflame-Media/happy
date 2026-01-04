/**
 * Hook for handling session revival flow and error UI.
 *
 * HAP-735: This hook provides standardized session revival handling that:
 * - Detects SESSION_REVIVAL_FAILED errors from CLI RPC responses
 * - Shows a dialog with session ID and "Copy ID" button
 * - Provides "Archive Session" and "Try Again" options
 * - Handles clipboard copy and toast notifications
 *
 * @module hooks/useSessionRevival
 *
 * @example
 * ```typescript
 * function SessionComponent({ sessionId }) {
 *     const { revivalFailed, handleRpcError, showRevivalFailedDialog, reset } = useSessionRevival();
 *
 *     const performAction = async () => {
 *         try {
 *             await someRpcCall();
 *         } catch (error) {
 *             if (handleRpcError(error)) {
 *                 // Error was a SESSION_REVIVAL_FAILED, dialog will be shown
 *                 return;
 *             }
 *             // Handle other errors
 *         }
 *     };
 *
 *     // Or manually show the dialog
 *     showRevivalFailedDialog(sessionId, 'Session stopped unexpectedly');
 * }
 * ```
 */

import { useState, useCallback } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Modal } from '@/modal';
import { Toast } from '@/toast';
import { t } from '@/text';
import { AppError, ErrorCodes } from '@/utils/errors';
import { sessionKill } from '@/sync/ops';

/**
 * State for a failed revival attempt.
 */
export interface RevivalFailedState {
    /** The session ID that failed to revive */
    sessionId: string;
    /** Error message from the revival attempt */
    errorMessage: string;
}

/**
 * Return type for the useSessionRevival hook.
 */
export interface SessionRevivalHandler {
    /**
     * Current revival failed state, or null if no failure.
     */
    revivalFailed: RevivalFailedState | null;

    /**
     * Whether a session revival is currently in progress.
     * HAP-752: Used to show SessionRevivalBanner during revival attempts.
     */
    reviving: boolean;

    /**
     * Start the reviving state (show banner).
     * HAP-752: Call this when a revival attempt begins.
     */
    startReviving: () => void;

    /**
     * Stop the reviving state (hide banner).
     * HAP-752: Called automatically on success or when transitioning to failure dialog.
     */
    stopReviving: () => void;

    /**
     * Handle an RPC error and check if it's a SESSION_REVIVAL_FAILED error.
     * If it is, shows the revival failed dialog automatically.
     *
     * @param error - The error to check
     * @returns true if the error was handled (was SESSION_REVIVAL_FAILED), false otherwise
     */
    handleRpcError: (error: unknown) => boolean;

    /**
     * Manually show the revival failed dialog.
     *
     * @param sessionId - The session ID that failed to revive
     * @param errorMessage - Error message to display
     * @param onArchive - Optional callback when user chooses to archive
     * @param onRetry - Optional callback when user chooses to retry
     */
    showRevivalFailedDialog: (
        sessionId: string,
        errorMessage: string,
        onArchive?: () => void,
        onRetry?: () => void
    ) => void;

    /**
     * Reset the revival failed state.
     */
    reset: () => void;
}

/**
 * Hook for handling session revival flow and error UI.
 *
 * @returns Session revival handler functions
 */
export function useSessionRevival(): SessionRevivalHandler {
    const [revivalFailed, setRevivalFailed] = useState<RevivalFailedState | null>(null);
    // HAP-752: Track whether a revival attempt is in progress
    const [reviving, setReviving] = useState(false);

    /**
     * Copy session ID to clipboard and show toast.
     */
    const copySessionId = useCallback(async (sessionId: string) => {
        await Clipboard.setStringAsync(sessionId);
        Toast.show({ message: t('session.revival.idCopied') });
    }, []);

    /**
     * HAP-752: Start the reviving state to show the banner.
     */
    const startReviving = useCallback(() => {
        setReviving(true);
    }, []);

    /**
     * HAP-752: Stop the reviving state to hide the banner.
     */
    const stopReviving = useCallback(() => {
        setReviving(false);
    }, []);

    /**
     * Archive the session by killing it via sessionKill.
     * This marks the session as inactive on both CLI and server.
     */
    const archiveSession = useCallback(async (sessionId: string) => {
        try {
            const result = await sessionKill(sessionId);
            if (result.success) {
                Toast.show({ message: t('swipeActions.sessionArchived') });
            } else {
                // Session was likely already archived/inactive
                Toast.show({ message: result.message || t('sessionInfo.failedToArchiveSession') });
            }
        } catch (error) {
            console.error('Failed to archive session:', error);
            Toast.show({ message: t('sessionInfo.failedToArchiveSession') });
        }
    }, []);

    /**
     * Show the revival failed dialog with session ID and action buttons.
     */
    const showRevivalFailedDialog = useCallback((
        sessionId: string,
        errorMessage: string,
        onArchive?: () => void,
        onRetry?: () => void
    ) => {
        // HAP-752: Stop reviving state when transitioning to failure dialog
        setReviving(false);
        // Store the state
        setRevivalFailed({ sessionId, errorMessage });

        // Build the message with session ID in monospace
        const message = `${t('session.revival.failedDescription')}\n\n${t('session.revival.sessionId')}: ${sessionId}`;

        // Show dialog with custom buttons
        Modal.alert(
            t('session.revival.failed'),
            message,
            [
                {
                    text: t('session.revival.copyId'),
                    style: 'default',
                    onPress: () => copySessionId(sessionId)
                },
                {
                    text: t('session.revival.archiveSession'),
                    style: 'destructive',
                    onPress: async () => {
                        await archiveSession(sessionId);
                        onArchive?.();
                        setRevivalFailed(null);
                    }
                },
                {
                    text: t('session.revival.tryAgain'),
                    style: 'cancel',
                    onPress: () => {
                        onRetry?.();
                        setRevivalFailed(null);
                    }
                }
            ]
        );
    }, [copySessionId, archiveSession]);

    /**
     * Handle an RPC error and check if it's a SESSION_REVIVAL_FAILED error.
     */
    const handleRpcError = useCallback((error: unknown): boolean => {
        if (!AppError.isAppError(error)) {
            return false;
        }

        if (error.code !== ErrorCodes.SESSION_REVIVAL_FAILED) {
            return false;
        }

        // Extract session ID from error context if available
        const sessionId = (error.context?.sessionId as string) || 'Unknown';

        // Show the dialog
        showRevivalFailedDialog(sessionId, error.message);

        return true;
    }, [showRevivalFailedDialog]);

    /**
     * Reset the revival failed state.
     */
    const reset = useCallback(() => {
        setRevivalFailed(null);
    }, []);

    return {
        revivalFailed,
        reviving,
        startReviving,
        stopReviving,
        handleRpcError,
        showRevivalFailedDialog,
        reset
    };
}
