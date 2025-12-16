/**
 * HoverSessionActions - Web-only hover action buttons for session rows
 *
 * Shows quick action buttons on hover for web platform:
 * - Reply button (blue) - navigates to session
 * - Archive button (red) - for connected sessions
 * - Delete button (red) - for disconnected inactive sessions
 *
 * This component is used by SwipeableSessionRow on web platform
 * as an alternative to swipe gestures.
 *
 * @see SwipeableSessionRow for mobile swipe implementation
 */
import React from 'react';
import { View, Pressable, AccessibilityInfo } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';

interface HoverSessionActionsProps {
    /** Handler for reply action - navigates to session */
    onReply: () => void;
    /** Handler for archive action - archives connected session */
    onArchive: () => void;
    /** Handler for delete action - deletes disconnected session */
    onDelete: () => void;
    /** Whether the session is currently connected */
    isConnected: boolean;
    /** Whether the session is active */
    isActive: boolean;
}

export const HoverSessionActions = React.memo(function HoverSessionActions({
    onReply,
    onArchive,
    onDelete,
    isConnected,
    isActive,
}: HoverSessionActionsProps) {
    const styles = stylesheet;
    const { theme } = useUnistyles();

    // Determine which destructive action to show
    const showArchive = isConnected;
    const showDelete = !isConnected && !isActive;

    const handleReply = () => {
        onReply();
        AccessibilityInfo.announceForAccessibility(t('swipeActions.navigatingToReply'));
    };

    const handleArchive = () => {
        onArchive();
    };

    const handleDelete = () => {
        onDelete();
    };

    return (
        <View style={styles.container}>
            {/* Reply button - blue */}
            <Pressable
                style={({ pressed, hovered }) => [
                    styles.actionButton,
                    styles.replyButton,
                    hovered && styles.actionButtonHovered,
                    pressed && styles.actionButtonPressed,
                ]}
                onPress={handleReply}
                accessibilityRole="button"
                accessibilityLabel={t('swipeActions.reply')}
                accessibilityHint={t('swipeActions.replyHint')}
            >
                <Ionicons
                    name="chatbubble"
                    size={16}
                    color={theme.colors.radio.active} // iOS blue
                />
            </Pressable>

            {/* Archive button - red (for connected sessions) */}
            {showArchive && (
                <Pressable
                    style={({ pressed, hovered }) => [
                        styles.actionButton,
                        styles.destructiveButton,
                        hovered && styles.destructiveButtonHovered,
                        pressed && styles.destructiveButtonPressed,
                    ]}
                    onPress={handleArchive}
                    accessibilityRole="button"
                    accessibilityLabel={t('swipeActions.archive')}
                    accessibilityHint={t('swipeActions.archiveHint')}
                >
                    <Ionicons
                        name="archive"
                        size={16}
                        color={theme.colors.textDestructive}
                    />
                </Pressable>
            )}

            {/* Delete button - red (for disconnected inactive sessions) */}
            {showDelete && (
                <Pressable
                    style={({ pressed, hovered }) => [
                        styles.actionButton,
                        styles.destructiveButton,
                        hovered && styles.destructiveButtonHovered,
                        pressed && styles.destructiveButtonPressed,
                    ]}
                    onPress={handleDelete}
                    accessibilityRole="button"
                    accessibilityLabel={t('swipeActions.delete')}
                    accessibilityHint={t('swipeActions.deleteHint')}
                >
                    <Ionicons
                        name="trash"
                        size={16}
                        color={theme.colors.textDestructive}
                    />
                </Pressable>
            )}
        </View>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        position: 'absolute',
        right: 16,
        top: 0,
        bottom: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        zIndex: 10,
        // Fade in from right
        opacity: 1,
    },
    actionButton: {
        width: 32,
        height: 32,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceHighest,
        // Web cursor
        cursor: 'pointer',
    },
    actionButtonHovered: {
        backgroundColor: theme.colors.surfacePressed,
        transform: [{ scale: 1.05 }],
    },
    actionButtonPressed: {
        transform: [{ scale: 0.95 }],
    },
    replyButton: {
        // Primary action styling - subtle blue background on hover
    },
    destructiveButton: {
        // Destructive action styling
    },
    destructiveButtonHovered: {
        backgroundColor: 'rgba(255, 59, 48, 0.15)', // 15% opacity iOS red
    },
    destructiveButtonPressed: {
        backgroundColor: 'rgba(255, 59, 48, 0.25)', // 25% opacity iOS red
        transform: [{ scale: 0.95 }],
    },
}));
