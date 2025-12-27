import React from 'react';
import { View, FlatList } from 'react-native';
import { Text } from '@/components/StyledText';
import { useAllSessions, useAllMachines } from '@/sync/storage';
import { Session, Machine } from '@/sync/storageTypes';
import { Avatar } from '@/components/Avatar';
import { getSessionName, getSessionSubtitle, getSessionAvatarId } from '@/utils/sessionUtils';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { layout } from '@/components/layout';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { Pressable } from 'react-native';
import { t } from '@/text';
import { isMachineOnline } from '@/utils/machineUtils';
import { machineSpawnNewSession, isTemporaryPidSessionId, pollForRealSession } from '@/sync/ops';
import { Modal } from '@/modal';
import { sync } from '@/sync/sync';
import { useRouter } from 'expo-router';
import { useErrorHandler } from '@/hooks/useErrorHandler';

interface SessionHistoryItem {
    type: 'session' | 'date-header';
    session?: Session;
    date?: string;
}

const styles = StyleSheet.create((theme) => ({
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
    dateHeader: {
        backgroundColor: theme.colors.groupped.background,
        paddingTop: 20,
        paddingBottom: 8,
        paddingHorizontal: 24,
    },
    dateHeaderText: {
        ...Typography.default('semiBold'),
        color: theme.colors.groupped.sectionTitle,
        fontSize: 14,
        fontWeight: '600',
        letterSpacing: 0.1,
    },
    sessionCard: {
        backgroundColor: theme.colors.surface,
        marginHorizontal: 16,
        marginBottom: 1,
        paddingVertical: 16,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
    },
    sessionCardFirst: {
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
    },
    sessionCardLast: {
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
        marginBottom: 12,
    },
    sessionCardSingle: {
        borderRadius: 12,
        marginBottom: 12,
    },
    sessionContent: {
        flex: 1,
        marginLeft: 16,
    },
    sessionTitle: {
        fontSize: 15,
        fontWeight: '500',
        color: theme.colors.text,
        marginBottom: 2,
        ...Typography.default('semiBold'),
    },
    sessionSubtitle: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
    },
    emptyText: {
        fontSize: 16,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        ...Typography.default(),
    },
    resumeButton: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        backgroundColor: theme.colors.button.primary.background,
        marginLeft: 8,
    },
    resumeButtonDisabled: {
        backgroundColor: theme.colors.button.primary.disabled,
    },
    resumeButtonText: {
        fontSize: 12,
        fontWeight: '600',
        color: theme.colors.button.primary.tint,
        ...Typography.default('semiBold'),
    },
    resumeButtonTextDisabled: {
        color: theme.colors.textSecondary,
    },
}));

function formatDateHeader(date: Date): string {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const sessionDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    if (sessionDate.getTime() === today.getTime()) {
        return t('sessionHistory.today');
    } else if (sessionDate.getTime() === yesterday.getTime()) {
        return t('sessionHistory.yesterday');
    } else {
        const diffTime = today.getTime() - sessionDate.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        return t('sessionHistory.daysAgo', { count: diffDays });
    }
}

function groupSessionsByDate(sessions: Session[]): SessionHistoryItem[] {
    const sortedSessions = sessions
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt);
    
    const items: SessionHistoryItem[] = [];
    let currentDateGroup: Session[] = [];
    let currentDateString: string | null = null;
    
    for (const session of sortedSessions) {
        const sessionDate = new Date(session.updatedAt);
        const dateString = sessionDate.toDateString();
        
        if (currentDateString !== dateString) {
            // Process previous group
            if (currentDateGroup.length > 0) {
                items.push({
                    type: 'date-header',
                    date: formatDateHeader(new Date(currentDateString!)),
                });
                currentDateGroup.forEach(sess => {
                    items.push({ type: 'session', session: sess });
                });
            }
            
            // Start new group
            currentDateString = dateString;
            currentDateGroup = [session];
        } else {
            currentDateGroup.push(session);
        }
    }
    
    // Process final group
    if (currentDateGroup.length > 0) {
        items.push({
            type: 'date-header',
            date: formatDateHeader(new Date(currentDateString!)),
        });
        currentDateGroup.forEach(sess => {
            items.push({ type: 'session', session: sess });
        });
    }
    
    return items;
}

