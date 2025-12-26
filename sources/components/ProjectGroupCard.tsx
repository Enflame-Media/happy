import React from 'react';
import { View, Pressable, Platform } from 'react-native';
import { Text } from '@/components/StyledText';
import { Session } from '@/sync/storageTypes';
import Ionicons from '@expo/vector-icons/Ionicons';
import { getSessionName, useSessionStatus, getSessionAvatarId } from '@/utils/sessionUtils';
import { Avatar } from './Avatar';
import { Typography } from '@/constants/Typography';
import { StatusDot } from './StatusDot';
import { ContextMeter } from './ContextMeter';
import { CompactGitStatus } from './CompactGitStatus';
import { StyleSheet } from 'react-native-unistyles';
import { useProjectGitStatus } from '@/sync/storage';
import { GitStatus } from '@/sync/storageTypes';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { useIsTablet } from '@/utils/responsive';
import { useSessionContextMenu } from '@/hooks/useSessionContextMenu';
import { SwipeableSessionRow } from './SwipeableSessionRow';
import { entitySessionColor } from './entityColor';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing, interpolate } from 'react-native-reanimated';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        marginHorizontal: 16,
        marginBottom: 12,
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: theme.colors.surface,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        backgroundColor: theme.colors.surface,
    },
    headerContent: {
        flex: 1,
    },
    headerTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    headerSubtitle: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 2,
        ...Typography.default(),
    },
    chevronContainer: {
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sessionsContainer: {
        overflow: 'hidden',
    },
    sessionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: theme.colors.surface,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
    },
    sessionRowSelected: {
        backgroundColor: theme.colors.surfaceSelected,
    },
    sessionRowThinking: {
        backgroundColor: Platform.select({
            ios: 'rgba(0, 122, 255, 0.06)',
            default: 'rgba(0, 122, 255, 0.04)',
        }),
    },
    sessionRowPermission: {
        backgroundColor: Platform.select({
            ios: 'rgba(255, 149, 0, 0.06)',
            default: 'rgba(255, 149, 0, 0.04)',
        }),
    },
    avatarContainer: {
        position: 'relative',
        width: 40,
        height: 40,
    },
    projectColorIndicator: {
        position: 'absolute',
        left: -8,
        top: 0,
        bottom: 0,
        width: 3,
        borderRadius: 1.5,
    },
    sessionContent: {
        flex: 1,
        marginLeft: 12,
        justifyContent: 'center',
    },
    sessionTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    sessionTitle: {
        fontSize: 14,
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
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 2,
    },
    statusRowLeft: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    statusDotContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        height: 16,
        marginRight: 4,
    },
    statusText: {
        fontSize: 11,
        fontWeight: '500',
        lineHeight: 16,
        ...Typography.default(),
    },
    statusIndicators: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    folderIcon: {
        marginRight: 8,
        opacity: 0.6,
    },
    sessionCount: {
        marginLeft: 8,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
        backgroundColor: theme.colors.surfaceHighest,
    },
    sessionCountText: {
        fontSize: 11,
        fontWeight: '500',
        color: theme.colors.textSecondary,
        ...Typography.default('semiBold'),
    },
    gitStatusContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.surfaceHighest,
        paddingHorizontal: 6,
        height: 18,
        borderRadius: 4,
        marginLeft: 6,
    },
    gitBranchText: {
        fontSize: 10,
        fontWeight: '500',
        color: theme.colors.textSecondary,
        marginLeft: 3,
        maxWidth: 80,
    },
    gitLineChanges: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        marginLeft: 4,
    },
    gitAddedText: {
        fontSize: 10,
        fontWeight: '600',
        color: theme.colors.gitAddedText,
    },
    gitRemovedText: {
        fontSize: 10,
        fontWeight: '600',
        color: theme.colors.gitRemovedText,
    },
}));

interface ProjectGroupCardProps {
    projectId: string;
    displayPath: string;
    machineName: string;
    sessions: Session[];
    selectedSessionId?: string;
}

