import React from 'react';
import { View, Text, Platform, Pressable, useWindowDimensions } from 'react-native';
import { Typography } from '@/constants/Typography';
import { useAllMachines, storage, useSetting } from '@/sync/storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';
import { layout } from '@/components/layout';
import { t } from '@/text';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { AgentInput } from '@/components/AgentInput';
import { MultiTextInputHandle } from '@/components/MultiTextInput';
import { useHeaderHeight } from '@/utils/responsive';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { machineSpawnNewSession, isTemporaryPidSessionId, pollForRealSession } from '@/sync/ops';
import { Modal } from '@/modal';
import { sync } from '@/sync/sync';
import { SessionTypeSelector } from '@/components/SessionTypeSelector';
import { createWorktree } from '@/utils/createWorktree';
import { getTempData, type NewSessionData } from '@/utils/tempDataStore';
// HAP-851: Zen is experimental - lazy import to exclude from production bundle
const linkTaskToSession = async (...args: Parameters<typeof import('@/trash/experimental/-zen/model/taskSessionLink').linkTaskToSession>) => {
    const { linkTaskToSession: link } = await import('@/trash/experimental/-zen/model/taskSessionLink');
    return link(...args);
};
import { PermissionMode, ModelMode } from '@/components/PermissionModeSelector';
import { AppError, ErrorCodes } from '@/utils/errors';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { RecentPathsDropdown } from '@/components/RecentPathsDropdown';
import { clearNewSessionDraft, loadNewSessionDraft, saveNewSessionDraft } from '@/sync/persistence';

// Helper function to get the most recent path for a machine from settings or sessions
const getRecentPathForMachine = (machineId: string | null, recentPaths: Array<{ machineId: string; path: string }>): string => {
    if (!machineId) return '/home/';

    // First check recent paths from settings
    const recentPath = recentPaths.find(rp => rp.machineId === machineId);
    if (recentPath) {
        return recentPath.path;
    }

    // Fallback to session history
    const machine = storage.getState().machines[machineId];
    const defaultPath = machine?.metadata?.homeDir || '/home/';

    const sessions = Object.values(storage.getState().sessions);
    const pathsWithTimestamps: Array<{ path: string; timestamp: number }> = [];
    const pathSet = new Set<string>();

    sessions.forEach(session => {
        if (session.metadata?.machineId === machineId && session.metadata?.path) {
            const path = session.metadata.path;
            if (!pathSet.has(path)) {
                pathSet.add(path);
                pathsWithTimestamps.push({
                    path,
                    timestamp: session.updatedAt || session.createdAt
                });
            }
        }
    });

    // Sort by most recent first
    pathsWithTimestamps.sort((a, b) => b.timestamp - a.timestamp);

    return pathsWithTimestamps[0]?.path || defaultPath;
};

// Helper function to get all recent paths for a machine from settings and sessions
const getAllRecentPathsForMachine = (
    machineId: string | null,
    recentPaths: Array<{ machineId: string; path: string }>
): string[] => {
    if (!machineId) return [];

    const paths: string[] = [];
    const pathSet = new Set<string>();

    // First, add paths from recentMachinePaths (these are explicitly saved)
    recentPaths.forEach(rp => {
        if (rp.machineId === machineId && !pathSet.has(rp.path)) {
            paths.push(rp.path);
            pathSet.add(rp.path);
        }
    });

    // Then add paths from session history
    const sessions = Object.values(storage.getState().sessions);
    const pathsWithTimestamps: Array<{ path: string; timestamp: number }> = [];

    sessions.forEach(session => {
        if (session.metadata?.machineId === machineId && session.metadata?.path) {
            const path = session.metadata.path;
            if (!pathSet.has(path)) {
                pathSet.add(path);
                pathsWithTimestamps.push({
                    path,
                    timestamp: session.updatedAt || session.createdAt
                });
            }
        }
    });

    // Sort session paths by most recent first and add them
    pathsWithTimestamps
        .sort((a, b) => b.timestamp - a.timestamp)
        .forEach(item => paths.push(item.path));

    // Return up to 5 recent paths for the dropdown
    return paths.slice(0, 5);
};

