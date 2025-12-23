/**
 * Hook for showing a context menu on long-press of a session item
 *
 * Provides quick access to common session actions:
 * - View session info
 * - Copy session ID
 * - Change permission mode (connected sessions only)
 * - Change model (connected sessions only)
 * - Archive session (connected sessions only)
 * - Delete session (disconnected sessions only)
 *
 * Uses native ActionSheetIOS on iOS and Modal.alert on Android/Web.
 * Triggers haptic feedback on long-press.
 */
import { useCallback, useRef, useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Session } from '@/sync/storageTypes';
import { sessionKill, sessionDelete } from '@/sync/ops';
import { storage } from '@/sync/storage';
import { Modal } from '@/modal';
import { Toast } from '@/toast';
import { t } from '@/text';
import { showActionSheet, ActionSheetOption } from '@/utils/ActionSheet';
import { hapticsLight } from '@/components/haptics';
import { useSessionStatus } from '@/utils/sessionUtils';
import { AppError, ErrorCodes } from '@/utils/errors';
import { useHappyAction } from './useHappyAction';

const ARCHIVE_UNDO_DURATION = 5000; // 5 seconds to undo

interface UseSessionContextMenuOptions {
    /** Optional callback when "Select" is chosen - enters multi-select mode and pre-selects this session */
    onSelect?: () => void;
}

/**
 * Hook that returns a function to show context menu for a session
 * @param session - The session to show actions for
 * @param options - Optional configuration including onSelect callback for multi-select mode
 * @returns Object with showContextMenu function
 */
