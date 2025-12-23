/**
 * SwipeableSessionRow - A wrapper component that adds swipe/hover actions to session rows
 *
 * This component wraps session items (SessionItem, CompactSessionRow) to provide:
 * - Swipe left → Archive (connected) or Delete (disconnected) actions
 * - Swipe right → Quick reply action (navigate to session with input focused)
 *
 * Uses react-native-gesture-handler's Swipeable component on mobile.
 * On web platform, shows hover action buttons instead of swipe gestures.
 *
 * @example
 * <SwipeableSessionRow session={session} isConnected={true}>
 *   <SessionItem session={session} />
 * </SwipeableSessionRow>
 */
import React, { useRef, useCallback, useState, useEffect } from 'react';
import { Platform, Animated, Pressable, AccessibilityInfo, View } from 'react-native';
import { Text } from '@/components/StyledText';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Session } from '@/sync/storageTypes';
import { sessionKill, sessionDelete } from '@/sync/ops';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { hapticsLight } from '@/components/haptics';
import { Modal } from '@/modal';
import { Toast } from '@/toast';
import { t } from '@/text';
import { AppError, ErrorCodes } from '@/utils/errors';
import { useHappyAction } from '@/hooks/useHappyAction';
import { useSessionStatus } from '@/utils/sessionUtils';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { HoverSessionActions } from './HoverSessionActions';

const ARCHIVE_UNDO_DURATION = 5000; // 5 seconds to undo

const ACTION_WIDTH = 80;

interface SwipeableSessionRowProps {
    session: Session;
    children: React.ReactNode;
    /**
     * Whether swipe actions should be disabled (e.g., during loading)
     */
    disabled?: boolean;
}

