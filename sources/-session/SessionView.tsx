import { AgentContentView } from '@/components/AgentContentView';
import { AgentInput } from '@/components/AgentInput';
import { ModelMode } from '@/components/PermissionModeSelector';
import { getSuggestions } from '@/components/autocomplete/suggestions';
import { ChatHeaderView } from '@/components/ChatHeaderView';
import { ChatList } from '@/components/ChatList';
import { Deferred } from '@/components/Deferred';
import { EmptyMessages } from '@/components/EmptyMessages';
import { VoiceAssistantStatusBar } from '@/components/VoiceAssistantStatusBar';
import { SessionTabs } from '@/components/SessionTabs';
import { useDraft } from '@/hooks/useDraft';
import { Modal } from '@/modal';
import { voiceHooks } from '@/realtime/hooks/voiceHooks';
import { startRealtimeSession, stopRealtimeSession, updateCurrentSessionId } from '@/realtime/RealtimeSession';
import { gitStatusSync } from '@/sync/gitStatusSync';
import { sessionAbort, machineSpawnNewSession } from '@/sync/ops';
import { storage, useIsDataReady, useLocalSetting, useRealtimeStatus, useSessionMessages, useSessionUsage, useSetting, useAllSessions, useMachine } from '@/sync/storage';
import { useSession } from '@/sync/storage';
import { isMachineOnline } from '@/utils/machineUtils';
import { useHappyAction } from '@/hooks/useHappyAction';
import { HappyError } from '@/utils/errors';
import { Toast } from '@/toast';
import { Session } from '@/sync/storageTypes';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { tracking, trackMessageSent } from '@/track';
import { isRunningOnMac } from '@/utils/platform';
import { useTrackMountTime } from '@/hooks/usePerformanceMonitor';
import { useDeviceType, useHeaderHeight, useIsLandscape, useIsTablet } from '@/utils/responsive';
import { formatPathRelativeToHome, getSessionAvatarId, getSessionName, useSessionStatus } from '@/utils/sessionUtils';
import { isVersionSupported, MINIMUM_CLI_VERSION } from '@/utils/versionUtils';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { useMemo } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { layout } from '@/components/layout';
import { Typography } from '@/constants/Typography';

// Constants for expandable header animation
const EXPANDED_HEIGHT = 72;
const COLLAPSED_HEIGHT = 0;
const ANIMATION_DURATION = 250;

// Height of the session tabs bar (HAP-327)
const SESSION_TABS_HEIGHT = 44;

/**
 * ExpandableHeaderMetadata - A collapsible section showing session metadata
 * Displays model mode, permission mode, and context usage with smooth Reanimated animations.
 * HAP-326: Added expandable header section for quick access to session metadata.
 */
// Maximum context size in tokens (190K tokens for Claude's context window)
const MAX_CONTEXT_SIZE = 190000;

interface ExpandableHeaderMetadataProps {
    modelMode: string;
    permissionMode: string;
    /** Context size in tokens (0-190000), will be converted to percentage for display */
    contextSize: number | null;
    isConnected: boolean;
    flavor?: string | null;
}

