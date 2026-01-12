import React from 'react';
import { View, Pressable, FlatList, Platform, ActivityIndicator } from 'react-native';
import { Text } from '@/components/StyledText';
import { usePathname } from 'expo-router';
import { SessionListViewItem } from '@/sync/storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { getSessionName, useSessionStatus, getSessionSubtitle, getSessionAvatarId } from '@/utils/sessionUtils';
import { useLastMessagePreview } from '@/sync/storage';
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
import { CompactGitStatus } from './CompactGitStatus';
import { entitySessionColor } from './entityColor';
import { StyleSheet } from 'react-native-unistyles';
import { useIsTablet } from '@/utils/responsive';
import { requestReview } from '@/utils/requestReview';
import { layout } from './layout';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { useSessionContextMenu } from '@/hooks/useSessionContextMenu';
import { QuickStartCard } from './QuickStartCard';
import { SwipeableSessionRow } from './SwipeableSessionRow';
import { ProjectGroupCard } from './ProjectGroupCard';
import { SelectableCheckbox } from './SelectableCheckbox';
import { useMultiSelectContext } from './MultiSelectContext';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing, interpolate } from 'react-native-reanimated';
import { useScrollPerformance } from '@/utils/performance';

// Item height constants for getItemLayout optimization
// These enable O(1) scroll position calculations instead of O(n) measurement
// Note: With collapsible sessions, we disable getItemLayout when sessions are collapsed
const SESSION_HEIGHT_EXPANDED = 88;   // Full height with all details
const SESSION_HEIGHT_COLLAPSED = 56;  // Compact height without subtitle
const ITEM_HEIGHTS = {
    session: SESSION_HEIGHT_COLLAPSED + 1,        // Collapsed height + 1px marginBottom (typical non-last item)
    sessionLast: SESSION_HEIGHT_COLLAPSED + 12,   // Collapsed height + 12px marginBottom (last item in group)
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
    sessionItemContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    sessionItem: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        backgroundColor: theme.colors.surface,
    },
    sessionItemWrapper: {
        marginHorizontal: 16,
        marginBottom: 1,
        overflow: 'hidden',
    },
    sessionItemFirst: {
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
    },
    sessionItemLast: {
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
    },
    sessionItemSingle: {
        borderRadius: 12,
    },
    sessionItemContainerFirst: {
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
    },
    sessionItemContainerLast: {
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
        marginBottom: 12,
    },
    sessionItemContainerSingle: {
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
    sessionMessagePreview: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginBottom: 4,
        fontStyle: 'italic',
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
    projectColorIndicator: {
        position: 'absolute',
        left: -8,
        top: 0,
        bottom: 0,
        width: 3,
        borderRadius: 1.5,
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
    expandChevron: {
        marginLeft: 8,
        opacity: 0.4,
    },
    sessionSubtitleContainer: {
        overflow: 'hidden',
    },
    sessionMessagePreviewContainer: {
        overflow: 'hidden',
    },
    checkboxContainer: {
        marginLeft: 8,
    },
    // HAP-659: Restoring state visual feedback
    restoringOverlay: {
        ...Platform.select({
            ios: {
                backgroundColor: 'rgba(52, 199, 89, 0.08)',
            },
            default: {
                backgroundColor: 'rgba(52, 199, 89, 0.06)',
            },
        }),
    },
    restoringIndicator: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.7)',
        borderRadius: 12,
    },
    restoringIndicatorDark: {
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
}));

interface SessionsListProps {
    /** Set of session IDs eligible for bulk restore (archived Claude sessions with online machines) */
    eligibleSessionIds?: Set<string>;
}

