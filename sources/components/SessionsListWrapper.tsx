import * as React from 'react';
import { View, ActivityIndicator, Pressable, Text } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Header } from './navigation/Header';
import { SessionsList } from './SessionsList';
import { EmptyMainScreen } from './EmptyMainScreen';
import { FAB } from './FAB';
import { useVisibleSessionListViewData } from '@/hooks/useVisibleSessionListViewData';
import { useSocketStatus, useAllSessions, useAllMachines } from '@/sync/storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { StatusDot } from './StatusDot';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { useMultiSelect } from '@/hooks/useMultiSelect';
import { MultiSelectProvider } from './MultiSelectContext';
import { MultiSelectActionBar } from './MultiSelectActionBar';
import { BulkRestoreProgress } from './BulkRestoreProgress';
import { useBulkSessionRestore } from '@/hooks/useBulkSessionRestore';
import { Session, Machine } from '@/sync/storageTypes';
import { isMachineOnline } from '@/utils/machineUtils';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    loadingContainerWrapper: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    loadingContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingBottom: 32,
    },
    emptyStateContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
        flexDirection: 'column',
        backgroundColor: theme.colors.groupped.background,
    },
    emptyStateContentContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
    },
    headerButton: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },
    logoContainer: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },
    titleContainer: {
        flex: 1,
        alignItems: 'center',
    },
    titleText: {
        fontSize: 17,
        color: theme.colors.header.tint,
        fontWeight: '600',
        ...Typography.default('semiBold'),
    },
    selectModeTitle: {
        fontSize: 17,
        color: theme.colors.header.tint,
        fontWeight: '600',
        ...Typography.default('semiBold'),
    },
    statusContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: -2,
    },
    statusDot: {
        marginRight: 4,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '500',
        lineHeight: 16,
        ...Typography.default(),
    },
    statusConnected: {
        color: theme.colors.status.connected,
    },
    statusConnecting: {
        color: theme.colors.status.connecting,
    },
    statusDisconnected: {
        color: theme.colors.status.disconnected,
    },
    statusError: {
        color: theme.colors.status.error,
    },
    statusDefault: {
        color: theme.colors.status.default,
    },
    cancelText: {
        fontSize: 16,
        color: theme.colors.textLink,
        ...Typography.default(),
    },
    selectText: {
        fontSize: 16,
        color: theme.colors.textLink,
        ...Typography.default(),
    },
}));

function HeaderTitle({ isSelectMode }: { isSelectMode: boolean }) {
    const socketStatus = useSocketStatus();
    const styles = stylesheet;

    // In select mode, show different title
    if (isSelectMode) {
        return (
            <View style={styles.titleContainer}>
                <Text style={styles.selectModeTitle}>
                    {t('bulkRestore.selectSessions')}
                </Text>
            </View>
        );
    }

    const getConnectionStatus = () => {
        const { status } = socketStatus;
        switch (status) {
            case 'connected':
                return {
                    color: styles.statusConnected.color,
                    isPulsing: false,
                    text: t('status.connected'),
                    textColor: styles.statusConnected.color
                };
            case 'connecting':
                return {
                    color: styles.statusConnecting.color,
                    isPulsing: true,
                    text: t('status.connecting'),
                    textColor: styles.statusConnecting.color
                };
            case 'disconnected':
                return {
                    color: styles.statusDisconnected.color,
                    isPulsing: false,
                    text: t('status.disconnected'),
                    textColor: styles.statusDisconnected.color
                };
            case 'error':
                return {
                    color: styles.statusError.color,
                    isPulsing: false,
                    text: t('status.error'),
                    textColor: styles.statusError.color
                };
            default:
                return {
                    color: styles.statusDefault.color,
                    isPulsing: false,
                    text: '',
                    textColor: styles.statusDefault.color
                };
        }
    };

    const connectionStatus = getConnectionStatus();

    return (
        <View style={styles.titleContainer}>
            <Text style={styles.titleText}>
                {t('tabs.sessions')}
            </Text>
            {connectionStatus.text && (
                <View style={styles.statusContainer}>
                    <StatusDot
                        color={connectionStatus.color}
                        isPulsing={connectionStatus.isPulsing}
                        size={6}
                        style={styles.statusDot}
                    />
                    <Text style={[
                        styles.statusText,
                        { color: connectionStatus.textColor }
                    ]}>
                        {connectionStatus.text}
                    </Text>
                </View>
            )}
        </View>
    );
}

function HeaderLeft({ isSelectMode }: { isSelectMode: boolean }) {
    const styles = stylesheet;
    const { theme } = useUnistyles();

    // In select mode, don't show logo
    if (isSelectMode) {
        return <View style={styles.logoContainer} />;
    }

    return (
        <View style={styles.logoContainer}>
            <Image
                source={require('@/assets/images/logo-black.png')}
                contentFit="contain"
                style={[{ width: 24, height: 24 }]}
                tintColor={theme.colors.header.tint}
            />
        </View>
    );
}

interface HeaderRightProps {
    isSelectMode: boolean;
    hasEligibleSessions: boolean;
    onEnterSelectMode: () => void;
    onExitSelectMode: () => void;
}

