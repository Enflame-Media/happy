import React from 'react';
import { View, Text, Pressable, Platform, Modal as RNModal } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Typography } from '@/constants/Typography';
import { Item } from '@/components/Item';
import { FloatingOverlay } from '@/components/FloatingOverlay';
import { t } from '@/text';

interface RecentPathsDropdownProps {
    visible: boolean;
    onClose: () => void;
    recentPaths: string[];
    selectedPath: string;
    onSelectPath: (path: string) => void;
    onBrowseAll: () => void;
}

/**
 * Dropdown component showing recent paths for quick selection.
 * Displays recent paths filtered by machine and a "Browse all..." option
 * to navigate to the full path picker screen.
 */
export const RecentPathsDropdown = React.memo<RecentPathsDropdownProps>(({
    visible,
    onClose,
    recentPaths,
    selectedPath,
    onSelectPath,
    onBrowseAll,
}) => {
    const { theme } = useUnistyles();
    const styles = stylesheet;

    if (!visible) return null;

    const handleSelectPath = (path: string) => {
        onSelectPath(path);
        onClose();
    };

    const handleBrowseAll = () => {
        onBrowseAll();
        onClose();
    };

    return (
        <RNModal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <Pressable
                style={styles.backdrop}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel')}
            >
                <View style={styles.dropdownContainer} accessibilityRole="menu">
                    <Pressable onPress={(e) => e.stopPropagation()} accessible={false}>
                        <FloatingOverlay maxHeight={300}>
                            {recentPaths.length > 0 && (
                                <>
                                    <Text style={styles.sectionHeader}>
                                        {t('newSession.recentPaths.header')}
                                    </Text>
                                    {recentPaths.map((path, index) => {
                                        const isSelected = path === selectedPath;
                                        const isLast = index === recentPaths.length - 1;

                                        return (
                                            <Item
                                                key={path}
                                                title={path}
                                                leftElement={
                                                    <Ionicons
                                                        name="folder-outline"
                                                        size={18}
                                                        color={theme.colors.textSecondary}
                                                    />
                                                }
                                                onPress={() => handleSelectPath(path)}
                                                selected={isSelected}
                                                showChevron={false}
                                                pressableStyle={isSelected ? { backgroundColor: theme.colors.surfaceSelected } : undefined}
                                                showDivider={!isLast}
                                            />
                                        );
                                    })}
                                    <View style={styles.divider} />
                                </>
                            )}
                            <Item
                                title={t('newSession.recentPaths.browseAll')}
                                leftElement={
                                    <Ionicons
                                        name="ellipsis-horizontal"
                                        size={18}
                                        color={theme.colors.textSecondary}
                                    />
                                }
                                onPress={handleBrowseAll}
                                showChevron={true}
                                showDivider={false}
                            />
                        </FloatingOverlay>
                    </Pressable>
                </View>
            </Pressable>
        </RNModal>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 24,
    },
    dropdownContainer: {
        width: '100%',
        maxWidth: 400,
    },
    sectionHeader: {
        ...Typography.default('semiBold'),
        fontSize: 13,
        color: theme.colors.textSecondary,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 8,
        textTransform: Platform.OS === 'ios' ? 'uppercase' : 'none',
        letterSpacing: Platform.OS === 'ios' ? 0.5 : 0,
    },
    divider: {
        height: 1,
        backgroundColor: theme.colors.divider,
        marginHorizontal: 16,
        marginVertical: 4,
    },
}));