export function useSessionContextMenu(session: Session, options?: UseSessionContextMenuOptions) {
    const router = useRouter();
    const sessionStatus = useSessionStatus(session);

    // Ref to track pending archive timeout for undo functionality
    const pendingArchiveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Archive action with error handling
    const [_archiving, performArchive] = useHappyAction(async () => {
        const result = await sessionKill(session.id);
        if (!result.success) {
            throw new AppError(ErrorCodes.INTERNAL_ERROR, result.message || t('sessionInfo.failedToArchiveSession'), { canTryAgain: false });
        }
    });

    // Delete action with error handling
    const [_deleting, performDelete] = useHappyAction(async () => {
        const result = await sessionDelete(session.id);
        if (!result.success) {
            throw new AppError(ErrorCodes.INTERNAL_ERROR, result.message || t('sessionInfo.failedToDeleteSession'), { canTryAgain: false });
        }
    });

    // Cleanup pending archive on unmount
    useEffect(() => {
        return () => {
            if (pendingArchiveRef.current) {
                clearTimeout(pendingArchiveRef.current);
            }
        };
    }, []);

    // Handle undo action - cancels the pending archive
    const handleUndoArchive = useCallback(() => {
        if (pendingArchiveRef.current) {
            clearTimeout(pendingArchiveRef.current);
            pendingArchiveRef.current = null;
        }
        hapticsLight();
        AccessibilityInfo.announceForAccessibility(t('swipeActions.archiveUndone'));
    }, []);

    const showContextMenu = useCallback(() => {
        // Trigger haptic feedback
        hapticsLight();

        const menuOptions: ActionSheetOption[] = [];

        // View session info - always available
        menuOptions.push({
            label: t('sessionContextMenu.viewInfo'),
            onPress: () => {
                router.push(`/session/${session.id}/info`);
            },
        });

        // Copy session ID - always available
        menuOptions.push({
            label: t('sessionContextMenu.copySessionId'),
            onPress: async () => {
                try {
                    await Clipboard.setStringAsync(session.id);
                    Modal.alert(t('common.success'), t('sessionInfo.happySessionIdCopied'));
                } catch {
                    Modal.alert(t('common.error'), t('sessionInfo.failedToCopySessionId'));
                }
            },
        });

        // Select - only when onSelect callback is provided (for multi-select eligible sessions)
        if (options?.onSelect) {
            menuOptions.push({
                label: t('sessionContextMenu.select'),
                onPress: () => {
                    options.onSelect?.();
                },
            });
        }

        // Change mode - only for connected sessions
        if (sessionStatus.isConnected) {
            const isCodex = session.metadata?.flavor === 'gpt' || session.metadata?.flavor === 'openai';

            menuOptions.push({
                label: t('sessionContextMenu.changeMode'),
                onPress: () => {
                    const modeOptions: ActionSheetOption[] = isCodex
                        ? [
                              {
                                  label: t('agentInput.codexPermissionMode.default'),
                                  onPress: () => storage.getState().updateSessionPermissionMode(session.id, 'default'),
                              },
                              {
                                  label: t('agentInput.codexPermissionMode.readOnly'),
                                  onPress: () => storage.getState().updateSessionPermissionMode(session.id, 'read-only'),
                              },
                              {
                                  label: t('agentInput.codexPermissionMode.safeYolo'),
                                  onPress: () => storage.getState().updateSessionPermissionMode(session.id, 'safe-yolo'),
                              },
                              {
                                  label: t('agentInput.codexPermissionMode.yolo'),
                                  onPress: () => storage.getState().updateSessionPermissionMode(session.id, 'yolo'),
                              },
                          ]
                        : [
                              {
                                  label: t('agentInput.permissionMode.default'),
                                  onPress: () => storage.getState().updateSessionPermissionMode(session.id, 'default'),
                              },
                              {
                                  label: t('agentInput.permissionMode.acceptEdits'),
                                  onPress: () => storage.getState().updateSessionPermissionMode(session.id, 'acceptEdits'),
                              },
                              {
                                  label: t('agentInput.permissionMode.plan'),
                                  onPress: () => storage.getState().updateSessionPermissionMode(session.id, 'plan'),
                              },
                              {
                                  label: t('agentInput.permissionMode.bypassPermissions'),
                                  onPress: () => storage.getState().updateSessionPermissionMode(session.id, 'bypassPermissions'),
                              },
                          ];

                    showActionSheet({
                        title: isCodex ? t('agentInput.codexPermissionMode.title') : t('agentInput.permissionMode.title'),
                        options: modeOptions,
                    });
                },
            });

            // Change model - only for connected sessions
            menuOptions.push({
                label: t('sessionContextMenu.changeModel'),
                onPress: () => {
                    const modelOptions: ActionSheetOption[] = isCodex
                        ? [
                              {
                                  label: t('agentInput.codexModel.gpt5Minimal'),
                                  onPress: () => storage.getState().updateSessionModelMode(session.id, 'gpt-5-minimal'),
                              },
                              {
                                  label: t('agentInput.codexModel.gpt5Low'),
                                  onPress: () => storage.getState().updateSessionModelMode(session.id, 'gpt-5-low'),
                              },
                              {
                                  label: t('agentInput.codexModel.gpt5Medium'),
                                  onPress: () => storage.getState().updateSessionModelMode(session.id, 'gpt-5-medium'),
                              },
                              {
                                  label: t('agentInput.codexModel.gpt5High'),
                                  onPress: () => storage.getState().updateSessionModelMode(session.id, 'gpt-5-high'),
                              },
                          ]
                        : [
                              {
                                  label: t('agentInput.model.opus'),
                                  onPress: () => storage.getState().updateSessionModelMode(session.id, 'opus'),
                              },
                              {
                                  label: t('agentInput.model.sonnet'),
                                  onPress: () => storage.getState().updateSessionModelMode(session.id, 'sonnet'),
                              },
                              {
                                  label: t('agentInput.model.haiku'),
                                  onPress: () => storage.getState().updateSessionModelMode(session.id, 'haiku'),
                              },
                          ];

                    showActionSheet({
                        title: isCodex ? t('agentInput.codexModel.title') : t('agentInput.model.title'),
                        options: modelOptions,
                    });
                },
            });
        }

        // Archive session - only for connected sessions (uses undo toast pattern)
        if (sessionStatus.isConnected) {
            menuOptions.push({
                label: t('sessionInfo.archiveSession'),
                destructive: true,
                onPress: () => {
                    hapticsLight();

                    // Clear any existing pending archive
                    if (pendingArchiveRef.current) {
                        clearTimeout(pendingArchiveRef.current);
                    }

                    // Show undo toast
                    Toast.show({
                        message: t('swipeActions.sessionArchived'),
                        duration: ARCHIVE_UNDO_DURATION,
                        action: {
                            label: t('common.undo'),
                            onPress: handleUndoArchive,
                        },
                    });

                    // Set pending archive - will execute after toast duration if not cancelled
                    pendingArchiveRef.current = setTimeout(() => {
                        pendingArchiveRef.current = null;
                        performArchive();
                    }, ARCHIVE_UNDO_DURATION);
                },
            });
        }

        // Delete session - only for disconnected, inactive sessions
        if (!sessionStatus.isConnected && !session.active) {
            menuOptions.push({
                label: t('sessionInfo.deleteSession'),
                destructive: true,
                onPress: () => {
                    Modal.alert(
                        t('sessionInfo.deleteSession'),
                        t('sessionInfo.deleteSessionWarning'),
                        [
                            { text: t('common.cancel'), style: 'cancel' },
                            {
                                text: t('sessionInfo.deleteSession'),
                                style: 'destructive',
                                onPress: performDelete,
                            },
                        ]
                    );
                },
            });
        }

        showActionSheet({
            options: menuOptions,
        });
    }, [session, sessionStatus, router, performArchive, performDelete, handleUndoArchive, options]);

    return { showContextMenu };
}