export function ProjectGroupCard({
    projectId,
    displayPath,
    machineName,
    sessions,
    selectedSessionId
}: ProjectGroupCardProps) {
    const styles = stylesheet;
    const [isExpanded, setIsExpanded] = React.useState(false);
    const expandProgress = useSharedValue(0);
    const isTablet = useIsTablet();
    const gitStatus = useProjectGitStatus(projectId);

    const toggleExpand = React.useCallback(() => {
        const newExpanded = !isExpanded;
        setIsExpanded(newExpanded);
        expandProgress.value = withTiming(newExpanded ? 1 : 0, {
            duration: 250,
            easing: Easing.out(Easing.cubic),
        });
    }, [isExpanded, expandProgress]);

    const chevronAnimatedStyle = useAnimatedStyle(() => {
        const rotation = interpolate(expandProgress.value, [0, 1], [0, 90]);
        return {
            transform: [{ rotate: `${rotation}deg` }],
        };
    });

    const sessionsContainerAnimatedStyle = useAnimatedStyle(() => {
        // Estimate height based on number of sessions (64px per session)
        const maxHeight = sessions.length * 64;
        const height = interpolate(expandProgress.value, [0, 1], [0, maxHeight]);
        const opacity = expandProgress.value;
        return { height, opacity };
    });

    return (
        <View style={styles.container}>
            <Pressable
                style={styles.header}
                onPress={toggleExpand}
                accessibilityRole="button"
                accessibilityLabel={`${displayPath}, ${sessions.length} sessions, ${machineName}`}
                accessibilityState={{ expanded: isExpanded }}
            >
                <Ionicons
                    name="folder-outline"
                    size={20}
                    color={styles.headerSubtitle.color}
                    style={styles.folderIcon}
                />
                <View style={styles.headerContent}>
                    <View style={styles.headerTitleRow}>
                        <Text style={styles.headerTitle} numberOfLines={1}>
                            {displayPath}
                        </Text>
                        <View style={styles.sessionCount}>
                            <Text style={styles.sessionCountText}>
                                {sessions.length}
                            </Text>
                        </View>
                        <ProjectGitStatus gitStatus={gitStatus} />
                    </View>
                    <Text style={styles.headerSubtitle} numberOfLines={1}>
                        {machineName}
                    </Text>
                </View>
                <Animated.View style={[styles.chevronContainer, chevronAnimatedStyle]}>
                    <Ionicons
                        name="chevron-forward"
                        size={18}
                        color={styles.headerSubtitle.color}
                    />
                </Animated.View>
            </Pressable>

            <Animated.View style={[styles.sessionsContainer, sessionsContainerAnimatedStyle]}>
                {sessions.map((session) => (
                    <ProjectSessionRow
                        key={session.id}
                        session={session}
                        selected={selectedSessionId === session.id}
                        isTablet={isTablet}
                    />
                ))}
            </Animated.View>
        </View>
    );
}

/**
 * Displays aggregated git status for a project in the header.
 * Shows branch name (if available) and line changes.
 */
function ProjectGitStatus({ gitStatus }: { gitStatus: GitStatus | null }) {
    const styles = stylesheet;

    // Don't render if no git status or no meaningful changes
    if (!gitStatus || !hasMeaningfulProjectChanges(gitStatus)) {
        return null;
    }

    const hasLineChanges = gitStatus.unstagedLinesAdded > 0 || gitStatus.unstagedLinesRemoved > 0;

    return (
        <View style={styles.gitStatusContainer}>
            <Ionicons
                name="git-branch-outline"
                size={11}
                color={styles.gitBranchText.color}
            />
            {gitStatus.branch && (
                <Text style={styles.gitBranchText} numberOfLines={1}>
                    {gitStatus.branch}
                </Text>
            )}
            {hasLineChanges && (
                <View style={styles.gitLineChanges}>
                    {gitStatus.unstagedLinesAdded > 0 && (
                        <Text style={styles.gitAddedText}>
                            +{gitStatus.unstagedLinesAdded}
                        </Text>
                    )}
                    {gitStatus.unstagedLinesRemoved > 0 && (
                        <Text style={styles.gitRemovedText}>
                            -{gitStatus.unstagedLinesRemoved}
                        </Text>
                    )}
                </View>
            )}
        </View>
    );
}

