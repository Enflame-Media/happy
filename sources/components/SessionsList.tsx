import React from 'react';
import { View, Pressable, FlatList, Platform } from 'react-native';
import { Text } from '@/components/StyledText';
import { usePathname } from 'expo-router';
import { SessionListViewItem } from '@/sync/storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { getSessionName, useSessionStatus, getSessionSubtitle, getSessionAvatarId } from '@/utils/sessionUtils';
import { Avatar } from './Avatar';
import { ActiveSessionsGroup } from './ActiveSessionsGroup';
import { ActiveSessionsGroupCompact } from './ActiveSessionsGroupCompact';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSetting } from '@/sync/storage';
import { useVisibleSessionListViewData } from '@/hooks/useVisibleSessionListViewData';
import { Typography } from '@/constants/Typography';
import { Session } from '@/sync/storageTypes';
import { StatusDot } from './StatusDot';
import { ContextMeter } from './ContextMeter';
import { StyleSheet } from 'react-native-unistyles';
import { useIsTablet } from '@/utils/responsive';
import { requestReview } from '@/utils/requestReview';
import { layout } from './layout';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { useSessionContextMenu } from '@/hooks/useSessionContextMenu';
import { QuickStartCard } from './QuickStartCard';
import { SwipeableSessionRow } from './SwipeableSessionRow';

// Item height constants for getItemLayout optimization
// These enable O(1) scroll position calculations instead of O(n) measurement
const ITEM_HEIGHTS = {
    session: 89,        // 88px height + 1px marginBottom (typical non-last item)
    sessionLast: 100,   // 88px height + 12px marginBottom (last item in group)
    header: 46,         // paddingTop(20) + paddingBottom(8) + text(~18)
    projectGroup: 53,   // paddingVertical(20) + title(18) + subtitle(13) + marginTop(2)
} as const;

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'stretch',
        backgroundColor: theme.colors.groupped.background,
    },
    contentContainer: {
        flex: 1,
        maxWidth: layout.maxWidth,
    },
    headerSection: {
        backgroundColor: theme.colors.groupped.background,
        paddingHorizontal: 24,
        paddingTop: 20,
        paddingBottom: 8,
    },
    headerText: {
        fontSize: 14,
        fontWeight: '600',
        color: theme.colors.groupped.sectionTitle,
        letterSpacing: 0.1,
        ...Typography.default('semiBold'),
    },
    projectGroup: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: theme.colors.surface,
    },
    projectGroupTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    projectGroupSubtitle: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        marginTop: 2,
        ...Typography.default(),
    },
    sessionItem: {
        height: 88,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        backgroundColor: theme.colors.surface,
        marginHorizontal: 16,
        marginBottom: 1,
    },
    sessionItemFirst: {
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
    },
    sessionItemLast: {
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
        marginBottom: 12,
    },
    sessionItemSingle: {
        borderRadius: 12,
        marginBottom: 12,
    },
    sessionItemSelected: {
        backgroundColor: theme.colors.surfaceSelected,
    },
    // Active state backgrounds for enhanced visibility
    sessionItemThinking: {
        backgroundColor: Platform.select({
            ios: 'rgba(0, 122, 255, 0.06)',
            default: 'rgba(0, 122, 255, 0.04)',
        }),
    },
    sessionItemPermission: {
        backgroundColor: Platform.select({
            ios: 'rgba(255, 149, 0, 0.06)',
            default: 'rgba(255, 149, 0, 0.04)',
        }),
    },
    sessionContent: {
        flex: 1,
        marginLeft: 16,
        justifyContent: 'center',
    },
    sessionTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 2,
    },
    sessionTitle: {
        fontSize: 15,
        fontWeight: '500',
        flex: 1,
        ...Typography.default('semiBold'),
    },
    sessionTitleConnected: {
        color: theme.colors.text,
    },
    sessionTitleDisconnected: {
        color: theme.colors.textSecondary,
    },
    sessionSubtitle: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        marginBottom: 4,
        ...Typography.default(),
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    statusRowLeft: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    statusIndicators: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        transform: [{ translateY: 1 }],
    },
    statusDotContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        height: 16,
        marginTop: 2,
        marginRight: 4,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '500',
        lineHeight: 16,
        ...Typography.default(),
    },
    avatarContainer: {
        position: 'relative',
        width: 48,
        height: 48,
    },
    draftIconContainer: {
        position: 'absolute',
        bottom: -2,
        right: -2,
        width: 18,
        height: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    draftIconOverlay: {
        color: theme.colors.textSecondary,
    },
    artifactsSection: {
        paddingHorizontal: 16,
        paddingBottom: 12,
        backgroundColor: theme.colors.groupped.background,
    },
}));