function HeaderRight({ isSelectMode, hasEligibleSessions, onEnterSelectMode, onExitSelectMode }: HeaderRightProps) {
    const router = useRouter();
    const styles = stylesheet;
    const { theme } = useUnistyles();

    if (isSelectMode) {
        return (
            <Pressable
                onPress={onExitSelectMode}
                hitSlop={15}
                style={styles.headerButton}
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel')}
            >
                <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </Pressable>
        );
    }

    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {/* Select button - only show if there are eligible sessions */}
            {hasEligibleSessions && (
                <Pressable
                    onPress={onEnterSelectMode}
                    hitSlop={15}
                    style={styles.headerButton}
                    accessibilityRole="button"
                    accessibilityLabel={t('bulkRestore.select')}
                >
                    <Text style={styles.selectText}>{t('bulkRestore.select')}</Text>
                </Pressable>
            )}
            {/* Add new session button */}
            <Pressable
                onPress={() => router.push('/new')}
                hitSlop={15}
                style={styles.headerButton}
                accessibilityRole="button"
                accessibilityLabel={t('newSession.title')}
            >
                <Ionicons name="add-outline" size={28} color={theme.colors.header.tint} />
            </Pressable>
        </View>
    );
}

/**
 * Filters sessions to find those eligible for bulk restore:
 * - Must be archived (not active)
 * - Must be Claude sessions (not Codex)
 * - Must have machine info for restore
 */
function getEligibleSessions(sessions: Session[], machines: Machine[]): Session[] {
    return sessions.filter(session => {
        // Must be inactive (archived)
        if (session.active) return false;

        // Must be Claude session (Codex doesn't support --resume)
        const isClaudeSession = !session.metadata?.flavor || session.metadata.flavor === 'claude';
        if (!isClaudeSession) return false;

        // Must have machine info
        if (!session.metadata?.machineId || !session.metadata?.path) return false;

        // Check if machine exists and is online
        const machine = machines.find(m => m.id === session.metadata?.machineId);
        if (!machine || !isMachineOnline(machine)) return false;

        return true;
    });
}

export const SessionsListWrapper = React.memo(() => {
    const { theme } = useUnistyles();
    const sessionListViewData = useVisibleSessionListViewData();
    const allSessions = useAllSessions();
    const machines = useAllMachines();
    const styles = stylesheet;

    // Multi-select state
    const multiSelect = useMultiSelect<string>();
    const {
        isSelectMode,
        selectedIds,
        selectedCount,
        enterSelectMode,
        exitSelectMode,
        toggleItem,
        isSelected,
        selectAll,
        deselectAll,
    } = multiSelect;

    // Bulk restore hook
    const { restore, progress, isRestoring, cancel, reset } = useBulkSessionRestore();

    // Get eligible sessions for bulk restore
    const eligibleSessions = React.useMemo(() => {
        return getEligibleSessions(allSessions, machines);
    }, [allSessions, machines]);

    const hasEligibleSessions = eligibleSessions.length > 0;

    // Handle select all - select all eligible sessions
    const handleSelectAll = React.useCallback(() => {
        const eligibleIds = eligibleSessions.map(s => s.id);
        selectAll(eligibleIds);
    }, [eligibleSessions, selectAll]);

    // Handle restore action
    const handleRestore = React.useCallback(async () => {
        const sessionsToRestore = eligibleSessions.filter(s => selectedIds.has(s.id));
        if (sessionsToRestore.length === 0) return;

        await restore(sessionsToRestore);
    }, [eligibleSessions, selectedIds, restore]);

    // Handle progress modal close
    const handleProgressClose = React.useCallback(() => {
        reset();
        exitSelectMode();
    }, [reset, exitSelectMode]);

    // Create context value for multi-select
    const multiSelectContextValue = React.useMemo(() => ({
        isSelectMode,
        selectedIds,
        toggleItem,
        isSelected,
        enterSelectMode,
        exitSelectMode,
        selectAll: (sessions: Session[]) => selectAll(sessions.map(s => s.id)),
        deselectAll,
        selectedCount,
    }), [isSelectMode, selectedIds, toggleItem, isSelected, enterSelectMode, exitSelectMode, selectAll, deselectAll, selectedCount]);

    return (
        <MultiSelectProvider value={multiSelectContextValue}>
            <View style={styles.container}>
                <View style={{ backgroundColor: theme.colors.groupped.background }}>
                    <Header
                        title={<HeaderTitle isSelectMode={isSelectMode} />}
                        headerRight={() => (
                            <HeaderRight
                                isSelectMode={isSelectMode}
                                hasEligibleSessions={hasEligibleSessions}
                                onEnterSelectMode={enterSelectMode}
                                onExitSelectMode={exitSelectMode}
                            />
                        )}
                        headerLeft={() => <HeaderLeft isSelectMode={isSelectMode} />}
                        headerShadowVisible={false}
                        headerTransparent={true}
                    />
                </View>

                {sessionListViewData === null ? (
                    <View style={styles.loadingContainerWrapper}>
                        <View style={styles.loadingContainer}>
                            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                        </View>
                    </View>
                ) : sessionListViewData.length === 0 ? (
                    <View style={styles.emptyStateContainer}>
                        <View style={styles.emptyStateContentContainer}>
                            <EmptyMainScreen />
                        </View>
                    </View>
                ) : (
                    <>
                        <SessionsList eligibleSessionIds={new Set(eligibleSessions.map(s => s.id))} />
                        {/* Only show FAB when not in select mode */}
                        {!isSelectMode && <FAB />}
                    </>
                )}

                {/* Multi-select action bar */}
                <MultiSelectActionBar
                    visible={isSelectMode}
                    selectedCount={selectedCount}
                    onRestore={handleRestore}
                    onSelectAll={handleSelectAll}
                    isRestoring={isRestoring}
                />

                {/* Bulk restore progress modal */}
                <BulkRestoreProgress
                    progress={progress}
                    isRestoring={isRestoring}
                    onCancel={cancel}
                    onClose={handleProgressClose}
                />
            </View>
        </MultiSelectProvider>
    );
});