function hasMeaningfulProjectChanges(status: GitStatus): boolean {
    // Show when there's a branch name OR actual line changes
    return status.lastUpdatedAt > 0 && (
        status.branch != null ||
        (status.isDirty && (
            status.unstagedLinesAdded > 0 ||
            status.unstagedLinesRemoved > 0
        ))
    );
}

const ProjectSessionRow = React.memo(({ session, selected, isTablet: _isTablet }: {
    session: Session;
    selected?: boolean;
    isTablet: boolean;
}) => {
    const styles = stylesheet;
    const sessionStatus = useSessionStatus(session);
    const sessionName = getSessionName(session);
    const navigateToSession = useNavigateToSession();
    const { showContextMenu } = useSessionContextMenu(session);
    // Note: _isTablet is reserved for future tablet-specific behavior

    const avatarId = React.useMemo(() => {
        return getSessionAvatarId(session);
    }, [session]);

    const projectColor = React.useMemo(() => {
        return entitySessionColor(session);
    }, [session]);

    const activeStateStyle = sessionStatus.state === 'thinking' ? styles.sessionRowThinking
        : sessionStatus.state === 'permission_required' ? styles.sessionRowPermission
        : undefined;

    const handlePress = React.useCallback(() => {
        navigateToSession(session.id);
    }, [navigateToSession, session.id]);

    const handleLongPress = React.useCallback(() => {
        showContextMenu();
    }, [showContextMenu]);

    return (
        <SwipeableSessionRow session={session}>
            <Pressable
                style={[
                    styles.sessionRow,
                    selected && styles.sessionRowSelected,
                    activeStateStyle,
                ]}
                onPress={handlePress}
                onLongPress={handleLongPress}
                delayLongPress={500}
                accessibilityRole="button"
                accessibilityLabel={`${sessionName}, ${sessionStatus.statusText}`}
                accessibilityState={{ selected }}
            >
                <View style={styles.avatarContainer}>
                    <View style={[styles.projectColorIndicator, { backgroundColor: projectColor }]} />
                    <Avatar id={avatarId} size={40} monochrome={!sessionStatus.isConnected} flavor={session.metadata?.flavor} />
                </View>
                <View style={styles.sessionContent}>
                    <View style={styles.sessionTitleRow}>
                        <Text style={[
                            styles.sessionTitle,
                            sessionStatus.isConnected ? styles.sessionTitleConnected : styles.sessionTitleDisconnected
                        ]} numberOfLines={1}>
                            {sessionName}
                        </Text>
                    </View>
                    <View style={styles.statusRow}>
                        <View style={styles.statusRowLeft}>
                            <View style={styles.statusDotContainer}>
                                <StatusDot color={sessionStatus.statusDotColor} isPulsing={sessionStatus.isPulsing} />
                            </View>
                            <Text style={[styles.statusText, { color: sessionStatus.statusColor }]}>
                                {sessionStatus.statusText}
                            </Text>
                        </View>
                        <View style={styles.statusIndicators}>
                            <CompactGitStatus sessionId={session.id} />
                            {session.latestUsage?.contextSize != null && session.latestUsage.contextSize > 0 && (
                                <ContextMeter
                                    contextSize={session.latestUsage.contextSize}
                                    usageHistory={session.usageHistory}
                                    showSparkline={false}
                                />
                            )}
                        </View>
                    </View>
                </View>
            </Pressable>
        </SwipeableSessionRow>
    );
});
