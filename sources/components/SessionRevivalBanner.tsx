/**
 * SessionRevivalBanner - HAP-742
 *
 * Displays a loading banner when a session is being revived/reconnected.
 * Shows a spinner with "Reconnecting to session..." message and description.
 * Can be dismissed manually or will auto-dismiss when revival succeeds.
 */
import * as React from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { layout } from '@/components/layout';

interface SessionRevivalBannerProps {
    /** Called when user dismisses the banner */
    onDismiss?: () => void;
}

export const SessionRevivalBanner = React.memo(({ onDismiss }: SessionRevivalBannerProps) => {
    const { theme } = useUnistyles();

    // Use connecting status color for revival state (blue info color)
    const accentColor = theme.colors.status.connecting;

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.surfaceHigh }]}>
            <View style={styles.content}>
                <ActivityIndicator
                    size="small"
                    color={accentColor}
                    style={styles.spinner}
                />
                <View style={styles.textContainer}>
                    <Text style={[styles.title, { color: theme.colors.text }]}>
                        {t('session.revival.reviving')}
                    </Text>
                    <Text style={[styles.description, { color: theme.colors.textSecondary }]}>
                        {t('session.revival.revivingDescription')}
                    </Text>
                </View>
                {onDismiss && (
                    <Pressable onPress={onDismiss} hitSlop={12} style={styles.dismissButton}>
                        <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
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
        paddingVertical: 12,
    },
    content: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    spinner: {
        marginRight: 12,
        marginTop: 2,
    },
    textContainer: {
        flex: 1,
    },
    title: {
        fontSize: 14,
        fontWeight: '600',
        marginBottom: 2,
    },
    description: {
        fontSize: 13,
        fontWeight: '400',
        opacity: 0.9,
    },
    dismissButton: {
        marginLeft: 8,
        padding: 4,
    },
});