export function SessionsList({ eligibleSessionIds }: SessionsListProps) {
    const styles = stylesheet;
    const safeArea = useSafeAreaInsets();
    const data = useVisibleSessionListViewData();
    const pathname = usePathname();
    const isTablet = useIsTablet();
    const compactSessionView = useSetting('compactSessionView');
    const selectable = isTablet;
    const { isSelectMode } = useMultiSelectContext();

    // Scroll performance monitoring (HAP-380)
    const onScrollPerformance = useScrollPerformance('SessionsList');

    // Memoize contentContainerStyle to prevent FlatList re-renders
    // Add extra padding when in select mode for the action bar
    const contentContainerStyle = React.useMemo(() => ({
        paddingBottom: safeArea.bottom + (isSelectMode ? 180 : 128),
        maxWidth: layout.maxWidth
    }), [safeArea.bottom, isSelectMode]);

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
            case 'project-group': return `project-group-${item.projectId}`;
            case 'session': return `session-${item.session.id}`;
        }
    }, []);

    // Check if list contains variable-height items - skip getItemLayout if so
    // With collapsible sessions, all session items now have variable heights
    const hasVariableHeightItems = React.useMemo(() =>
        dataWithSelected?.some(item => item.type === 'active-sessions' || item.type === 'session') ?? false,
    [dataWithSelected]);

    // getItemLayout for O(1) scroll position calculations
    // Only used when list contains fixed-height items (no collapsible sessions)
    const getItemLayout = React.useCallback((
        _data: ArrayLike<SessionListViewItem & { selected?: boolean }> | null | undefined,
        index: number
    ) => {
        if (!dataWithSelected || hasVariableHeightItems) {
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
                    // This shouldn't happen since we check hasVariableHeightItems above
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
    }, [dataWithSelected, hasVariableHeightItems]);

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

            case 'project-group': {
                // Extract selected session ID for tablet view
                let projectSelectedId: string | undefined;
                if (isTablet && pathname.startsWith('/session/')) {
                    const parts = pathname.split('/');
                    projectSelectedId = parts[2];
                }

                return (
                    <ProjectGroupCard
                        projectId={item.projectId}
                        displayPath={item.displayPath}
                        machineName={item.machineName}
                        sessions={item.sessions}
                        selectedSessionId={projectSelectedId}
                    />
                );
            }

            case 'session':
                // Determine card styling based on position within date group
                const prevItem = index > 0 && dataWithSelected ? dataWithSelected[index - 1] : null;
                const nextItem = index < (dataWithSelected?.length || 0) - 1 && dataWithSelected ? dataWithSelected[index + 1] : null;

                const isFirst = prevItem?.type === 'header';
                const isLast = nextItem?.type === 'header' || nextItem == null || nextItem?.type === 'active-sessions';
                const isSingle = isFirst && isLast;

                // Check if session is eligible for multi-select (archived Claude session with online machine)
                const isEligible = eligibleSessionIds?.has(item.session.id) ?? false;

                return (
                    <SwipeableSessionRow session={item.session} disabled={isSelectMode}>
                        <SessionItem
                            session={item.session}
                            selected={item.selected}
                            isFirst={isFirst}
                            isLast={isLast}
                            isSingle={isSingle}
                            isEligibleForSelect={isEligible}
                        />
                    </SwipeableSessionRow>
                );
        }
    }, [pathname, dataWithSelected, compactSessionView, isTablet, styles, isSelectMode, eligibleSessionIds]);


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
                    getItemLayout={hasVariableHeightItems ? undefined : getItemLayout}
                    contentContainerStyle={contentContainerStyle}
                    ListHeaderComponent={HeaderComponent}
                    onScroll={onScrollPerformance}
                    scrollEventThrottle={16}
                />
            </View>
        </View>
    );
}

/**
 * CollapsibleSessionItem - Renders inactive sessions with progressive disclosure
 *
 * Inactive sessions start collapsed (compact view) and can be expanded on tap.
 * Uses Reanimated for smooth height and opacity animations.
 *
 * Collapsed state: Shows avatar, title, and status dot only (56px)
 * Expanded state: Shows full details including subtitle and context meter (88px)
 */