export function SessionsList() {
    const styles = stylesheet;
    const safeArea = useSafeAreaInsets();
    const data = useVisibleSessionListViewData();
    const pathname = usePathname();
    const isTablet = useIsTablet();
    const compactSessionView = useSetting('compactSessionView');
    const selectable = isTablet;

    // Memoize contentContainerStyle to prevent FlatList re-renders
    const contentContainerStyle = React.useMemo(() => ({
        paddingBottom: safeArea.bottom + 128,
        maxWidth: layout.maxWidth
    }), [safeArea.bottom]);

    const dataWithSelected = selectable ? React.useMemo(() => {
        return data?.map(item => ({
            ...item,
            selected: pathname.startsWith(`/session/${item.type === 'session' ? item.session.id : ''}`)
        }));
    }, [data, pathname]) : data;

    // Request review
    const hasData = data && data.length > 0;
    React.useEffect(() => {
        if (hasData) {
            requestReview();
        }
    }, [hasData]);

    // Early return if no data yet
    if (!data) {
        return (
            <View style={styles.container} />
        );
    }

    const keyExtractor = React.useCallback((item: SessionListViewItem & { selected?: boolean }, index: number) => {
        switch (item.type) {
            case 'header': return `header-${item.title}-${index}`;
            case 'active-sessions': return 'active-sessions';
            case 'project-group': return `project-group-${item.machine.id}-${item.displayPath}-${index}`;
            case 'session': return `session-${item.session.id}`;
        }
    }, []);

    // Check if list contains active-sessions (variable height) - skip getItemLayout if so
    const hasActiveSessions = React.useMemo(() =>
        dataWithSelected?.some(item => item.type === 'active-sessions') ?? false,
    [dataWithSelected]);

    // getItemLayout for O(1) scroll position calculations
    // Only used when list contains fixed-height items (no active-sessions group)
    const getItemLayout = React.useCallback((
        _data: ArrayLike<SessionListViewItem & { selected?: boolean }> | null | undefined,
        index: number
    ) => {
        if (!dataWithSelected || hasActiveSessions) {
            // Fallback for variable-height lists - use average session height
            return { length: ITEM_HEIGHTS.session, offset: ITEM_HEIGHTS.session * index, index };
        }

        // Calculate exact offset by summing heights of all items before this index
        let offset = 0;
        for (let i = 0; i < index && i < dataWithSelected.length; i++) {
            const item = dataWithSelected[i];
            switch (item.type) {
                case 'header':
                    offset += ITEM_HEIGHTS.header;
                    break;
                case 'project-group':
                    offset += ITEM_HEIGHTS.projectGroup;
                    break;
                case 'session': {
                    // Check if this is the last session in its group
                    const nextItem = dataWithSelected[i + 1];
                    const isLast = !nextItem || nextItem.type === 'header' || nextItem.type === 'active-sessions';
                    offset += isLast ? ITEM_HEIGHTS.sessionLast : ITEM_HEIGHTS.session;
                    break;
                }
                case 'active-sessions':
                    // This shouldn't happen since we check hasActiveSessions above
                    // but include for type safety
                    offset += ITEM_HEIGHTS.session * item.sessions.length;
                    break;
            }
        }

        // Get length of current item
        const currentItem = dataWithSelected[index];
        let length: number = ITEM_HEIGHTS.session; // default
        if (currentItem) {
            switch (currentItem.type) {
                case 'header':
                    length = ITEM_HEIGHTS.header;
                    break;
                case 'project-group':
                    length = ITEM_HEIGHTS.projectGroup;
                    break;
                case 'session': {
                    const nextItem = dataWithSelected[index + 1];
                    const isLast = !nextItem || nextItem.type === 'header' || nextItem.type === 'active-sessions';
                    length = isLast ? ITEM_HEIGHTS.sessionLast : ITEM_HEIGHTS.session;
                    break;
                }
                case 'active-sessions':
                    length = ITEM_HEIGHTS.session * currentItem.sessions.length;
                    break;
            }
        }

        return { length, offset, index };
    }, [dataWithSelected, hasActiveSessions]);

    const renderItem = React.useCallback(({ item, index }: { item: SessionListViewItem & { selected?: boolean }, index: number }) => {
        switch (item.type) {
            case 'header':
                return (
                    <View style={styles.headerSection}>
                        <Text style={styles.headerText}>
                            {item.title}
                        </Text>
                    </View>
                );

            case 'active-sessions':
                // Extract just the session ID from pathname (e.g., /session/abc123/file -> abc123)
                let selectedId: string | undefined;
                if (isTablet && pathname.startsWith('/session/')) {
                    const parts = pathname.split('/');
                    selectedId = parts[2]; // parts[0] is empty, parts[1] is 'session', parts[2] is the ID
                }

                const ActiveComponent = compactSessionView ? ActiveSessionsGroupCompact : ActiveSessionsGroup;
                return (
                    <ActiveComponent
                        sessions={item.sessions}
                        selectedSessionId={selectedId}
                    />
                );

            case 'project-group':
                return (
                    <View style={styles.projectGroup}>
                        <Text style={styles.projectGroupTitle}>
                            {item.displayPath}
                        </Text>
                        <Text style={styles.projectGroupSubtitle}>
                            {item.machine.metadata?.displayName || item.machine.metadata?.host || item.machine.id}
                        </Text>
                    </View>
                );

            case 'session':
                // Determine card styling based on position within date group
                const prevItem = index > 0 && dataWithSelected ? dataWithSelected[index - 1] : null;
                const nextItem = index < (dataWithSelected?.length || 0) - 1 && dataWithSelected ? dataWithSelected[index + 1] : null;

                const isFirst = prevItem?.type === 'header';
                const isLast = nextItem?.type === 'header' || nextItem == null || nextItem?.type === 'active-sessions';
                const isSingle = isFirst && isLast;

                return (
                    <SwipeableSessionRow session={item.session}>
                        <SessionItem
                            session={item.session}
                            selected={item.selected}
                            isFirst={isFirst}
                            isLast={isLast}
                            isSingle={isSingle}
                        />
                    </SwipeableSessionRow>
                );
        }
    }, [pathname, dataWithSelected, compactSessionView, isTablet, styles]);


    // Remove this section as we'll use FlatList for all items now


    const HeaderComponent = React.useCallback(() => {
        return (
            <View>
                {/* <View style={{ marginHorizontal: -4 }}>
                    <UpdateBanner />
                </View> */}
                <QuickStartCard />
            </View>
        );
    }, []);

    // Footer removed - all sessions now shown inline

    return (
        <View style={styles.container}>
            <View style={styles.contentContainer}>
                <FlatList
                    data={dataWithSelected}
                    renderItem={renderItem}
                    keyExtractor={keyExtractor}
                    getItemLayout={hasActiveSessions ? undefined : getItemLayout}
                    contentContainerStyle={contentContainerStyle}
                    ListHeaderComponent={HeaderComponent}
                />
            </View>
        </View>
    );
}