/**
 * Check if a session can be resumed.
 * Sessions are resumable if:
 * 1. They have a Claude Code session ID (claudeSessionId in metadata)
 * 2. They are Claude sessions (not Codex - which doesn't support --resume)
 * 3. Their associated machine is online
 */
function isSessionResumable(session: Session, machines: Machine[]): { canResume: boolean; reason?: string } {
    // Must have metadata with machineId and claudeSessionId
    if (!session.metadata?.machineId) {
        return { canResume: false, reason: 'noMachine' };
    }
    if (!session.metadata?.claudeSessionId) {
        return { canResume: false, reason: 'noClaudeSessionId' };
    }

    // Must be a Claude session (not Codex, as Codex doesn't support --resume)
    const flavor = session.metadata.flavor ?? 'claude';
    if (flavor !== 'claude') {
        return { canResume: false, reason: 'notClaude' };
    }

    // Machine must be online
    const machine = machines.find(m => m.id === session.metadata?.machineId);
    if (!machine || !isMachineOnline(machine)) {
        return { canResume: false, reason: 'machineOffline' };
    }

    return { canResume: true };
}

function SessionHistory() {
    const safeArea = useSafeAreaInsets();
    const allSessions = useAllSessions();
    const allMachines = useAllMachines();
    const navigateToSession = useNavigateToSession();
    const router = useRouter();
    const { showError } = useErrorHandler();
    const [resumingSessionId, setResumingSessionId] = React.useState<string | null>(null);

    const groupedItems = React.useMemo(() => {
        return groupSessionsByDate(allSessions);
    }, [allSessions]);

    /**
     * Handle resuming a session.
     * This creates a NEW session with the full conversation history from the original.
     * The original session remains unchanged (this is how Claude's --resume works).
     */
    const handleResumeSession = React.useCallback(async (session: Session) => {
        if (!session.metadata?.machineId || !session.metadata?.path || !session.metadata?.claudeSessionId) {
            Modal.alert(t('common.error'), t('sessionHistory.resumeNotAvailable'));
            return;
        }

        // Confirm with user, explaining that this creates a NEW session
        const confirmed = await Modal.confirm(
            t('sessionHistory.resumeConfirm'),
            t('sessionHistory.resumeDescription'),
            {
                confirmText: t('sessionHistory.resume'),
                cancelText: t('common.cancel'),
            }
        );

        if (!confirmed) {
            return;
        }

        setResumingSessionId(session.id);

        try {
            // HAP-584: Capture spawn time BEFORE RPC call for optimistic polling fallback
            const spawnStartTime = Date.now();

            const result = await machineSpawnNewSession({
                machineId: session.metadata.machineId,
                directory: session.metadata.path,
                approvedNewDirectoryCreation: true,
                agent: 'claude',
                sessionId: session.metadata.claudeSessionId,
            });

            let sessionId: string | null = null;

            if ('sessionId' in result && result.sessionId) {
                sessionId = result.sessionId;

                // HAP-488: Check for temporary PID-based session ID
                if (isTemporaryPidSessionId(result.sessionId)) {
                    // HAP-584: Use pre-captured spawnStartTime for polling
                    const realSessionId = await pollForRealSession(
                        session.metadata.machineId,
                        spawnStartTime,
                        { interval: 5000, maxAttempts: 24 }
                    );

                    if (!realSessionId) {
                        Modal.alert(t('common.error'), t('newSession.sessionStartFailed'));
                        return;
                    }

                    sessionId = realSessionId;
                }
            } else {
                // HAP-584: Optimistic polling fallback
                // The RPC may have timed out even though the session was created successfully.
                const polledSessionId = await pollForRealSession(
                    session.metadata.machineId,
                    spawnStartTime,
                    { interval: 3000, maxAttempts: 10 }
                );

                if (polledSessionId) {
                    sessionId = polledSessionId;
                } else {
                    Modal.alert(t('common.error'), t('sessionHistory.resumeFailed'));
                    return;
                }
            }

            // Refresh sessions to get the new one
            await sync.refreshSessions();

            // Navigate to the new session
            router.replace(`/session/${sessionId}`, {
                dangerouslySingular() {
                    return 'session';
                },
            });
        } catch (error) {
            console.error('Failed to resume session:', error);
            // HAP-544: Use showError for "Copy ID" button on server errors
            showError(error, { fallbackMessage: t('sessionHistory.resumeFailed') });
        } finally {
            setResumingSessionId(null);
        }
    }, [router, showError]);
    
    const renderItem = React.useCallback(({ item, index }: { item: SessionHistoryItem, index: number }) => {
        if (item.type === 'date-header') {
            return (
                <View style={styles.dateHeader}>
                    <Text style={styles.dateHeaderText}>
                        {item.date}
                    </Text>
                </View>
            );
        }
        
        if (item.type === 'session' && item.session) {
            const session = item.session;
            const sessionName = getSessionName(session);
            const sessionSubtitle = getSessionSubtitle(session);
            const avatarId = getSessionAvatarId(session);

            // Check if session can be resumed
            const resumeInfo = isSessionResumable(session, allMachines);
            const isResuming = resumingSessionId === session.id;

            // Determine card styling based on position within date group
            const prevItem = index > 0 ? groupedItems[index - 1] : null;
            const nextItem = index < groupedItems.length - 1 ? groupedItems[index + 1] : null;

            const isFirst = prevItem?.type === 'date-header';
            const isLast = nextItem?.type === 'date-header' || nextItem == null;
            const isSingle = isFirst && isLast;

            return (
                <Pressable
                    style={[
                        styles.sessionCard,
                        isSingle ? styles.sessionCardSingle :
                        isFirst ? styles.sessionCardFirst :
                        isLast ? styles.sessionCardLast : {}
                    ]}
                    onPress={() => navigateToSession(session.id)}
                >
                    <Avatar id={avatarId} size={48} flavor={session.metadata?.flavor} />
                    <View style={styles.sessionContent}>
                        <Text style={styles.sessionTitle} numberOfLines={1}>
                            {sessionName}
                        </Text>
                        <Text style={styles.sessionSubtitle} numberOfLines={1}>
                            {sessionSubtitle}
                        </Text>
                    </View>
                    {/* Resume button - only show for resumable Claude sessions */}
                    {resumeInfo.canResume && (
                        <Pressable
                            style={[
                                styles.resumeButton,
                                isResuming && styles.resumeButtonDisabled
                            ]}
                            onPress={(e) => {
                                e.stopPropagation();
                                if (!isResuming) {
                                    handleResumeSession(session);
                                }
                            }}
                            disabled={isResuming}
                        >
                            <Text style={[
                                styles.resumeButtonText,
                                isResuming && styles.resumeButtonTextDisabled
                            ]}>
                                {isResuming ? t('common.loading') : t('sessionHistory.resume')}
                            </Text>
                        </Pressable>
                    )}
                </Pressable>
            );
        }

        return null;
    }, [groupedItems, navigateToSession, allMachines, resumingSessionId, handleResumeSession]);
    
    const keyExtractor = React.useCallback((item: SessionHistoryItem, index: number) => {
        if (item.type === 'date-header') {
            return `date-${item.date}-${index}`;
        }
        if (item.type === 'session' && item.session) {
            return `session-${item.session.id}`;
        }
        return `item-${index}`;
    }, []);
    
    if (!allSessions) {
        return (
            <View style={styles.container}>
                <View style={styles.contentContainer} />
            </View>
        );
    }
    
    if (groupedItems.length === 0) {
        return (
            <View style={styles.container}>
                <View style={styles.contentContainer}>
                    <View style={styles.emptyContainer}>
                        <Text style={styles.emptyText}>
                            {t('sessionHistory.empty')}
                        </Text>
                    </View>
                </View>
            </View>
        );
    }
    
    return (
        <View style={styles.container}>
            <View style={styles.contentContainer}>
                <FlatList
                    data={groupedItems}
                    renderItem={renderItem}
                    keyExtractor={keyExtractor}
                    contentContainerStyle={{ 
                        paddingBottom: safeArea.bottom + 16,
                        paddingTop: 8,
                    }}
                />
            </View>
        </View>
    );
}

export default React.memo(SessionHistory);