export const SwipeableSessionRow = React.memo(function SwipeableSessionRow({
    session,
    children,
    disabled = false,
}: SwipeableSessionRowProps) {
    const styles = stylesheet;
    const swipeableRef = useRef<Swipeable>(null);
    const navigateToSession = useNavigateToSession();
    const sessionStatus = useSessionStatus(session);

    // Ref to track pending archive timeout for undo functionality
    const pendingArchiveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const currentToastIdRef = useRef<string | null>(null);

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

    // Close swipeable and navigate to session for quick reply
    const handleQuickReply = useCallback(() => {
        swipeableRef.current?.close();
        hapticsLight();
        navigateToSession(session.id);
        // Announce for accessibility
        AccessibilityInfo.announceForAccessibility(t('swipeActions.navigatingToReply'));
    }, [navigateToSession, session.id]);

    // Handle undo action - cancels the pending archive
    const handleUndoArchive = useCallback(() => {
        if (pendingArchiveRef.current) {
            clearTimeout(pendingArchiveRef.current);
            pendingArchiveRef.current = null;
        }
        currentToastIdRef.current = null;
        hapticsLight();
        AccessibilityInfo.announceForAccessibility(t('swipeActions.archiveUndone'));
    }, []);

    // Handle archive action with undo toast
    const handleArchive = useCallback(() => {
        swipeableRef.current?.close();
        hapticsLight();

        // Clear any existing pending archive
        if (pendingArchiveRef.current) {
            clearTimeout(pendingArchiveRef.current);
        }

        // Show undo toast
        const toastId = Toast.show({
            message: t('swipeActions.sessionArchived'),
            duration: ARCHIVE_UNDO_DURATION,
            action: {
                label: t('common.undo'),
                onPress: handleUndoArchive,
            },
        });
        currentToastIdRef.current = toastId;

        // Set pending archive - will execute after toast duration if not cancelled
        pendingArchiveRef.current = setTimeout(() => {
            pendingArchiveRef.current = null;
            currentToastIdRef.current = null;
            performArchive();
        }, ARCHIVE_UNDO_DURATION);
    }, [handleUndoArchive, performArchive]);

    // Handle delete action
    const handleDelete = useCallback(() => {
        swipeableRef.current?.close();
        hapticsLight();
        // Show confirmation modal (delete is destructive)
        Modal.alert(
            t('sessionInfo.deleteSession'),
            t('sessionInfo.deleteSessionWarning'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('sessionInfo.deleteSession'),
                    style: 'destructive',
                    onPress: () => {
                        performDelete();
                        AccessibilityInfo.announceForAccessibility(t('swipeActions.sessionDeleted'));
                    },
                },
            ]
        );
    }, [performDelete]);

    // Render left actions (swipe right to reveal) - Quick Reply
    const renderLeftActions = useCallback((
        progress: Animated.AnimatedInterpolation<number>,
        dragX: Animated.AnimatedInterpolation<number>
    ) => {
        const scale = dragX.interpolate({
            inputRange: [0, ACTION_WIDTH],
            outputRange: [0.8, 1],
            extrapolate: 'clamp',
        });

        const opacity = dragX.interpolate({
            inputRange: [0, ACTION_WIDTH / 2, ACTION_WIDTH],
            outputRange: [0, 0.5, 1],
            extrapolate: 'clamp',
        });

        return (
            <Pressable
                style={styles.leftActionContainer}
                onPress={handleQuickReply}
                accessibilityRole="button"
                accessibilityLabel={t('swipeActions.reply')}
                accessibilityHint={t('swipeActions.replyHint')}
            >
                <Animated.View
                    style={[
                        styles.leftAction,
                        { opacity, transform: [{ scale }] }
                    ]}
                >
                    <Ionicons name="chatbubble" size={24} color="white" />
                    <Text style={styles.actionText}>{t('swipeActions.reply')}</Text>
                </Animated.View>
            </Pressable>
        );
    }, [handleQuickReply, styles]);

    // Render right actions (swipe left to reveal) - Archive or Delete
    const renderRightActions = useCallback((
        progress: Animated.AnimatedInterpolation<number>,
        dragX: Animated.AnimatedInterpolation<number>
    ) => {
        const scale = dragX.interpolate({
            inputRange: [-ACTION_WIDTH, 0],
            outputRange: [1, 0.8],
            extrapolate: 'clamp',
        });

        const opacity = dragX.interpolate({
            inputRange: [-ACTION_WIDTH, -ACTION_WIDTH / 2, 0],
            outputRange: [1, 0.5, 0],
            extrapolate: 'clamp',
        });

        // Show archive for connected sessions, delete for disconnected inactive sessions
        const isArchiveAction = sessionStatus.isConnected;
        const isDeleteAction = !sessionStatus.isConnected && !session.active;

        // If neither action is available, don't render right actions
        if (!isArchiveAction && !isDeleteAction) {
            return null;
        }

        const actionLabel = isArchiveAction
            ? t('swipeActions.archive')
            : t('swipeActions.delete');
        const actionHint = isArchiveAction
            ? t('swipeActions.archiveHint')
            : t('swipeActions.deleteHint');
        const actionHandler = isArchiveAction ? handleArchive : handleDelete;
        const iconName = isArchiveAction ? 'archive' : 'trash';

        return (
            <Pressable
                style={styles.rightActionContainer}
                onPress={actionHandler}
                accessibilityRole="button"
                accessibilityLabel={actionLabel}
                accessibilityHint={actionHint}
            >
                <Animated.View
                    style={[
                        styles.rightAction,
                        { opacity, transform: [{ scale }] }
                    ]}
                >
                    <Ionicons name={iconName} size={24} color="white" />
                    <Text style={styles.actionText}>{actionLabel}</Text>
                </Animated.View>
            </Pressable>
        );
    }, [sessionStatus.isConnected, session.active, handleArchive, handleDelete, styles]);

    // Handle swipe open events for haptic feedback
    const handleSwipeableOpen = useCallback((direction: 'left' | 'right') => {
        hapticsLight();
        if (direction === 'left') {
            // Swiped left, right actions revealed - trigger action
            if (sessionStatus.isConnected) {
                handleArchive();
            } else if (!session.active) {
                handleDelete();
            }
        } else {
            // Swiped right, left actions revealed - trigger quick reply
            handleQuickReply();
        }
    }, [sessionStatus.isConnected, session.active, handleArchive, handleDelete, handleQuickReply]);

    // Hover state for web platform
    const [isHovered, setIsHovered] = useState(false);

    // On web platform, show hover actions instead of swipe gestures
    if (Platform.OS === 'web') {
        // Handlers for hover actions (no haptics on web, no swipeable ref to close)
        const handleWebQuickReply = () => {
            navigateToSession(session.id);
            AccessibilityInfo.announceForAccessibility(t('swipeActions.navigatingToReply'));
        };

        const handleWebArchive = () => {
            // Clear any existing pending archive
            if (pendingArchiveRef.current) {
                clearTimeout(pendingArchiveRef.current);
            }

            // Show undo toast
            const toastId = Toast.show({
                message: t('swipeActions.sessionArchived'),
                duration: ARCHIVE_UNDO_DURATION,
                action: {
                    label: t('common.undo'),
                    onPress: handleUndoArchive,
                },
            });
            currentToastIdRef.current = toastId;

            // Set pending archive - will execute after toast duration if not cancelled
            pendingArchiveRef.current = setTimeout(() => {
                pendingArchiveRef.current = null;
                currentToastIdRef.current = null;
                performArchive();
            }, ARCHIVE_UNDO_DURATION);
        };

        const handleWebDelete = () => {
            Modal.alert(
                t('sessionInfo.deleteSession'),
                t('sessionInfo.deleteSessionWarning'),
                [
                    { text: t('common.cancel'), style: 'cancel' },
                    {
                        text: t('sessionInfo.deleteSession'),
                        style: 'destructive',
                        onPress: () => {
                            performDelete();
                            AccessibilityInfo.announceForAccessibility(t('swipeActions.sessionDeleted'));
                        },
                    },
                ]
            );
        };

        return (
            <View
                style={styles.webContainer}
                // @ts-expect-error - onMouseEnter/onMouseLeave are web-only props
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
            >
                {children}
                {isHovered && (
                    <HoverSessionActions
                        onReply={handleWebQuickReply}
                        onArchive={handleWebArchive}
                        onDelete={handleWebDelete}
                        isConnected={sessionStatus.isConnected}
                        isActive={session.active}
                    />
                )}
            </View>
        );
    }

    // If disabled, just render children without any actions
    if (disabled) {
        return <>{children}</>;
    }

    return (
        <Swipeable
            ref={swipeableRef}
            renderLeftActions={renderLeftActions}
            renderRightActions={renderRightActions}
            onSwipeableOpen={handleSwipeableOpen}
            friction={2}
            overshootFriction={8}
            leftThreshold={ACTION_WIDTH * 0.5}
            rightThreshold={ACTION_WIDTH * 0.5}
            overshootLeft={false}
            overshootRight={false}
            containerStyle={styles.swipeableContainer}
        >
            {children}
        </Swipeable>
    );
});

const stylesheet = StyleSheet.create((_theme) => ({
    webContainer: {
        position: 'relative',
    },
    swipeableContainer: {
        overflow: 'hidden',
    },
    leftActionContainer: {
        backgroundColor: '#007AFF', // iOS blue
        justifyContent: 'center',
        alignItems: 'flex-end',
        width: ACTION_WIDTH,
    },
    leftAction: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 16,
    },
    rightActionContainer: {
        backgroundColor: '#FF3B30', // iOS red
        justifyContent: 'center',
        alignItems: 'flex-start',
        width: ACTION_WIDTH,
    },
    rightAction: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 16,
    },
    actionText: {
        color: 'white',
        fontSize: 12,
        marginTop: 4,
        ...Typography.default('semiBold'),
    },
}));