const SessionItem = React.memo(({ session, selected, isFirst, isLast, isSingle, isEligibleForSelect }: {
    session: Session;
    selected?: boolean;
    isFirst?: boolean;
    isLast?: boolean;
    isSingle?: boolean;
    isEligibleForSelect?: boolean;
}) => {
    const styles = stylesheet;
    const sessionStatus = useSessionStatus(session);
    const sessionName = getSessionName(session);
    const sessionSubtitle = getSessionSubtitle(session);
    const navigateToSession = useNavigateToSession();
    const isTablet = useIsTablet();
    // Use optimized preview-only selector instead of full message subscription
    const messagePreview = useLastMessagePreview(session.id);
    const { isSelectMode, isSelected, toggleItem, enterSelectMode, isRestoring } = useMultiSelectContext();

    // HAP-659: Check if this session is currently being restored
    const isSessionRestoring = isRestoring(session.id);

    // Callback for "Select" option in context menu - enters multi-select mode and pre-selects this session
    const handleSelectFromContextMenu = React.useCallback(() => {
        enterSelectMode();
        toggleItem(session.id);
    }, [enterSelectMode, toggleItem, session.id]);

    // Pass onSelect callback only for eligible sessions
    const { showContextMenu } = useSessionContextMenu(session, isEligibleForSelect ? {
        onSelect: handleSelectFromContextMenu,
    } : undefined);

    // Inactive sessions start collapsed, expand on tap
    // Animation value: 0 = collapsed, 1 = expanded
    const expandProgress = useSharedValue(0);
    const [isExpanded, setIsExpanded] = React.useState(false);

    const avatarId = React.useMemo(() => {
        return getSessionAvatarId(session);
    }, [session]);

    // Get project color for visual distinction
    const projectColor = React.useMemo(() => {
        return entitySessionColor(session);
    }, [session]);

    // Determine background tinting for active states
    // HAP-659: Restoring state takes priority for visual feedback
    const activeStateStyle = isSessionRestoring ? styles.restoringOverlay
        : sessionStatus.state === 'thinking' ? styles.sessionItemThinking
        : sessionStatus.state === 'permission_required' ? styles.sessionItemPermission
        : undefined;

    // Check if this session is selected in multi-select mode
    const isSessionSelected = isSelectMode && isSelected(session.id);

    // Toggle expand/collapse with animation
    const handlePress = React.useCallback(() => {
        // In select mode, toggle selection for eligible sessions
        if (isSelectMode) {
            if (isEligibleForSelect) {
                toggleItem(session.id);
            }
            // Non-eligible sessions do nothing in select mode
            return;
        }

        if (isTablet) {
            // On tablet, always navigate directly
            navigateToSession(session.id);
        } else {
            // On mobile, toggle expand/collapse first tap, navigate on second
            if (isExpanded) {
                navigateToSession(session.id);
            } else {
                setIsExpanded(true);
                expandProgress.value = withTiming(1, {
                    duration: 250,
                    easing: Easing.out(Easing.cubic),
                });
            }
        }
    }, [isSelectMode, isEligibleForSelect, toggleItem, session.id, isTablet, isExpanded, navigateToSession, expandProgress]);

    const handlePressIn = React.useCallback(() => {
        // Disable pressIn behavior in select mode
        if (isSelectMode) return;

        if (isTablet) {
            navigateToSession(session.id);
        }
    }, [isSelectMode, isTablet, navigateToSession, session.id]);

    // Handle long press - in select mode, enter long-press doesn't trigger context menu
    const handleLongPress = React.useCallback(() => {
        if (isSelectMode) return;
        showContextMenu();
    }, [isSelectMode, showContextMenu]);

    // Handle checkbox toggle
    const handleCheckboxToggle = React.useCallback(() => {
        toggleItem(session.id);
    }, [toggleItem, session.id]);

    // Animated container height
    const containerAnimatedStyle = useAnimatedStyle(() => {
        const height = interpolate(
            expandProgress.value,
            [0, 1],
            [SESSION_HEIGHT_COLLAPSED, SESSION_HEIGHT_EXPANDED]
        );
        return { height };
    });

    // Animated subtitle opacity and height
    const subtitleAnimatedStyle = useAnimatedStyle(() => {
        const opacity = expandProgress.value;
        const height = interpolate(expandProgress.value, [0, 1], [0, 18]);
        const marginBottom = interpolate(expandProgress.value, [0, 1], [0, 4]);
        return { opacity, height, marginBottom };
    });

    // Animated status indicators opacity (context meter, etc.)
    const indicatorsAnimatedStyle = useAnimatedStyle(() => {
        return { opacity: expandProgress.value };
    });

    // Animated message preview - shown when collapsed, hidden when expanded
    const messagePreviewAnimatedStyle = useAnimatedStyle(() => {
        const opacity = interpolate(expandProgress.value, [0, 1], [1, 0]);
        const height = interpolate(expandProgress.value, [0, 1], [16, 0]);
        const marginBottom = interpolate(expandProgress.value, [0, 1], [2, 0]);
        return { opacity, height, marginBottom };
    });

    // Chevron rotation for expand indicator
    const chevronAnimatedStyle = useAnimatedStyle(() => {
        const rotation = interpolate(expandProgress.value, [0, 1], [0, 90]);
        const opacity = interpolate(expandProgress.value, [0, 1], [0.4, 0]);
        return {
            transform: [{ rotate: `${rotation}deg` }],
            opacity,
        };
    });

    return (
        <View style={styles.sessionItemContainer}>
            {/* Checkbox for multi-select mode */}
            <View style={styles.checkboxContainer}>
                <SelectableCheckbox
                    visible={isSelectMode}
                    selected={isSessionSelected}
                    onToggle={handleCheckboxToggle}
                    disabled={!isEligibleForSelect}
                />
            </View>

            <Animated.View
                style={[
                    styles.sessionItem,
                    selected && styles.sessionItemSelected,
                    activeStateStyle,
                    isSingle ? styles.sessionItemSingle :
                        isFirst ? styles.sessionItemFirst :
                            isLast ? styles.sessionItemLast : {},
                    containerAnimatedStyle
                ]}
            >
                <Pressable
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
                    onPressIn={handlePressIn}
                    onPress={handlePress}
                    onLongPress={handleLongPress}
                    delayLongPress={500}
                    disabled={isSessionRestoring}
                    accessibilityRole="button"
                    accessibilityLabel={`${sessionName}, ${isSessionRestoring ? 'Restoring' : sessionStatus.statusText}`}
                    accessibilityHint={isSessionRestoring ? 'Session is being restored' : isSelectMode ? (isEligibleForSelect ? 'Double tap to select' : 'Not available for selection') : 'Double tap to open session'}
                    accessibilityState={{
                        selected: selected || isSessionSelected,
                        busy: isSessionRestoring,
                    }}
                >
                    <View style={styles.avatarContainer}>
                        {/* Project color indicator for visual distinction */}
                        <View style={[styles.projectColorIndicator, { backgroundColor: projectColor }]} />
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
                            ]} numberOfLines={1}>
                                {sessionName}
                            </Text>
                            {/* Expand chevron - shown when collapsed and not in select mode */}
                            {!isSelectMode && (
                                <Animated.View style={[styles.expandChevron, chevronAnimatedStyle]}>
                                    <Ionicons
                                        name="chevron-forward"
                                        size={14}
                                        color={styles.sessionTitleDisconnected.color}
                                    />
                                </Animated.View>
                            )}
                        </View>

                        {/* Message preview - shown when collapsed for quick identification */}
                        {messagePreview && (
                            <Animated.View style={[styles.sessionMessagePreviewContainer, messagePreviewAnimatedStyle]}>
                                <Text style={styles.sessionMessagePreview} numberOfLines={1}>
                                    "{messagePreview}"
                                </Text>
                            </Animated.View>
                        )}

                        {/* Subtitle line - animated visibility */}
                        <Animated.View style={[styles.sessionSubtitleContainer, subtitleAnimatedStyle]}>
                            <Text style={styles.sessionSubtitle} numberOfLines={1}>
                                {sessionSubtitle}
                            </Text>
                        </Animated.View>

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

                            {/* Status indicators on the right side - animated visibility */}
                            <Animated.View style={[styles.statusIndicators, indicatorsAnimatedStyle]}>
                                {/* Git status indicator */}
                                <CompactGitStatus sessionId={session.id} />
                                {/* Context usage indicator with sparkline (HAP-344) */}
                                {session.latestUsage?.contextSize != null && session.latestUsage.contextSize > 0 && (
                                    <ContextMeter
                                        contextSize={session.latestUsage.contextSize}
                                        usageHistory={session.usageHistory}
                                        showSparkline={true}
                                    />
                                )}
                            </Animated.View>
                        </View>
                    </View>
                </Pressable>

                {/* HAP-659: Show loading spinner overlay when session is being restored */}
                {isSessionRestoring && (
                    <View style={styles.restoringIndicator}>
                        <ActivityIndicator size="small" color="#34C759" />
                    </View>
                )}
            </Animated.View>
        </View>
    );
});