const ExpandableHeaderMetadata = React.memo(({
    modelMode,
    permissionMode,
    contextSize,
    isConnected,
    flavor
}: ExpandableHeaderMetadataProps) => {
    // Calculate remaining context percentage (inverted - shows how much is LEFT)
    const contextPercent = useMemo(() => {
        if (contextSize === null || contextSize === 0) return null;
        const usedPercent = Math.min(contextSize / MAX_CONTEXT_SIZE, 1);
        // Show remaining percentage (100% - used%)
        return Math.round((1 - usedPercent) * 100);
    }, [contextSize]);
    const { theme } = useUnistyles();
    const [isExpanded, setIsExpanded] = React.useState(false);
    const expandedHeight = useSharedValue(COLLAPSED_HEIGHT);

    // Handle toggle
    const handleToggle = React.useCallback(() => {
        setIsExpanded(prev => {
            const newState = !prev;
            expandedHeight.value = withTiming(newState ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT, {
                duration: ANIMATION_DURATION
            });
            return newState;
        });
    }, [expandedHeight]);

    // Animated style for the content container height
    const animatedContainerStyle = useAnimatedStyle(() => ({
        height: expandedHeight.value,
        overflow: 'hidden' as const,
    }));

    // Animated style for chevron rotation
    const animatedChevronStyle = useAnimatedStyle(() => ({
        transform: [{
            rotate: expandedHeight.value === COLLAPSED_HEIGHT ? '0deg' : '180deg'
        }],
    }));

    // Format model mode for display
    const modelDisplay = useMemo(() => {
        // Claude models
        if (modelMode === 'opus') return 'Opus 4.5';
        if (modelMode === 'sonnet') return 'Sonnet 4.5';
        if (modelMode === 'haiku') return 'Haiku 4.5';
        // Codex models
        if (modelMode === 'gpt-5-minimal') return 'GPT-5 Minimal';
        if (modelMode === 'gpt-5-low') return 'GPT-5 Low';
        if (modelMode === 'gpt-5-medium') return 'GPT-5 Medium';
        if (modelMode === 'gpt-5-high') return 'GPT-5 High';
        if (modelMode === 'gpt-5-codex-low') return 'Codex Low';
        if (modelMode === 'gpt-5-codex-medium') return 'Codex Medium';
        if (modelMode === 'gpt-5-codex-high') return 'Codex High';
        return modelMode;
    }, [modelMode]);

    // Format permission mode for display
    const modeDisplay = useMemo(() => {
        const isCodex = flavor === 'codex' || flavor === 'openai' || flavor === 'gpt';
        if (isCodex) {
            // Codex permission modes
            if (permissionMode === 'default') return t('agentInput.codexPermissionMode.default');
            if (permissionMode === 'read-only') return t('agentInput.codexPermissionMode.readOnly');
            if (permissionMode === 'safe-yolo') return t('agentInput.codexPermissionMode.safeYolo');
            if (permissionMode === 'yolo') return t('agentInput.codexPermissionMode.yolo');
        } else {
            // Claude permission modes
            if (permissionMode === 'default') return t('agentInput.permissionMode.default');
            if (permissionMode === 'acceptEdits') return t('agentInput.permissionMode.acceptEdits');
            if (permissionMode === 'plan') return t('agentInput.permissionMode.plan');
            if (permissionMode === 'bypassPermissions') return t('agentInput.permissionMode.bypassPermissions');
        }
        return permissionMode;
    }, [permissionMode, flavor]);

    // Dynamic styles
    const headerTapStyle = useMemo(() => ({
        backgroundColor: theme.colors.header.background,
        paddingHorizontal: 16,
        paddingVertical: 8,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        borderBottomWidth: isExpanded ? 0 : 1,
        borderBottomColor: theme.colors.divider,
    }), [theme.colors.header.background, theme.colors.divider, isExpanded]);

    const expandedContentStyle = useMemo(() => ({
        backgroundColor: theme.colors.header.background,
        paddingHorizontal: 16,
        paddingTop: 4,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    }), [theme.colors.header.background, theme.colors.divider]);

    return (
        <View style={expandableStyles.container}>
            {/* Tap area to toggle */}
            <Pressable onPress={handleToggle} style={headerTapStyle}>
                <Text style={[expandableStyles.tapHint, { color: theme.colors.textSecondary }]}>
                    {isExpanded
                        ? (isConnected ? t('session.expandableHeader.connected') : t('session.expandableHeader.disconnected'))
                        : t('session.expandableHeader.tapToExpand')
                    }
                </Text>
                <Animated.View style={animatedChevronStyle}>
                    <Ionicons
                        name="chevron-down"
                        size={16}
                        color={theme.colors.textSecondary}
                    />
                </Animated.View>
            </Pressable>

            {/* Expandable content */}
            <Animated.View style={animatedContainerStyle}>
                <View style={expandedContentStyle}>
                    <View style={expandableStyles.contentRow}>
                        {/* Model */}
                        <View style={expandableStyles.metadataItem}>
                            <Text style={[expandableStyles.metadataLabel, { color: theme.colors.textSecondary }]}>
                                {t('session.expandableHeader.model')}
                            </Text>
                            <Text style={[expandableStyles.metadataValue, { color: theme.colors.text }]}>
                                {modelDisplay}
                            </Text>
                        </View>

                        {/* Permission Mode */}
                        <View style={expandableStyles.metadataItem}>
                            <Text style={[expandableStyles.metadataLabel, { color: theme.colors.textSecondary }]}>
                                {t('session.expandableHeader.mode')}
                            </Text>
                            <Text style={[expandableStyles.metadataValue, { color: theme.colors.text }]}>
                                {modeDisplay}
                            </Text>
                        </View>

                        {/* Context */}
                        <View style={expandableStyles.metadataItem}>
                            <Text style={[expandableStyles.metadataLabel, { color: theme.colors.textSecondary }]}>
                                {t('session.expandableHeader.context')}
                            </Text>
                            <Text style={[
                                expandableStyles.metadataValue,
                                { color: contextPercent !== null && contextPercent < 20 ? '#FF9500' : theme.colors.text }
                            ]}>
                                {contextPercent !== null ? `${contextPercent}%` : '—'}
                            </Text>
                        </View>
                    </View>
                </View>
            </Animated.View>
        </View>
    );
});

