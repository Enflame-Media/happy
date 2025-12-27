import React, { useCallback, useRef, useEffect } from 'react';
import { View, Text, Animated, AccessibilityInfo, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Typography } from '@/constants/Typography';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Avatar } from '@/components/Avatar';
import { useSession, useIsDataReady } from '@/sync/storage';
import { getSessionName, useSessionStatus, formatOSPlatform, formatPathRelativeToHome, getSessionAvatarId } from '@/utils/sessionUtils';
import * as Clipboard from 'expo-clipboard';
import { Modal } from '@/modal';
import { Toast } from '@/toast';
import { sessionKill, sessionDelete, sessionClearContext, sessionCompactContext, machineSpawnNewSession, isTemporaryPidSessionId, pollForRealSession } from '@/sync/ops';
import { useMachine } from '@/sync/storage';
import { isMachineOnline } from '@/utils/machineUtils';
import { useUnistyles } from 'react-native-unistyles';
import { layout } from '@/components/layout';
import { t } from '@/text';
import { isVersionSupported, MINIMUM_CLI_VERSION } from '@/utils/versionUtils';
import { CodeView } from '@/components/CodeView';
import { Session } from '@/sync/storageTypes';
import { useHappyAction } from '@/hooks/useHappyAction';
import { AppError, ErrorCodes } from '@/utils/errors';
import { SessionCostDisplay } from '@/components/usage/SessionCostDisplay';
import { ContextBreakdown } from '@/components/usage/ContextBreakdown';
import { ContextHistoryChart } from '@/components/usage/ContextHistoryChart';
import { hapticsLight } from '@/components/haptics';

const ARCHIVE_UNDO_DURATION = 5000; // 5 seconds to undo

// Animated status dot component
function StatusDot({ color, isPulsing, size = 8 }: { color: string; isPulsing?: boolean; size?: number }) {
    const pulseAnim = React.useRef(new Animated.Value(1)).current;

    React.useEffect(() => {
        if (isPulsing) {
            Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, {
                        toValue: 0.3,
                        duration: 1000,
                        useNativeDriver: Platform.OS !== 'web',
                    }),
                    Animated.timing(pulseAnim, {
                        toValue: 1,
                        duration: 1000,
                        useNativeDriver: Platform.OS !== 'web',
                    }),
                ])
            ).start();
        } else {
            pulseAnim.setValue(1);
        }
    }, [isPulsing, pulseAnim]);

    return (
        <Animated.View
            style={{
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: color,
                opacity: pulseAnim,
                marginRight: 4,
            }}
        />
    );
}

