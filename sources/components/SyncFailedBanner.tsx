/**
 * SyncFailedBanner - HAP-586
 *
 * Displays a dismissible banner when message sync fails but cached messages are available.
 * This provides graceful degradation - users can still view their previously loaded messages
 * with a clear indicator that the data may be stale.
 */
import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { layout } from '@/components/layout';

interface SyncFailedBannerProps {
    /** Called when user taps retry button */
    onRetry: () => void;
    /** Called when user dismisses the banner */
    onDismiss?: () => void;
}

export const SyncFailedBanner = React.memo(({ onRetry, onDismiss }: SyncFailedBannerProps) => {
    const { theme } = useUnistyles();

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.box.warning.background }]}>
            <View style={styles.content}>
                <Ionicons
                    name="cloud-offline-outline"
                    size={18}
                    color={theme.colors.box.warning.text}
                    style={styles.icon}
                />
                <View style={styles.textContainer}>
                    <Text style={[styles.message, { color: theme.colors.box.warning.text }]}>
                        {t('session.syncFailedBanner.message')}
                    </Text>
                </View>
                <Pressable
                    onPress={onRetry}
                    style={[styles.retryButton, { backgroundColor: theme.colors.warning }]}
                    hitSlop={8}
                >
                    <Ionicons name="refresh" size={14} color="#fff" />
                    <Text style={styles.retryText}>
                        {t('session.syncFailedBanner.retry')}
                    </Text>
                </Pressable>
                {onDismiss && (
                    <Pressable onPress={onDismiss} hitSlop={12} style={styles.dismissButton}>
                        <Ionicons name="close" size={18} color={theme.colors.box.warning.text} />
                    </Pressable>
                )}
            </View>
        </View>
    );
});

const styles = StyleSheet.create({
    container: {
        width: '100%',
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    icon: {
        marginRight: 10,
    },
    textContainer: {
        flex: 1,
    },
    message: {
        fontSize: 13,
        fontWeight: '500',
    },
    retryButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 100,
        marginLeft: 8,
        gap: 4,
    },
    retryText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '600',
    },
    dismissButton: {
        marginLeft: 8,
        padding: 4,
    },
});