// Static styles for expandable header
const expandableStyles = {
    container: {
        width: '100%' as const,
        maxWidth: layout.maxWidth,
        alignSelf: 'center' as const,
    },
    tapHint: {
        fontSize: 12,
        marginRight: 4,
        ...Typography.default(),
    },
    contentRow: {
        flexDirection: 'row' as const,
        justifyContent: 'space-around' as const,
        alignItems: 'flex-start' as const,
        paddingTop: 8,
    },
    metadataItem: {
        alignItems: 'center' as const,
        flex: 1,
    },
    metadataLabel: {
        fontSize: 10,
        fontWeight: '600' as const,
        textTransform: 'uppercase' as const,
        letterSpacing: 0.5,
        marginBottom: 4,
        ...Typography.default('semiBold'),
    },
    metadataValue: {
        fontSize: 14,
        fontWeight: '500' as const,
        ...Typography.default(),
    },
} as const;

export const SessionView = React.memo((props: { id: string }) => {
    // Track render performance (HAP-336)
    useTrackMountTime('SessionView');

    const sessionId = props.id;
    const router = useRouter();
    const session = useSession(sessionId);
    const isDataReady = useIsDataReady();
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const isLandscape = useIsLandscape();
    const deviceType = useDeviceType();
    const headerHeight = useHeaderHeight();
    const styles = stylesheet;

    // Memoize dynamic styles that depend on runtime values
    const statusBarShadowStyle = useMemo(() => ({
        position: 'absolute' as const,
        top: 0,
        left: 0,
        right: 0,
        height: safeArea.top,
        backgroundColor: theme.colors.surface,
        zIndex: 1000,
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: theme.colors.shadow.opacity,
        shadowRadius: 3,
        elevation: 5,
    }), [safeArea.top, theme.colors.surface, theme.colors.shadow]);

    const contentPaddingStyle = useMemo(() => ({
        flex: 1,
        paddingTop: !(isLandscape && deviceType === 'phone') ? safeArea.top + headerHeight : 0,
    }), [isLandscape, deviceType, safeArea.top, headerHeight]);

    // Compute header props based on session state
    const headerProps = useMemo(() => {
        if (!isDataReady) {
            // Loading state - show empty header
            return {
                title: '',
                subtitle: undefined,
                avatarId: undefined,
                onAvatarPress: undefined,
                isConnected: false,
                flavor: null
            };
        }

        if (!session) {
            // Deleted state - show deleted message in header
            return {
                title: t('errors.sessionDeleted'),
                subtitle: undefined,
                avatarId: undefined,
                onAvatarPress: undefined,
                isConnected: false,
                flavor: null
            };
        }

        // Normal state - show session info
        const isConnected = session.presence === 'online';
        return {
            title: getSessionName(session),
            subtitle: session.metadata?.path ? formatPathRelativeToHome(session.metadata.path, session.metadata?.homeDir) : undefined,
            avatarId: getSessionAvatarId(session),
            onAvatarPress: () => router.push(`/session/${sessionId}/info`),
            isConnected: isConnected,
            flavor: session.metadata?.flavor || null,
            tintColor: isConnected ? '#000' : '#8E8E93'
        };
    }, [session, isDataReady, sessionId, router]);

    return (
        <>
            {/* Status bar shadow for landscape mode */}
            {isLandscape && deviceType === 'phone' && (
                <View style={statusBarShadowStyle} />
            )}

            {/* Header - always shown, hidden in landscape mode on phone */}
            {!(isLandscape && deviceType === 'phone') && (
                <View style={styles.headerPosition}>
                    <ChatHeaderView
                        {...headerProps}
                        onBackPress={() => router.back()}
                    />
                </View>
            )}

            {/* Content based on state */}
            <View style={contentPaddingStyle}>
                {!isDataReady ? (
                    // Loading state
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    </View>
                ) : !session ? (
                    // Deleted state
                    <View style={styles.deletedContainer}>
                        <Ionicons name="trash-outline" size={48} color={theme.colors.textSecondary} />
                        <Text style={styles.deletedTitle}>{t('errors.sessionDeleted')}</Text>
                        <Text style={styles.deletedDescription}>{t('errors.sessionDeletedDescription')}</Text>
                    </View>
                ) : (
                    // Normal session view
                    <SessionViewLoaded key={sessionId} sessionId={sessionId} session={session} />
                )}
            </View>
        </>
    );
});


