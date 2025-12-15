import React from 'react';
import { View, Pressable, ActivityIndicator } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { UserProfile, getDisplayName } from '@/sync/friendTypes';
import { Item } from '@/components/Item';
import { Avatar } from '@/components/Avatar';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

interface UserCardProps {
    user: UserProfile;
    onPress?: () => void;
    // Inline action buttons for friend requests
    onAccept?: () => void;
    onReject?: () => void;
    isProcessing?: boolean;
}

export function UserCard({
    user,
    onPress,
    onAccept,
    onReject,
    isProcessing = false,
}: UserCardProps) {
    const { theme } = useUnistyles();
    const displayName = getDisplayName(user);
    const avatarUrl = user.avatar?.url || user.avatar?.path;

    // Create avatar element using the Avatar component
    const avatarElement = (
        <Avatar
            id={user.id}
            size={40}
            imageUrl={avatarUrl}
            thumbhash={user.avatar?.thumbhash}
        />
    );

    // Create subtitle
    const subtitle = `@${user.username}`;

    // Create action buttons for pending requests
    const actionButtons = (onAccept || onReject) ? (
        <View style={styles.actionButtons}>
            {isProcessing ? (
                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
            ) : (
                <>
                    {onReject && (
                        <Pressable
                            onPress={onReject}
                            style={({ pressed }) => [
                                styles.actionButton,
                                pressed && styles.actionButtonPressed,
                            ]}
                            hitSlop={8}
                        >
                            <Ionicons name="close" size={22} color={theme.colors.textDestructive} />
                        </Pressable>
                    )}
                    {onAccept && (
                        <Pressable
                            onPress={onAccept}
                            style={({ pressed }) => [
                                styles.actionButton,
                                styles.acceptButton,
                                pressed && styles.actionButtonPressed,
                            ]}
                            hitSlop={8}
                        >
                            <Ionicons name="checkmark" size={22} color="#34C759" />
                        </Pressable>
                    )}
                </>
            )}
        </View>
    ) : undefined;

    return (
        <Item
            title={displayName}
            subtitle={subtitle}
            subtitleLines={1}
            leftElement={avatarElement}
            rightElement={actionButtons}
            onPress={onPress}
            showChevron={!!onPress && !actionButtons}
        />
    );
}

const styles = StyleSheet.create((theme) => ({
    actionButtons: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    actionButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: theme.colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    acceptButton: {
        backgroundColor: 'rgba(52, 199, 89, 0.1)',
        borderColor: 'rgba(52, 199, 89, 0.3)',
    },
    actionButtonPressed: {
        opacity: 0.7,
    },
}));