// Helper function to update recent machine paths
const updateRecentMachinePaths = (
    currentPaths: Array<{ machineId: string; path: string }>,
    machineId: string,
    path: string
): Array<{ machineId: string; path: string }> => {
    // Remove any existing entry for this machine
    const filtered = currentPaths.filter(rp => rp.machineId !== machineId);
    // Add new entry at the beginning
    const updated = [{ machineId, path }, ...filtered];
    // Keep only the last 10 entries
    return updated.slice(0, 10);
};

function NewSessionScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const { showError } = useErrorHandler();
    const { prompt, dataId, selectedPath: pathFromParam, selectedMachineId: machineIdFromParam } = useLocalSearchParams<{ prompt?: string; dataId?: string; selectedPath?: string; selectedMachineId?: string }>();

    // Try to get data from temporary store first, fallback to direct prompt parameter
    const tempSessionData = React.useMemo(() => {
        if (dataId) {
            return getTempData<NewSessionData>(dataId);
        }
        return null;
    }, [dataId]);

    const persistedDraft = React.useRef(loadNewSessionDraft()).current;

    const [input, setInput] = React.useState(() => {
        if (tempSessionData?.prompt) {
            return tempSessionData.prompt;
        }
        return prompt || persistedDraft?.input || '';
    });
    const [isSending, setIsSending] = React.useState(false);
    const [sessionType, setSessionType] = React.useState<'simple' | 'worktree'>(() => {
        if (tempSessionData?.sessionType) {
            return tempSessionData.sessionType;
        }
        return persistedDraft?.sessionType || 'simple';
    });
    // State for pending session polling (HAP-443)
    const [pendingSessionStatus, setPendingSessionStatus] = React.useState<string | null>(null);
    const ref = React.useRef<MultiTextInputHandle>(null);
    const headerHeight = useHeaderHeight();
    const safeArea = useSafeAreaInsets();
    const screenWidth = useWindowDimensions().width;

    // Load recent machine paths and last used agent from settings
    const recentMachinePaths = useSetting('recentMachinePaths');
    const lastUsedAgent = useSetting('lastUsedAgent');
    const lastUsedPermissionMode = useSetting('lastUsedPermissionMode');
    const lastUsedModelMode = useSetting('lastUsedModelMode');
    const experimentsEnabled = useSetting('experiments');

    //
    // Machines state
    //

    const machines = useAllMachines();
    const [selectedMachineId, setSelectedMachineId] = React.useState<string | null>(() => {
        const machineIdFromDraft = tempSessionData?.machineId ?? persistedDraft?.selectedMachineId;
        if (machineIdFromDraft) {
            return machineIdFromDraft;
        }
        if (machines.length > 0) {
            // Check if we have a recently used machine that's currently available
            if (recentMachinePaths.length > 0) {
                // Find the first machine from recent paths that's currently available
                for (const recent of recentMachinePaths) {
                    if (machines.find(m => m.id === recent.machineId)) {
                        return recent.machineId;
                    }
                }
            }
            // Fallback to first machine if no recent machine is available
            return machines[0].id;
        }
        return null;
    });
    React.useEffect(() => {
        if (machines.length > 0) {
            if (!selectedMachineId) {
                // No machine selected yet, prefer the most recently used machine
                let machineToSelect = machines[0].id; // Default to first machine

                // Check if we have a recently used machine that's currently available
                if (recentMachinePaths.length > 0) {
                    for (const recent of recentMachinePaths) {
                        if (machines.find(m => m.id === recent.machineId)) {
                            machineToSelect = recent.machineId;
                            break; // Use the first (most recent) match
                        }
                    }
                }

                setSelectedMachineId(machineToSelect);
                // Also set the best path for the selected machine
                const bestPath = getRecentPathForMachine(machineToSelect, recentMachinePaths);
                setSelectedPath(bestPath);
            } else {
                // Machine is already selected, but check if we need to update path
                // This handles the case where machines load after initial render
                const currentMachine = machines.find(m => m.id === selectedMachineId);
                if (!currentMachine) {
                    // Selected machine doesn't exist anymore - fall back safely
                    const fallbackMachineId = machines[0].id;
                    setSelectedMachineId(fallbackMachineId);
                    const bestPath = getRecentPathForMachine(fallbackMachineId, recentMachinePaths);
                    setSelectedPath(bestPath);
                    return;
                }

                // Update path based on recent paths (only if path hasn't been manually changed)
                const bestPath = getRecentPathForMachine(selectedMachineId, recentMachinePaths);
                setSelectedPath(prevPath => {
                    // Only update if current path is the default /home/
                    if (prevPath === '/home/' && bestPath !== '/home/') {
                        return bestPath;
                    }
                    return prevPath;
                });
            }
        }
    }, [machines, selectedMachineId, recentMachinePaths]);

    // Handle machine selection from URL param (set by machine picker on web)
    React.useEffect(() => {
        if (machineIdFromParam) {
            const machine = storage.getState().machines[machineIdFromParam];
            if (machine) {
                setSelectedMachineId(machineIdFromParam);
                // Also update the path when machine changes
                const bestPath = getRecentPathForMachine(machineIdFromParam, recentMachinePaths);
                setSelectedPath(bestPath);
            }
        }
    }, [machineIdFromParam, recentMachinePaths]);

    // Handle path selection from URL param (set by path picker on web)
    React.useEffect(() => {
        if (pathFromParam) {
            const decodedPath = decodeURIComponent(pathFromParam);
            if (decodedPath.trim()) {
                setSelectedPath(decodedPath);
            }
        }
    }, [pathFromParam]);

    const handleMachineClick = React.useCallback(() => {
        router.push('/new/pick/machine');
    }, [router]);

    //
    // Agent selection
    //

    const [agentType, setAgentType] = React.useState<'claude' | 'codex' | 'gemini'>(() => {
        // Check if agent type was provided in temp data
        if (tempSessionData?.agentType) {
            return tempSessionData.agentType;
        }
        // Use persisted draft if available
        if (persistedDraft?.agentType) {
            if (persistedDraft.agentType === 'gemini' && !experimentsEnabled) {
                return 'claude';
            }
            return persistedDraft.agentType;
        }
        // Initialize with last used agent if valid, otherwise default to 'claude'
        if (lastUsedAgent === 'claude' || lastUsedAgent === 'codex') {
            return lastUsedAgent;
        }
        return 'claude';
    });

    const handleAgentClick = React.useCallback(() => {
        setAgentType(prev => {
            const newAgent = prev === 'claude' ? 'codex' : 'claude';
            // Save the new selection immediately
            sync.applySettings({ lastUsedAgent: newAgent });
            return newAgent;
        });
    }, []);

    //
    // Permission and Model Mode selection
    //

    const [permissionMode, setPermissionMode] = React.useState<PermissionMode>(() => {
        // Initialize with last used permission mode if valid, otherwise default to 'default'
        const validClaudeModes: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];
        const validCodexModes: PermissionMode[] = ['default', 'read-only', 'safe-yolo', 'yolo'];

        const permissionModeFromDraft = persistedDraft?.permissionMode ?? lastUsedPermissionMode;
        if (permissionModeFromDraft) {
            if (agentType === 'codex' && validCodexModes.includes(permissionModeFromDraft as PermissionMode)) {
                return permissionModeFromDraft as PermissionMode;
            } else if ((agentType === 'claude' || agentType === 'gemini') && validClaudeModes.includes(permissionModeFromDraft as PermissionMode)) {
                return permissionModeFromDraft as PermissionMode;
            }
        }
        return 'default';
    });

    const [modelMode, setModelMode] = React.useState<ModelMode>(() => {
        // Initialize with last used model mode if valid, otherwise default to opus
        const validClaudeModes: ModelMode[] = ['opus', 'sonnet', 'haiku'];
        const validCodexModes: ModelMode[] = ['gpt-5-codex-high', 'gpt-5-codex-medium', 'gpt-5-codex-low', 'gpt-5-minimal', 'gpt-5-low', 'gpt-5-medium', 'gpt-5-high'];

        if (lastUsedModelMode) {
            if (agentType === 'codex' && validCodexModes.includes(lastUsedModelMode as ModelMode)) {
                return lastUsedModelMode as ModelMode;
            } else if (agentType === 'claude' && validClaudeModes.includes(lastUsedModelMode as ModelMode)) {
                return lastUsedModelMode as ModelMode;
            }
        }
        return agentType === 'codex' ? 'gpt-5-codex-high' : 'opus';
    });

    // Reset permission and model modes when agent type changes
    const hasMountedRef = React.useRef(false);
    React.useEffect(() => {
        if (!hasMountedRef.current) {
            hasMountedRef.current = true;
            return;
        }
        if (agentType === 'codex') {
            // Switch to codex-compatible modes
            setPermissionMode('default');
            setModelMode('gpt-5-codex-high');
        } else {
            // Switch to claude-compatible modes (opus is default)
            setPermissionMode('default');
            setModelMode('opus');
        }
    }, [agentType]);

    const handlePermissionModeChange = React.useCallback((mode: PermissionMode) => {
        setPermissionMode(mode);
        // Save the new selection immediately
        sync.applySettings({ lastUsedPermissionMode: mode });
    }, []);

    const handleModelModeChange = React.useCallback((mode: ModelMode) => {
        setModelMode(mode);
        // Save the new selection immediately
        sync.applySettings({ lastUsedModelMode: mode });
    }, []);

    //
    // Path selection
    //

    const [selectedPath, setSelectedPath] = React.useState<string>(() => {
        // Use path from URL param if available (set by path picker on web)
        if (pathFromParam) {
            return decodeURIComponent(pathFromParam);
        }
        // Initialize with the path from the selected machine (which should be the most recent if available)
        const pathFromDraft = tempSessionData?.path ?? persistedDraft?.selectedPath;
        if (pathFromDraft) {
            return pathFromDraft;
        }
        return getRecentPathForMachine(selectedMachineId, recentMachinePaths);
    });

    const [showPathDropdown, setShowPathDropdown] = React.useState(false);

    // Get all recent paths for dropdown
    const recentPathsForMachine = React.useMemo(() => {
        return getAllRecentPathsForMachine(selectedMachineId, recentMachinePaths);
    }, [selectedMachineId, recentMachinePaths]);

    // Also update when pathFromParam changes (for web navigation)
    React.useEffect(() => {
        if (pathFromParam) {
            setSelectedPath(decodeURIComponent(pathFromParam));
        }
    }, [pathFromParam]);

    // Show dropdown if there are recent paths, otherwise go directly to full picker
    const handlePathClick = React.useCallback(() => {
        if (selectedMachineId) {
            if (recentPathsForMachine.length > 0) {
                setShowPathDropdown(true);
            } else {
                // No recent paths, go directly to full picker
                const params = new URLSearchParams();
                params.set('machineId', selectedMachineId);
                if (prompt) params.set('returnPrompt', prompt);
                if (dataId) params.set('returnDataId', dataId);
                router.push(`/new/pick/path?${params.toString()}`);
            }
        }
    }, [selectedMachineId, recentPathsForMachine.length, router, prompt, dataId]);

    const handleClosePathDropdown = React.useCallback(() => {
        setShowPathDropdown(false);
    }, []);

    const handleSelectPathFromDropdown = React.useCallback((path: string) => {
        setSelectedPath(path);
    }, []);

    const handleBrowseAllPaths = React.useCallback(() => {
        if (selectedMachineId) {
            const params = new URLSearchParams();
            params.set('machineId', selectedMachineId);
            if (prompt) params.set('returnPrompt', prompt);
            if (dataId) params.set('returnDataId', dataId);
            router.push(`/new/pick/path?${params.toString()}`);
        }
    }, [selectedMachineId, router, prompt, dataId]);

    // Get selected machine name
    const selectedMachine = React.useMemo(() => {
        if (!selectedMachineId) return null;
        return machines.find(m => m.id === selectedMachineId);
    }, [selectedMachineId, machines]);

    // Autofocus
    React.useLayoutEffect(() => {
        if (Platform.OS === 'ios') {
            setTimeout(() => {
                ref.current?.focus();
            }, 800);
        } else {
            ref.current?.focus();
        }
    }, []);

    // Create
    const doCreate = React.useCallback(async () => {
        if (!selectedMachineId) {
            Modal.alert(t('common.error'), t('newSession.noMachineSelected'));
            return;
        }
        if (!selectedPath) {
            Modal.alert(t('common.error'), t('newSession.noPathSelected'));
            return;
        }

        setIsSending(true);
        try {
            let actualPath = selectedPath;
            
            // Handle worktree creation if selected and experiments are enabled
            if (sessionType === 'worktree' && experimentsEnabled) {
                const worktreeResult = await createWorktree(selectedMachineId, selectedPath);
                
                if (!worktreeResult.success) {
                    if (worktreeResult.error === 'Not a Git repository') {
                        Modal.alert(
                            t('common.error'), 
                            t('newSession.worktree.notGitRepo')
                        );
                    } else {
                        Modal.alert(
                            t('common.error'), 
                            t('newSession.worktree.failed', { error: worktreeResult.error || 'Unknown error' })
                        );
                    }
                    setIsSending(false);
                    return;
                }
                
                // Update the path to the new worktree location
                actualPath = worktreeResult.worktreePath;
            }

            // Save the machine-path combination to settings before sending
            const updatedPaths = updateRecentMachinePaths(recentMachinePaths, selectedMachineId, selectedPath);
            sync.applySettings({ recentMachinePaths: updatedPaths });

            // HAP-580: Record spawn time BEFORE calling machineSpawnNewSession
            // This allows us to poll for sessions created after this time if the RPC times out
            const spawnStartTime = Date.now();

            const result = await machineSpawnNewSession({
                machineId: selectedMachineId,
                directory: actualPath,
                // For now we assume you already have a path to start in
                approvedNewDirectoryCreation: true,
                agent: agentType
            });

            let sessionId: string | null = null;

            // Use sessionId to check for success for backwards compatibility
            if ('sessionId' in result && result.sessionId) {
                sessionId = result.sessionId;
                clearNewSessionDraft();

                // Check if this is a temporary PID-based session ID
                // (returned when daemon's webhook timeout exceeded but process was spawned)
                // HAP-443: Poll for the real session instead of redirecting immediately
                if (isTemporaryPidSessionId(result.sessionId)) {
                    setPendingSessionStatus(t('newSession.sessionPolling'));

                    // Poll for the real session ID (5s intervals, up to 2 minutes)
                    // HAP-580: Use the spawnStartTime captured before RPC call
                    const realSessionId = await pollForRealSession(
                        selectedMachineId,
                        spawnStartTime,
                        {
                            interval: 5000,
                            maxAttempts: 24,
                            onPoll: (attempt, maxAttempts) => {
                                setPendingSessionStatus(
                                    t('newSession.sessionPollingProgress', { attempt, maxAttempts })
                                );
                            }
                        }
                    );

                    if (!realSessionId) {
                        // Polling timed out - session never appeared
                        setPendingSessionStatus(null);
                        Modal.alert(
                            t('common.error'),
                            t('newSession.sessionStartFailed')
                        );
                        router.replace('/');
                        return;
                    }

                    // Use the real session ID from now on
                    sessionId = realSessionId;
                    setPendingSessionStatus(null);
                }
            } else {
                // HAP-580: Optimistic polling fallback
                // The RPC may have timed out even though the session was created successfully.
                // Poll for new sessions before giving up, similar to the PID-polling pattern.
                setPendingSessionStatus(t('newSession.sessionPolling'));

                const polledSessionId = await pollForRealSession(
                    selectedMachineId,
                    spawnStartTime,
                    {
                        interval: 3000,  // Check every 3 seconds
                        maxAttempts: 10, // Up to 30 seconds of polling
                        onPoll: (attempt, maxAttempts) => {
                            setPendingSessionStatus(
                                t('newSession.sessionPollingProgress', { attempt, maxAttempts })
                            );
                        }
                    }
                );

                setPendingSessionStatus(null);

                if (polledSessionId) {
                    // Found the session via polling - use it
                    sessionId = polledSessionId;
                } else {
                    // Polling also failed - now we can give up
                    throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Session spawning failed - no session ID returned.');
                }
            }

            // At this point sessionId is guaranteed to be set (either from RPC or polling)
            if (!sessionId) {
                throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Session spawning failed - no session ID returned.');
            }

            // Store worktree metadata if applicable
            if (sessionType === 'worktree') {
                // The metadata will be stored by the session itself once created
            }

            // Link task to session if task ID is provided
            if (tempSessionData?.taskId && tempSessionData?.taskTitle) {
                const promptDisplayTitle = tempSessionData.prompt?.startsWith('Work on this task:')
                    ? `Work on: ${tempSessionData.taskTitle}`
                    : `Clarify: ${tempSessionData.taskTitle}`;
                await linkTaskToSession(
                    tempSessionData.taskId,
                    sessionId,
                    tempSessionData.taskTitle,
                    promptDisplayTitle
                );
            }

            // Load sessions
            await sync.refreshSessions();

            // Set permission and model modes on the session
            storage.getState().updateSessionPermissionMode(sessionId, permissionMode);
            storage.getState().updateSessionModelMode(sessionId, modelMode);

            // Send message
            await sync.sendMessage(sessionId, input);
            // Navigate to session
            router.replace(`/session/${sessionId}`, {
                dangerouslySingular() {
                    return 'session'
                },
            });
        } catch (error) {
            console.error('Failed to start session', error);

            // HAP-544: Use showError for AppErrors to get "Copy ID" button
            if (AppError.isAppError(error)) {
                showError(error);
            } else if (error instanceof Error) {
                // Custom fallback messages for specific error types
                let errorMessage: string;
                if (error.message.includes('timeout')) {
                    errorMessage = 'Session startup timed out. The machine may be slow or the daemon may not be responding.';
                } else if (error.message.includes('Socket not connected')) {
                    errorMessage = 'Not connected to server. Check your internet connection.';
                } else {
                    errorMessage = 'Failed to start session. Make sure the daemon is running on the target machine.';
                }
                Modal.alert(t('common.error'), errorMessage);
            } else {
                showError(error, { fallbackMessage: 'Failed to start session. Make sure the daemon is running on the target machine.' });
            }
        } finally {
            setIsSending(false);
        }
    }, [agentType, selectedMachineId, selectedPath, input, recentMachinePaths, sessionType, experimentsEnabled, permissionMode, modelMode, router, tempSessionData?.taskId, tempSessionData?.taskTitle, tempSessionData?.prompt, showError]);

    // Persist the current modal state so it survives remounts and reopen/close
    const draftSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    React.useEffect(() => {
        if (draftSaveTimerRef.current) {
            clearTimeout(draftSaveTimerRef.current);
        }
        draftSaveTimerRef.current = setTimeout(() => {
            saveNewSessionDraft({
                input,
                selectedMachineId,
                selectedPath,
                agentType,
                permissionMode,
                sessionType,
                updatedAt: Date.now(),
            });
        }, 250);
        return () => {
            if (draftSaveTimerRef.current) {
                clearTimeout(draftSaveTimerRef.current);
            }
        };
    }, [input, selectedMachineId, selectedPath, agentType, permissionMode, sessionType]);

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? Constants.statusBarHeight + headerHeight : 0}
            style={{
                flex: 1,
                justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end',
                paddingTop: Platform.OS === 'web' ? 0 : 40,
                marginBottom: safeArea.bottom,
            }}
        >
            <View style={{
                width: '100%',
                alignSelf: 'center',
                paddingTop: safeArea.top,
            }}>
                {/* Session type selector - only show when experiments are enabled */}
                {experimentsEnabled && (
                    <View style={[
                        { paddingHorizontal: screenWidth > 700 ? 16 : 8, flexDirection: 'row', justifyContent: 'center' }
                    ]}>
                        <View style={[
                            { maxWidth: layout.maxWidth, flex: 1 }
                        ]}>
                            <SessionTypeSelector 
                                value={sessionType}
                                onChange={setSessionType}
                            />
                        </View>
                    </View>
                )}

                {/* Agent input */}
                <AgentInput
                    placeholder={t('session.inputPlaceholder')}
                    ref={ref}
                    value={input}
                    onChangeText={setInput}
                    onSend={doCreate}
                    isSending={isSending || pendingSessionStatus !== null}
                    agentType={agentType}
                    onAgentClick={handleAgentClick}
                    machineName={selectedMachine?.metadata?.displayName || selectedMachine?.metadata?.host || null}
                    onMachineClick={handleMachineClick}
                    permissionMode={permissionMode}
                    onPermissionModeChange={handlePermissionModeChange}
                    modelMode={modelMode}
                    onModelModeChange={handleModelModeChange}
                    autocompletePrefixes={[]}
                    autocompleteSuggestions={async () => []}
                />

                {/* Pending session status indicator (HAP-443) */}
                {pendingSessionStatus && (
                    <View style={[
                        { paddingHorizontal: screenWidth > 700 ? 16 : 8, flexDirection: 'row', justifyContent: 'center' }
                    ]}>
                        <View style={[
                            { maxWidth: layout.maxWidth, flex: 1, paddingVertical: 8 }
                        ]}>
                            <Text style={{
                                fontSize: 13,
                                color: theme.colors.textSecondary,
                                textAlign: 'center',
                                ...Typography.default('regular'),
                            }}>
                                {pendingSessionStatus}
                            </Text>
                        </View>
                    </View>
                )}

                <View style={[
                    { paddingHorizontal: screenWidth > 700 ? 16 : 8, flexDirection: 'row', justifyContent: 'center' }
                ]}>
                    <View style={[
                        { maxWidth: layout.maxWidth, flex: 1 }
                    ]}>
                        <Pressable
                            onPress={handlePathClick}
                            style={(p) => ({
                                backgroundColor: theme.colors.input.background,
                                borderRadius: Platform.select({ default: 16, android: 20 }),
                                paddingHorizontal: 12,
                                paddingVertical: 10,
                                marginBottom: 8,
                                flexDirection: 'row',
                                alignItems: 'center',
                                opacity: p.pressed ? 0.7 : 1,
                            })}
                        >
                            <Ionicons
                                name="folder-outline"
                                size={14}
                                color={theme.colors.button.secondary.tint}
                            />
                            <Text style={{
                                fontSize: 13,
                                color: theme.colors.button.secondary.tint,
                                fontWeight: '600',
                                marginLeft: 6,
                                ...Typography.default('semiBold'),
                            }}>
                                {selectedPath}
                            </Text>
                        </Pressable>
                    </View>
                </View>
            </View>

            {/* Recent paths dropdown */}
            <RecentPathsDropdown
                visible={showPathDropdown}
                onClose={handleClosePathDropdown}
                recentPaths={recentPathsForMachine}
                selectedPath={selectedPath}
                onSelectPath={handleSelectPathFromDropdown}
                onBrowseAll={handleBrowseAllPaths}
            />
        </KeyboardAvoidingView>
    )
}

export default React.memo(NewSessionScreen);
