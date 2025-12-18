/**
 * MultiSelectActionBar - Bottom action bar for multi-select operations
 *
 * Slides up from the bottom when items are selected in multi-select mode.
 * Shows count of selected items and action buttons (e.g., Restore Selected).
 */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
    useAnimatedStyle,
    withTiming,
    Easing,
} from 'react-native-reanimated';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { hapticsLight } from '@/components/haptics';

interface MultiSelectActionBarProps {
    /** Whether the action bar is visible */
    visible: boolean;
    /** Number of selected items */
    selectedCount: number;
    /** Called when restore button is pressed */
    onRestore: () => void;
    /** Called when select all is pressed */
    onSelectAll: () => void;
    /** Whether restore is in progress */
    isRestoring?: boolean;
}

export const MultiSelectActionBar = React.memo(function MultiSelectActionBar({
    visible,
    selectedCount,
    onRestore,
    onSelectAll,
    isRestoring = false,
}: MultiSelectActionBarProps) {
    const { theme } = useUnistyles();
    const insets = useSafeAreaInsets();

    const handleRestore = React.useCallback(() => {
        if (!isRestoring && selectedCount > 0) {
            hapticsLight();
            onRestore();
        }
    }, [isRestoring, selectedCount, onRestore]);

    const handleSelectAll = React.useCallback(() => {
        hapticsLight();
        onSelectAll();
    }, [onSelectAll]);

    // Animated slide-up effect
    const containerAnimatedStyle = useAnimatedStyle(() => {
        return {
            transform: [
                {
                    translateY: withTiming(visible ? 0 : 120, {
                        duration: 250,
                        easing: Easing.out(Easing.cubic),
                    }),
                },
            ],
            opacity: withTiming(visible ? 1 : 0, {
                duration: 200,
            }),
        };
    }, [visible]);

    const styles = StyleSheet.create({
        container: {
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: theme.colors.surface,
            borderTopWidth: 1,
            borderTopColor: theme.colors.divider,
            paddingBottom: insets.bottom || 16,
            shadowColor: theme.colors.shadow.color,
            shadowOffset: { width: 0, height: -2 },
            shadowOpacity: 0.1,
            shadowRadius: 4,
            elevation: 8,
        },
        content: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingVertical: 12,
            gap: 12,
        },
        countContainer: {
            flex: 1,
        },
        countText: {
            fontSize: 15,
            color: theme.colors.text,
        },
        selectAllButton: {
            paddingHorizontal: 12,
            paddingVertical: 8,
        },
        selectAllText: {
            fontSize: 14,
            color: theme.colors.textLink,
        },
        restoreButton: {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: '#34C759',
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderRadius: 20,
            gap: 6,
        },
        restoreButtonDisabled: {
            backgroundColor: theme.colors.textSecondary,
            opacity: 0.5,
        },
        restoreButtonText: {
            fontSize: 15,
            color: 'white',
        },
    });

    const isDisabled = selectedCount === 0 || isRestoring;

    return (
        <Animated.View style={[styles.container, containerAnimatedStyle]}>
            <View style={styles.content}>
                {/* Selected count */}
                <View style={styles.countContainer}>
                    <Text style={[styles.countText, Typography.default('semiBold')]}>
                        {t('bulkRestore.selectedCount', { count: selectedCount })}
                    </Text>
                </View>

                {/* Select All button */}
                <Pressable
                    style={styles.selectAllButton}
                    onPress={handleSelectAll}
                >
                    <Text style={[styles.selectAllText, Typography.default('semiBold')]}>
                        {t('bulkRestore.selectAll')}
                    </Text>
                </Pressable>

                {/* Restore button */}
                <Pressable
                    style={[
                        styles.restoreButton,
                        isDisabled && styles.restoreButtonDisabled,
                    ]}
                    onPress={handleRestore}
                    disabled={isDisabled}
                >
                    <Ionicons name="refresh-circle" size={18} color="white" />
                    <Text style={[styles.restoreButtonText, Typography.default('semiBold')]}>
                        {t('bulkRestore.restoreSelected', { count: selectedCount })}
                    </Text>
                </Pressable>
            </View>
        </Animated.View>
    );
});