function SessionViewLoaded({ sessionId, session }: { sessionId: string, session: Session }) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const safeArea = useSafeAreaInsets();
    const isLandscape = useIsLandscape();
    const deviceType = useDeviceType();
    const isTablet = useIsTablet();
    const headerHeight = useHeaderHeight();
    const [message, setMessage] = React.useState('');
    const realtimeStatus = useRealtimeStatus();
    const styles = stylesheet;
    const { messages, isLoaded } = useSessionMessages(sessionId);
    const acknowledgedCliVersions = useLocalSetting('acknowledgedCliVersions');

    // HAP-327: Get active sessions count for session tabs visibility
    const allSessions = useAllSessions();
    const activeSessionsCount = React.useMemo(() => {
        return allSessions.filter(s => s.active).length;
    }, [allSessions]);
    const showSessionTabs = activeSessionsCount >= 2;

    // HAP-327: Calculate tabs offset for positioning elements below header
    const sessionTabsOffset = showSessionTabs ? SESSION_TABS_HEIGHT : 0;

    // Memoize dynamic styles that depend on runtime values
    const cliWarningStyle = useMemo(() => ({
        ...styles.cliWarningBase,
        position: 'absolute' as const,
        top: safeArea.top + headerHeight + ((!isTablet && realtimeStatus !== 'disconnected') ? 48 : 0) + sessionTabsOffset + 8,
    }), [safeArea.top, headerHeight, isTablet, realtimeStatus, sessionTabsOffset, styles.cliWarningBase]);

    const mainContentStyle = useMemo(() => ({
        flexBasis: 0,
        flexGrow: 1,
        paddingBottom: safeArea.bottom + ((isRunningOnMac() || Platform.OS === 'web') ? 32 : 0),
    }), [safeArea.bottom]);

    const backButtonStyle = useMemo(() => ({
        ...styles.backButtonBase,
        top: safeArea.top + 8,
        backgroundColor: `rgba(${theme.dark ? '28, 23, 28' : '255, 255, 255'}, 0.9)`,
    }), [safeArea.top, theme.dark, styles.backButtonBase]);

    // HAP-327: Position for session tabs - below the main header and voice status bar
    const sessionTabsPositionStyle = useMemo(() => ({
        ...styles.sessionTabsPosition,
        top: safeArea.top + headerHeight + ((!isTablet && realtimeStatus !== 'disconnected') ? 48 : 0),
    }), [safeArea.top, headerHeight, isTablet, realtimeStatus, styles.sessionTabsPosition]);

    // Position for expandable header (HAP-326) - below the main header and session tabs
    const expandableHeaderPositionStyle = useMemo(() => ({
        ...styles.expandableHeaderPosition,
        top: safeArea.top + headerHeight + ((!isTablet && realtimeStatus !== 'disconnected') ? 48 : 0) + sessionTabsOffset,
    }), [safeArea.top, headerHeight, isTablet, realtimeStatus, sessionTabsOffset, styles.expandableHeaderPosition]);

    // Check if CLI version is outdated and not already acknowledged
    const cliVersion = session.metadata?.version;
    const machineId = session.metadata?.machineId;
    const isCliOutdated = cliVersion && !isVersionSupported(cliVersion, MINIMUM_CLI_VERSION);
    const isAcknowledged = machineId && acknowledgedCliVersions[machineId] === cliVersion;
    const shouldShowCliWarning = isCliOutdated && !isAcknowledged;
    // Get permission mode from session object, default to 'default'
    const permissionMode = session.permissionMode || 'default';
    // Get model mode from session object, default to 'opus'
    const modelMode = session.modelMode || 'opus';
    const sessionStatus = useSessionStatus(session);
    const sessionUsage = useSessionUsage(sessionId);
    const alwaysShowContextSize = useSetting('alwaysShowContextSize');
    const experiments = useSetting('experiments');

    // Use draft hook for auto-saving message drafts
    const { clearDraft } = useDraft(sessionId, message, setMessage);

    // Handle dismissing CLI version warning
    const handleDismissCliWarning = React.useCallback(() => {
        if (machineId && cliVersion) {
            storage.getState().applyLocalSettings({
                acknowledgedCliVersions: {
                    ...acknowledgedCliVersions,
                    [machineId]: cliVersion
                }
            });
        }
    }, [machineId, cliVersion, acknowledgedCliVersions]);

    // Function to update permission mode
    const updatePermissionMode = React.useCallback((mode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'read-only' | 'safe-yolo' | 'yolo') => {
        storage.getState().updateSessionPermissionMode(sessionId, mode);
    }, [sessionId]);

    // Function to update model mode
    const updateModelMode = React.useCallback((mode: ModelMode) => {
        storage.getState().updateSessionModelMode(sessionId, mode);
    }, [sessionId]);

    // Handle microphone button press - memoized to prevent button flashing
    const handleMicrophonePress = React.useCallback(async () => {
        if (realtimeStatus === 'connecting') {
            return; // Prevent actions during transitions
        }
        if (realtimeStatus === 'disconnected' || realtimeStatus === 'error') {
            try {
                const initialPrompt = voiceHooks.onVoiceStarted(sessionId);
                await startRealtimeSession(sessionId, initialPrompt);
                tracking?.capture('voice_session_started', { sessionId });
            } catch (error) {
                console.error('Failed to start realtime session:', error);
                Modal.alert(t('common.error'), t('errors.voiceSessionFailed'));
                tracking?.capture('voice_session_error', { error: error instanceof Error ? error.message : 'Unknown error' });
            }
        } else if (realtimeStatus === 'connected') {
            await stopRealtimeSession();
            tracking?.capture('voice_session_stopped');

            // Notify voice assistant about voice session stop
            voiceHooks.onVoiceStopped();
        }
    }, [realtimeStatus, sessionId]);

    // Memoize mic button state to prevent flashing during chat transitions
    const micButtonState = useMemo(() => ({
        onMicPress: handleMicrophonePress,
        isMicActive: realtimeStatus === 'connected' || realtimeStatus === 'connecting'
    }), [handleMicrophonePress, realtimeStatus]);

    // Trigger session visibility and initialize git status sync
    React.useLayoutEffect(() => {

        // Trigger session sync
        sync.onSessionVisible(sessionId);

        // Update realtime session ID if voice is active to ensure messages go to current session
        if (realtimeStatus === 'connected') {
            updateCurrentSessionId(sessionId);
        }

        // Initialize git status sync for this session
        gitStatusSync.getSync(sessionId);
    }, [sessionId, realtimeStatus]);

    let content = (
        <>
            <Deferred>
                {messages.length > 0 && (
                    <ChatList session={session} />
                )}
            </Deferred>
        </>
    );
    const placeholder = messages.length === 0 ? (
        <>
            {isLoaded ? (
                <EmptyMessages session={session} />
            ) : (
                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
            )}
        </>
    ) : null;

    // HAP-391: Determine if input should be disabled (archived/inactive sessions)
    const isInputDisabled = !sessionStatus.isConnected || !session.active;

    // HAP-392: Restore session functionality for archived sessions
    const machine = useMachine(session.metadata?.machineId ?? '');
    const isClaudeSession = !session.metadata?.flavor || session.metadata.flavor === 'claude';
    const machineOnline = machine ? isMachineOnline(machine) : false;
    const canRestore = isInputDisabled && isClaudeSession && session.metadata?.machineId && session.metadata?.path;

    const [isRestoring, performRestore] = useHappyAction(async () => {
        if (!session.metadata?.machineId || !session.metadata?.path) {
            throw new HappyError(t('sessionInfo.failedToRestoreSession'), false);
        }
        if (!machineOnline) {
            throw new HappyError(t('sessionInfo.restoreRequiresMachine'), false);
        }

        const result = await machineSpawnNewSession({
            machineId: session.metadata.machineId,
            directory: session.metadata.path,
            agent: 'claude',
            sessionId: session.id,
        });

        if (result.type === 'error') {
            throw new HappyError(result.errorMessage || t('sessionInfo.failedToRestoreSession'), true);
        }
        if (result.type === 'requestToApproveDirectoryCreation') {
            throw new HappyError(t('sessionInfo.failedToRestoreSession'), false);
        }

        Toast.show({ message: t('sessionInfo.restoreSessionSuccess') });
        router.replace(`/session/${result.sessionId}`);
    });

    const input = (
        <AgentInput
            placeholder={t('session.inputPlaceholder')}
            value={message}
            onChangeText={setMessage}
            sessionId={sessionId}
            permissionMode={permissionMode}
            onPermissionModeChange={updatePermissionMode}
            modelMode={modelMode}
            onModelModeChange={updateModelMode}
            metadata={session.metadata}
            connectionStatus={{
                text: sessionStatus.statusText,
                color: sessionStatus.statusColor,
                dotColor: sessionStatus.statusDotColor,
                isPulsing: sessionStatus.isPulsing
            }}
            onSend={() => {
                if (message.trim()) {
                    setMessage('');
                    clearDraft();
                    sync.sendMessage(sessionId, message);
                    trackMessageSent();
                }
            }}
            onMicPress={micButtonState.onMicPress}
            isMicActive={micButtonState.isMicActive}
            onAbort={() => sessionAbort(sessionId)}
            showAbortButton={sessionStatus.state === 'thinking' || sessionStatus.state === 'waiting'}
            onFileViewerPress={experiments ? () => router.push(`/session/${sessionId}/files`) : undefined}
            // Autocomplete configuration
            autocompletePrefixes={['@', '/']}
            autocompleteSuggestions={(query) => getSuggestions(sessionId, query)}
            usageData={sessionUsage ? {
                inputTokens: sessionUsage.inputTokens,
                outputTokens: sessionUsage.outputTokens,
                cacheCreation: sessionUsage.cacheCreation,
                cacheRead: sessionUsage.cacheRead,
                contextSize: sessionUsage.contextSize
            } : session.latestUsage ? {
                inputTokens: session.latestUsage.inputTokens,
                outputTokens: session.latestUsage.outputTokens,
                cacheCreation: session.latestUsage.cacheCreation,
                cacheRead: session.latestUsage.cacheRead,
                contextSize: session.latestUsage.contextSize
            } : undefined}
            alwaysShowContextSize={alwaysShowContextSize}
            // HAP-391: Disable input for archived/inactive sessions
            disabled={isInputDisabled}
            disabledPlaceholder={t('session.inputPlaceholderArchived')}
        />
    );


    return (
        <>
            {/* Voice Assistant Status Bar - positioned as overlay at top */}
            {!isTablet && !(isLandscape && deviceType === 'phone') && realtimeStatus !== 'disconnected' && (
                <View style={styles.voiceStatusBarPosition}>
                    <VoiceAssistantStatusBar variant="full" />
                </View>
            )}

            {/* HAP-327: Session Tabs - horizontal scrollable tab bar for quick session switching */}
            {showSessionTabs && !(isLandscape && deviceType === 'phone') && (
                <View style={sessionTabsPositionStyle}>
                    <SessionTabs currentSessionId={sessionId} />
                </View>
            )}

            {/* CLI Version Warning Overlay - Subtle centered pill */}
            {shouldShowCliWarning && !(isLandscape && deviceType === 'phone') && (
                <Pressable
                    onPress={handleDismissCliWarning}
                    style={cliWarningStyle}
                >
                    <Ionicons name="warning-outline" size={14} color="#FF9500" style={staticStyles.warningIconMargin} />
                    <Text style={styles.cliWarningText}>
                        {t('sessionInfo.cliVersionOutdated')}
                    </Text>
                    <Ionicons name="close" size={14} color="#856404" style={staticStyles.closeIconMargin} />
                </Pressable>
            )}

            {/* Expandable Header Metadata - HAP-326 */}
            {!(isLandscape && deviceType === 'phone') && (
                <View style={expandableHeaderPositionStyle}>
                    <ExpandableHeaderMetadata
                        modelMode={modelMode}
                        permissionMode={permissionMode}
                        contextSize={sessionUsage?.contextSize ?? session.latestUsage?.contextSize ?? null}
                        isConnected={sessionStatus.isConnected}
                        flavor={session.metadata?.flavor}
                    />
                </View>
            )}

            {/* HAP-392: Archived Session Banner with Restore Button */}
            {isInputDisabled && !(isLandscape && deviceType === 'phone') && (
                <View style={styles.archivedBannerContainer}>
                    <View style={styles.archivedBanner}>
                        <Ionicons name="archive-outline" size={16} color="#856404" />
                        <Text style={styles.archivedBannerText}>
                            {t('session.archivedBannerText')}
                        </Text>
                        {canRestore && (
                            <Pressable
                                onPress={machineOnline ? performRestore : undefined}
                                disabled={!machineOnline || isRestoring}
                                style={[
                                    styles.restoreButton,
                                    (!machineOnline || isRestoring) && styles.restoreButtonDisabled
                                ]}
                            >
                                {isRestoring ? (
                                    <ActivityIndicator size="small" color="#fff" />
                                ) : (
                                    <Text style={[
                                        styles.restoreButtonText,
                                        !machineOnline && styles.restoreButtonTextDisabled
                                    ]}>
                                        {machineOnline ? t('sessionInfo.restoreSession') : t('session.machineOffline')}
                                    </Text>
                                )}
                            </Pressable>
                        )}
                    </View>
                </View>
            )}

            {/* Main content area - no padding since header is overlay */}
            <View style={mainContentStyle}>
                <AgentContentView
                    content={content}
                    input={input}
                    placeholder={placeholder}
                />
            </View>

            {/* Back button for landscape phone mode when header is hidden */}
            {isLandscape && deviceType === 'phone' && (
                <Pressable
                    onPress={() => router.back()}
                    style={backButtonStyle}
                    hitSlop={15}
                >
                    <Ionicons
                        name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'}
                        size={Platform.select({ ios: 28, default: 24 })}
                        color="#000"
                    />
                </Pressable>
            )}
        </>
    )
}