function SessionInfoContent({ session }: { session: Session }) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const devModeEnabled = __DEV__;
    const sessionName = getSessionName(session);
    const sessionStatus = useSessionStatus(session);
    const machine = useMachine(session.metadata?.machineId ?? '');

    // Check if CLI version is outdated
    const isCliOutdated = session.metadata?.version && !isVersionSupported(session.metadata.version, MINIMUM_CLI_VERSION);

    // Ref to track pending archive timeout for undo functionality
    const pendingArchiveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Cleanup pending archive on unmount
    useEffect(() => {
        return () => {
            if (pendingArchiveRef.current) {
                clearTimeout(pendingArchiveRef.current);
            }
        };
    }, []);

    const handleCopySessionId = useCallback(async () => {
        if (!session) return;
        try {
            await Clipboard.setStringAsync(session.id);
            Modal.alert(t('common.success'), t('sessionInfo.happySessionIdCopied'));
        } catch {
            Modal.alert(t('common.error'), t('sessionInfo.failedToCopySessionId'));
        }
    }, [session]);

    const handleCopyMetadata = useCallback(async () => {
        if (!session?.metadata) return;
        try {
            await Clipboard.setStringAsync(JSON.stringify(session.metadata, null, 2));
            Modal.alert(t('common.success'), t('sessionInfo.metadataCopied'));
        } catch {
            Modal.alert(t('common.error'), t('sessionInfo.failedToCopyMetadata'));
        }
    }, [session]);

    // Use HappyAction for archiving - it handles errors automatically
    // Note: Navigation happens after timeout, not inside performArchive
    const [_archivingSession, performArchive] = useHappyAction(async () => {
        const result = await sessionKill(session.id);
        if (!result.success) {
            throw new AppError(ErrorCodes.INTERNAL_ERROR, result.message || t('sessionInfo.failedToArchiveSession'), { canTryAgain: false });
        }
    });

    // Handle undo action - cancels the pending archive
    const handleUndoArchive = useCallback(() => {
        if (pendingArchiveRef.current) {
            clearTimeout(pendingArchiveRef.current);
            pendingArchiveRef.current = null;
        }
        hapticsLight();
        AccessibilityInfo.announceForAccessibility(t('swipeActions.archiveUndone'));
    }, []);

    // Archive with undo toast pattern - navigation happens after archive executes
    const handleArchiveSession = useCallback(() => {
        hapticsLight();

        // Clear any existing pending archive
        if (pendingArchiveRef.current) {
            clearTimeout(pendingArchiveRef.current);
        }

        // Show undo toast
        Toast.show({
            message: t('swipeActions.sessionArchived'),
            duration: ARCHIVE_UNDO_DURATION,
            action: {
                label: t('common.undo'),
                onPress: handleUndoArchive,
            },
        });

        // Set pending archive - will execute after toast duration if not cancelled
        pendingArchiveRef.current = setTimeout(() => {
            pendingArchiveRef.current = null;
            performArchive();
            // Navigate back after archive executes
            router.back();
            router.back();
        }, ARCHIVE_UNDO_DURATION);
    }, [handleUndoArchive, performArchive, router]);

    // Use HappyAction for deletion - it handles errors automatically
    const [_deletingSession, performDelete] = useHappyAction(async () => {
        const result = await sessionDelete(session.id);
        if (!result.success) {
            throw new AppError(ErrorCodes.INTERNAL_ERROR, result.message || t('sessionInfo.failedToDeleteSession'), { canTryAgain: false });
        }
        // Success - no alert needed, UI will update to show deleted state
    });

    const handleDeleteSession = useCallback(() => {
        Modal.alert(
            t('sessionInfo.deleteSession'),
            t('sessionInfo.deleteSessionWarning'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('sessionInfo.deleteSession'),
                    style: 'destructive',
                    onPress: performDelete
                }
            ]
        );
    }, [performDelete]);

    // Context management actions
    const [_clearingContext, performClearContext] = useHappyAction(async () => {
        await sessionClearContext(session.id);
    });

    const handleClearContext = useCallback(() => {
        Modal.alert(
            t('sessionInfo.clearContext'),
            t('sessionInfo.clearContextConfirm'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('sessionInfo.clearContext'),
                    style: 'destructive',
                    onPress: performClearContext
                }
            ]
        );
    }, [performClearContext]);

    const [_compactingContext, performCompactContext] = useHappyAction(async () => {
        await sessionCompactContext(session.id);
    });

    const handleCompactContext = useCallback(() => {
        Modal.alert(
            t('sessionInfo.compactContext'),
            t('sessionInfo.compactContextConfirm'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('sessionInfo.compactContext'),
                    onPress: performCompactContext
                }
            ]
        );
    }, [performCompactContext]);

    // HAP-392: Restore session action - resumes an archived session with conversation history
    // Only available for Claude sessions (Codex doesn't support --resume)
    const isClaudeSession = !session.metadata?.flavor || session.metadata.flavor === 'claude';
    const machineOnline = machine ? isMachineOnline(machine) : false;
    const canRestore = !sessionStatus.isConnected && !session.active && isClaudeSession && session.metadata?.machineId && session.metadata?.path;

    const [_restoringSession, performRestore] = useHappyAction(async () => {
        if (!session.metadata?.machineId || !session.metadata?.path) {
            throw new AppError(ErrorCodes.INTERNAL_ERROR, t('sessionInfo.failedToRestoreSession'), { canTryAgain: false });
        }
        if (!machineOnline) {
            throw new AppError(ErrorCodes.INTERNAL_ERROR, t('sessionInfo.restoreRequiresMachine'), { canTryAgain: false });
        }

        // HAP-584: Capture spawn time BEFORE RPC call for optimistic polling fallback
        const spawnStartTime = Date.now();

        const result = await machineSpawnNewSession({
            machineId: session.metadata.machineId,
            directory: session.metadata.path,
            agent: 'claude',
            sessionId: session.id, // This triggers the --resume flag
        });

        if (result.type === 'error') {
            throw new AppError(ErrorCodes.INTERNAL_ERROR, result.errorMessage || t('sessionInfo.failedToRestoreSession'), { canTryAgain: true });
        }
        if (result.type === 'requestToApproveDirectoryCreation') {
            throw new AppError(ErrorCodes.INTERNAL_ERROR, t('sessionInfo.failedToRestoreSession'), { canTryAgain: false });
        }

        let sessionId: string | null = result.sessionId;

        // HAP-488: Check for temporary PID-based session ID
        if (isTemporaryPidSessionId(result.sessionId)) {
            // HAP-584: Use pre-captured spawnStartTime for polling
            const realSessionId = await pollForRealSession(
                session.metadata.machineId,
                spawnStartTime,
                { interval: 5000, maxAttempts: 24 }
            );

            if (!realSessionId) {
                throw new AppError(ErrorCodes.INTERNAL_ERROR, t('newSession.sessionStartFailed'), { canTryAgain: false });
            }

            sessionId = realSessionId;
        } else if (!sessionId) {
            // HAP-584: Optimistic polling fallback
            // The RPC may have timed out even though the session was created successfully.
            const polledSessionId = await pollForRealSession(
                session.metadata.machineId,
                spawnStartTime,
                { interval: 3000, maxAttempts: 10 }
            );

            if (!polledSessionId) {
                throw new AppError(ErrorCodes.INTERNAL_ERROR, t('sessionInfo.failedToRestoreSession'), { canTryAgain: true });
            }

            sessionId = polledSessionId;
        }

        // Success - navigate to the new session
        Toast.show({ message: t('sessionInfo.restoreSessionSuccess') });
        router.replace(`/session/${sessionId}`);
    });

    const handleRestoreSession = useCallback(() => {
        hapticsLight();
        if (!machineOnline) {
            Toast.show({ message: t('sessionInfo.restoreRequiresMachine') });
            return;
        }
        performRestore();
    }, [performRestore, machineOnline]);

    const formatDate = useCallback((timestamp: number) => {
        return new Date(timestamp).toLocaleString();
    }, []);

    const handleCopyUpdateCommand = useCallback(async () => {
        const updateCommand = 'npm install -g happy-coder@latest';
        try {
            await Clipboard.setStringAsync(updateCommand);
            Modal.alert(t('common.success'), updateCommand);
        } catch {
            Modal.alert(t('common.error'), t('sessionInfo.failedToCopyUpdateCommand'));
        }
    }, []);

    return (
        <>
            <ItemList>
                {/* Session Header */}
                <View style={{ maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%' }}>
                    <View style={{ alignItems: 'center', paddingVertical: 24, backgroundColor: theme.colors.surface, marginBottom: 8, borderRadius: 12, marginHorizontal: 16, marginTop: 16 }}>
                        <Avatar id={getSessionAvatarId(session)} size={80} monochrome={!sessionStatus.isConnected} flavor={session.metadata?.flavor} />
                        <Text style={{
                            fontSize: 20,
                            fontWeight: '600',
                            marginTop: 12,
                            textAlign: 'center',
                            color: theme.colors.text,
                            ...Typography.default('semiBold')
                        }}>
                            {sessionName}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                            <StatusDot color={sessionStatus.statusDotColor} isPulsing={sessionStatus.isPulsing} size={10} />
                            <Text style={{
                                fontSize: 15,
                                color: sessionStatus.statusColor,
                                fontWeight: '500',
                                ...Typography.default()
                            }}>
                                {sessionStatus.statusText}
                            </Text>
                        </View>
                    </View>
                </View>

                {/* CLI Version Warning */}
                {isCliOutdated && (
                    <ItemGroup>
                        <Item
                            title={t('sessionInfo.cliVersionOutdated')}
                            subtitle={t('sessionInfo.updateCliInstructions')}
                            icon={<Ionicons name="warning-outline" size={29} color="#FF9500" />}
                            showChevron={false}
                            onPress={handleCopyUpdateCommand}
                        />
                    </ItemGroup>
                )}

                {/* Session Details */}
                <ItemGroup>
                    <Item
                        title={t('sessionInfo.happySessionId')}
                        subtitle={`${session.id.substring(0, 8)}...${session.id.substring(session.id.length - 8)}`}
                        icon={<Ionicons name="finger-print-outline" size={29} color="#007AFF" />}
                        onPress={handleCopySessionId}
                    />
                    {session.metadata?.claudeSessionId && (
                        <Item
                            title={t('sessionInfo.claudeCodeSessionId')}
                            subtitle={`${session.metadata.claudeSessionId.substring(0, 8)}...${session.metadata.claudeSessionId.substring(session.metadata.claudeSessionId.length - 8)}`}
                            icon={<Ionicons name="code-outline" size={29} color="#9C27B0" />}
                            onPress={async () => {
                                try {
                                    await Clipboard.setStringAsync(session.metadata!.claudeSessionId!);
                                    Modal.alert(t('common.success'), t('sessionInfo.claudeCodeSessionIdCopied'));
                                } catch {
                                    Modal.alert(t('common.error'), t('sessionInfo.failedToCopyClaudeCodeSessionId'));
                                }
                            }}
                        />
                    )}
                    <Item
                        title={t('sessionInfo.connectionStatus')}
                        detail={sessionStatus.isConnected ? t('status.online') : t('status.offline')}
                        icon={<Ionicons name="pulse-outline" size={29} color={sessionStatus.isConnected ? "#34C759" : "#8E8E93"} />}
                        showChevron={false}
                    />
                    <Item
                        title={t('sessionInfo.created')}
                        subtitle={formatDate(session.createdAt)}
                        icon={<Ionicons name="calendar-outline" size={29} color="#007AFF" />}
                        showChevron={false}
                    />
                    <Item
                        title={t('sessionInfo.lastUpdated')}
                        subtitle={formatDate(session.updatedAt)}
                        icon={<Ionicons name="time-outline" size={29} color="#007AFF" />}
                        showChevron={false}
                    />
                    <Item
                        title={t('sessionInfo.sequence')}
                        detail={session.seq.toString()}
                        icon={<Ionicons name="git-commit-outline" size={29} color="#007AFF" />}
                        showChevron={false}
                    />
                </ItemGroup>

                {/* Session Cost */}
                <ItemGroup title={t('sessionInfo.sessionCost')}>
                    <View style={{ marginHorizontal: 16, marginVertical: 8 }}>
                        <SessionCostDisplay sessionId={session.id} />
                    </View>
                </ItemGroup>

                {/* Context Breakdown (HAP-341) */}
                <ItemGroup title={t('sessionInfo.contextBreakdown.sectionTitle')}>
                    <View style={{ marginHorizontal: 16, marginVertical: 8 }}>
                        <ContextBreakdown sessionId={session.id} />
                    </View>
                </ItemGroup>

                {/* Context History Chart (HAP-344) */}
                {session.usageHistory && session.usageHistory.length > 0 && (
                    <ItemGroup title={t('sessionInfo.contextHistory.sectionTitle')}>
                        <View style={{ marginHorizontal: 16, marginVertical: 8 }}>
                            <ContextHistoryChart
                                history={session.usageHistory}
                                currentContextSize={session.latestUsage?.contextSize}
                            />
                        </View>
                    </ItemGroup>
                )}

                {/* Quick Actions */}
                <ItemGroup title={t('sessionInfo.quickActions')}>
                    {session.metadata?.machineId && (
                        <Item
                            title={t('sessionInfo.viewMachine')}
                            subtitle={t('sessionInfo.viewMachineSubtitle')}
                            icon={<Ionicons name="server-outline" size={29} color="#007AFF" />}
                            onPress={() => router.push(`/machine/${session.metadata?.machineId}`)}
                        />
                    )}
                    {sessionStatus.isConnected && (
                        <Item
                            title={t('sessionInfo.archiveSession')}
                            subtitle={t('sessionInfo.archiveSessionSubtitle')}
                            icon={<Ionicons name="archive-outline" size={29} color="#FF3B30" />}
                            onPress={handleArchiveSession}
                        />
                    )}
                    {/* HAP-392: Restore session for archived Claude sessions */}
                    {/* HAP-493: Always wire onPress to provide user feedback */}
                    {canRestore && (
                        <Item
                            title={t('sessionInfo.restoreSession')}
                            subtitle={machineOnline ? t('sessionInfo.restoreSessionSubtitle') : t('sessionInfo.restoreRequiresMachine')}
                            icon={<Ionicons name="refresh-circle-outline" size={29} color={machineOnline ? "#34C759" : "#8E8E93"} />}
                            onPress={handleRestoreSession}
                            disabled={!machineOnline}
                            showChevron={machineOnline}
                        />
                    )}
                    {!sessionStatus.isConnected && !session.active && (
                        <Item
                            title={t('sessionInfo.deleteSession')}
                            subtitle={t('sessionInfo.deleteSessionSubtitle')}
                            icon={<Ionicons name="trash-outline" size={29} color="#FF3B30" />}
                            onPress={handleDeleteSession}
                        />
                    )}
                </ItemGroup>

                {/* Context Management - only show for connected sessions */}
                {sessionStatus.isConnected && (
                    <ItemGroup title={t('sessionInfo.contextManagement')}>
                        <Item
                            title={t('sessionInfo.compactContext')}
                            subtitle={t('sessionInfo.compactContextSubtitle')}
                            icon={<Ionicons name="contract-outline" size={29} color="#5856D6" />}
                            onPress={handleCompactContext}
                        />
                        <Item
                            title={t('sessionInfo.clearContext')}
                            subtitle={t('sessionInfo.clearContextSubtitle')}
                            icon={<Ionicons name="refresh-outline" size={29} color="#FF9500" />}
                            onPress={handleClearContext}
                        />
                    </ItemGroup>
                )}

                {/* Metadata */}
                {session.metadata && (
                    <ItemGroup title={t('sessionInfo.metadata')}>
                        <Item
                            title={t('sessionInfo.host')}
                            subtitle={session.metadata.host}
                            icon={<Ionicons name="desktop-outline" size={29} color="#5856D6" />}
                            showChevron={false}
                        />
                        <Item
                            title={t('sessionInfo.path')}
                            subtitle={formatPathRelativeToHome(session.metadata.path, session.metadata.homeDir)}
                            icon={<Ionicons name="folder-outline" size={29} color="#5856D6" />}
                            showChevron={false}
                        />
                        {session.metadata.version && (
                            <Item
                                title={t('sessionInfo.cliVersion')}
                                subtitle={session.metadata.version}
                                detail={isCliOutdated ? '⚠️' : undefined}
                                icon={<Ionicons name="git-branch-outline" size={29} color={isCliOutdated ? "#FF9500" : "#5856D6"} />}
                                showChevron={false}
                            />
                        )}
                        {session.metadata.os && (
                            <Item
                                title={t('sessionInfo.operatingSystem')}
                                subtitle={formatOSPlatform(session.metadata.os)}
                                icon={<Ionicons name="hardware-chip-outline" size={29} color="#5856D6" />}
                                showChevron={false}
                            />
                        )}
                        <Item
                            title={t('sessionInfo.aiProvider')}
                            subtitle={(() => {
                                const flavor = session.metadata.flavor || 'claude';
                                if (flavor === 'claude') return 'Claude';
                                if (flavor === 'gpt' || flavor === 'openai') return 'Codex';
                                if (flavor === 'gemini') return 'Gemini';
                                return flavor;
                            })()}
                            icon={<Ionicons name="sparkles-outline" size={29} color="#5856D6" />}
                            showChevron={false}
                        />
                        {session.metadata.hostPid && (
                            <Item
                                title={t('sessionInfo.processId')}
                                subtitle={session.metadata.hostPid.toString()}
                                icon={<Ionicons name="terminal-outline" size={29} color="#5856D6" />}
                                showChevron={false}
                            />
                        )}
                        {session.metadata.happyHomeDir && (
                            <Item
                                title={t('sessionInfo.happyHome')}
                                subtitle={formatPathRelativeToHome(session.metadata.happyHomeDir, session.metadata.homeDir)}
                                icon={<Ionicons name="home-outline" size={29} color="#5856D6" />}
                                showChevron={false}
                            />
                        )}
                        <Item
                            title={t('sessionInfo.copyMetadata')}
                            icon={<Ionicons name="copy-outline" size={29} color="#007AFF" />}
                            onPress={handleCopyMetadata}
                        />
                    </ItemGroup>
                )}

                {/* Agent State */}
                {session.agentState && (
                    <ItemGroup title={t('sessionInfo.agentState')}>
                        <Item
                            title={t('sessionInfo.controlledByUser')}
                            detail={session.agentState.controlledByUser ? t('common.yes') : t('common.no')}
                            icon={<Ionicons name="person-outline" size={29} color="#FF9500" />}
                            showChevron={false}
                        />
                        {session.agentState.requests && Object.keys(session.agentState.requests).length > 0 && (
                            <Item
                                title={t('sessionInfo.pendingRequests')}
                                detail={Object.keys(session.agentState.requests).length.toString()}
                                icon={<Ionicons name="hourglass-outline" size={29} color="#FF9500" />}
                                showChevron={false}
                            />
                        )}
                    </ItemGroup>
                )}

                {/* Activity */}
                <ItemGroup title={t('sessionInfo.activity')}>
                    <Item
                        title={t('sessionInfo.thinking')}
                        detail={session.thinking ? t('common.yes') : t('common.no')}
                        icon={<Ionicons name="bulb-outline" size={29} color={session.thinking ? "#FFCC00" : "#8E8E93"} />}
                        showChevron={false}
                    />
                    {session.thinking && (
                        <Item
                            title={t('sessionInfo.thinkingSince')}
                            subtitle={formatDate(session.thinkingAt)}
                            icon={<Ionicons name="timer-outline" size={29} color="#FFCC00" />}
                            showChevron={false}
                        />
                    )}
                </ItemGroup>

                {/* Raw JSON (Dev Mode Only) */}
                {devModeEnabled && (
                    <ItemGroup title="Raw JSON (Dev Mode)">
                        {session.agentState && (
                            <>
                                <Item
                                    title="Agent State"
                                    icon={<Ionicons name="code-working-outline" size={29} color="#FF9500" />}
                                    showChevron={false}
                                />
                                <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
                                    <CodeView 
                                        code={JSON.stringify(session.agentState, null, 2)}
                                        language="json"
                                    />
                                </View>
                            </>
                        )}
                        {session.metadata && (
                            <>
                                <Item
                                    title="Metadata"
                                    icon={<Ionicons name="information-circle-outline" size={29} color="#5856D6" />}
                                    showChevron={false}
                                />
                                <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
                                    <CodeView 
                                        code={JSON.stringify(session.metadata, null, 2)}
                                        language="json"
                                    />
                                </View>
                            </>
                        )}
                        {sessionStatus && (
                            <>
                                <Item
                                    title="Session Status"
                                    icon={<Ionicons name="analytics-outline" size={29} color="#007AFF" />}
                                    showChevron={false}
                                />
                                <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
                                    <CodeView 
                                        code={JSON.stringify({
                                            isConnected: sessionStatus.isConnected,
                                            statusText: sessionStatus.statusText,
                                            statusColor: sessionStatus.statusColor,
                                            statusDotColor: sessionStatus.statusDotColor,
                                            isPulsing: sessionStatus.isPulsing
                                        }, null, 2)}
                                        language="json"
                                    />
                                </View>
                            </>
                        )}
                        {/* Full Session Object */}
                        <Item
                            title="Full Session Object"
                            icon={<Ionicons name="document-text-outline" size={29} color="#34C759" />}
                            showChevron={false}
                        />
                        <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
                            <CodeView 
                                code={JSON.stringify(session, null, 2)}
                                language="json"
                            />
                        </View>
                    </ItemGroup>
                )}
            </ItemList>
        </>
    );
}

export default React.memo(() => {
    const { theme } = useUnistyles();
    const { id } = useLocalSearchParams<{ id: string }>();
    const session = useSession(id);
    const isDataReady = useIsDataReady();

    // Handle three states: loading, deleted, and exists
    if (!isDataReady) {
        // Still loading data
        return (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="hourglass-outline" size={48} color={theme.colors.textSecondary} />
                <Text style={{ color: theme.colors.textSecondary, fontSize: 17, marginTop: 16, ...Typography.default('semiBold') }}>{t('common.loading')}</Text>
            </View>
        );
    }

    if (!session) {
        // Session has been deleted or doesn't exist
        return (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="trash-outline" size={48} color={theme.colors.textSecondary} />
                <Text style={{ color: theme.colors.text, fontSize: 20, marginTop: 16, ...Typography.default('semiBold') }}>{t('errors.sessionDeleted')}</Text>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 15, marginTop: 8, textAlign: 'center', paddingHorizontal: 32, ...Typography.default() }}>{t('errors.sessionDeletedDescription')}</Text>
            </View>
        );
    }

    return <SessionInfoContent session={session} />;
});