// Sub-component that handles session message logic
const SessionItem = React.memo(({ session, selected, isFirst, isLast, isSingle }: {
    session: Session;
    selected?: boolean;
    isFirst?: boolean;
    isLast?: boolean;
    isSingle?: boolean;
}) => {
    const styles = stylesheet;
    const sessionStatus = useSessionStatus(session);
    const sessionName = getSessionName(session);
    const sessionSubtitle = getSessionSubtitle(session);
    const navigateToSession = useNavigateToSession();
    const isTablet = useIsTablet();
    const { showContextMenu } = useSessionContextMenu(session);

    const avatarId = React.useMemo(() => {
        return getSessionAvatarId(session);
    }, [session]);

    // Determine background tinting for active states
    const activeStateStyle = sessionStatus.state === 'thinking' ? styles.sessionItemThinking
        : sessionStatus.state === 'permission_required' ? styles.sessionItemPermission
        : undefined;

    return (
        <Pressable
            style={[
                styles.sessionItem,
                selected && styles.sessionItemSelected,
                activeStateStyle,
                isSingle ? styles.sessionItemSingle :
                    isFirst ? styles.sessionItemFirst :
                        isLast ? styles.sessionItemLast : {}
            ]}
            onPressIn={() => {
                if (isTablet) {
                    navigateToSession(session.id);
                }
            }}
            onPress={() => {
                if (!isTablet) {
                    navigateToSession(session.id);
                }
            }}
            onLongPress={showContextMenu}
            delayLongPress={500}
        >
            <View style={styles.avatarContainer}>
                <Avatar id={avatarId} size={48} monochrome={!sessionStatus.isConnected} flavor={session.metadata?.flavor} />
                {session.draft && (
                    <View style={styles.draftIconContainer}>
                        <Ionicons
                            name="create-outline"
                            size={12}
                            style={styles.draftIconOverlay}
                        />
                    </View>
                )}
            </View>
            <View style={styles.sessionContent}>
                {/* Title line */}
                <View style={styles.sessionTitleRow}>
                    <Text style={[
                        styles.sessionTitle,
                        sessionStatus.isConnected ? styles.sessionTitleConnected : styles.sessionTitleDisconnected
                    ]} numberOfLines={1}> {/* {variant !== 'no-path' ? 1 : 2} - issue is we don't have anything to take this space yet and it looks strange - if summaries were more reliably generated, we can add this. While no summary - add something like "New session" or "Empty session", and extend summary to 2 lines once we have it */}
                        {sessionName}
                    </Text>
                </View>

                {/* Subtitle line */}
                <Text style={styles.sessionSubtitle} numberOfLines={1}>
                    {sessionSubtitle}
                </Text>

                {/* Status line with dot */}
                <View style={styles.statusRow}>
                    <View style={styles.statusRowLeft}>
                        <View style={styles.statusDotContainer}>
                            <StatusDot color={sessionStatus.statusDotColor} isPulsing={sessionStatus.isPulsing} />
                        </View>
                        <Text style={[
                            styles.statusText,
                            { color: sessionStatus.statusColor }
                        ]}>
                            {sessionStatus.statusText}
                        </Text>
                    </View>

                    {/* Status indicators on the right side */}
                    <View style={styles.statusIndicators}>
                        {/* Context usage indicator */}
                        {session.latestUsage?.contextSize != null && session.latestUsage.contextSize > 0 && (
                            <ContextMeter contextSize={session.latestUsage.contextSize} />
                        )}
                    </View>
                </View>
            </View>
        </Pressable>
    );
});