// Static styles for SessionView components
const stylesheet = StyleSheet.create((theme) => ({
    // Header position overlay
    headerPosition: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
    },
    // Loading state container
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    // Deleted state container
    deletedContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    deletedTitle: {
        color: theme.colors.text,
        fontSize: 20,
        marginTop: 16,
        fontWeight: '600',
    },
    deletedDescription: {
        color: theme.colors.textSecondary,
        fontSize: 15,
        marginTop: 8,
        textAlign: 'center',
        paddingHorizontal: 32,
    },
    // Voice status bar position
    voiceStatusBarPosition: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 999,
    },
    // HAP-327: Session tabs position - below header, above expandable metadata
    sessionTabsPosition: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 997,
    },
    // Expandable header position (HAP-326)
    expandableHeaderPosition: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 996,
    },
    // CLI warning base styles
    cliWarningBase: {
        alignSelf: 'center',
        backgroundColor: '#FFF3CD',
        borderRadius: 100,
        paddingHorizontal: 14,
        paddingVertical: 7,
        flexDirection: 'row',
        alignItems: 'center',
        zIndex: 998,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 4,
    },
    cliWarningText: {
        fontSize: 12,
        color: '#856404',
        fontWeight: '600',
    },
    // HAP-392: Archived session banner styles
    archivedBannerContainer: {
        position: 'absolute',
        top: 8,
        left: 0,
        right: 0,
        zIndex: 995,
        alignItems: 'center',
    },
    archivedBanner: {
        backgroundColor: '#FFF3CD',
        borderRadius: 100,
        paddingHorizontal: 16,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 4,
    },
    archivedBannerText: {
        fontSize: 13,
        color: '#856404',
        fontWeight: '500',
    },
    restoreButton: {
        backgroundColor: '#34C759',
        borderRadius: 100,
        paddingHorizontal: 12,
        paddingVertical: 5,
        marginLeft: 4,
    },
    restoreButtonDisabled: {
        backgroundColor: '#8E8E93',
    },
    restoreButtonText: {
        fontSize: 12,
        color: '#fff',
        fontWeight: '600',
    },
    restoreButtonTextDisabled: {
        color: '#fff',
    },
    // Back button for landscape mode
    backButtonBase: {
        position: 'absolute',
        left: 16,
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        ...Platform.select({
            ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.1,
                shadowRadius: 4,
            },
            android: {
                elevation: 2,
            },
        }),
    },
}));

// Static styles that don't need theme access - defined once, never recreated
const staticStyles = {
    warningIconMargin: { marginRight: 6 },
    closeIconMargin: { marginLeft: 8 },
} as const;
