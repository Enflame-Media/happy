import React from 'react';
import { View, Text } from 'react-native';
import Octicons from '@expo/vector-icons/Octicons';
import { useSessionGitStatus, useSessionProjectGitStatus } from '@/sync/storage';
import { useUnistyles } from 'react-native-unistyles';

// Custom hook to check if git status should be shown (only when there are actual changes)
export function useHasMeaningfulGitStatus(sessionId: string): boolean {
    // Use project git status first, fallback to session git status for backward compatibility
    const projectGitStatus = useSessionProjectGitStatus(sessionId);
    const sessionGitStatus = useSessionGitStatus(sessionId);
    const gitStatus = projectGitStatus || sessionGitStatus;

    if (!gitStatus || gitStatus.lastUpdatedAt === 0) {
        return false;
    }

    // Only show when there are actual uncommitted changes
    return gitStatus.isDirty && (
        (gitStatus.modifiedCount + gitStatus.untrackedCount + gitStatus.stagedCount) > 0 ||
        gitStatus.unstagedLinesAdded > 0 ||
        gitStatus.unstagedLinesRemoved > 0
    );
}

interface GitStatusBadgeProps {
    sessionId: string;
}

export function GitStatusBadge({ sessionId }: GitStatusBadgeProps) {
    // Use project git status first, fallback to session git status for backward compatibility
    const projectGitStatus = useSessionProjectGitStatus(sessionId);
    const sessionGitStatus = useSessionGitStatus(sessionId);
    const gitStatus = projectGitStatus || sessionGitStatus;
    const { theme } = useUnistyles();

    // Always show if git repository exists, even without changes
    if (!gitStatus || gitStatus.lastUpdatedAt === 0) {
        return null;
    }

    const hasLineChanges = gitStatus.unstagedLinesAdded > 0 || gitStatus.unstagedLinesRemoved > 0;

    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, overflow: 'hidden' }}>
            {/* Git icon - always shown */}
            <Octicons
                name="git-branch"
                size={16}
                color={theme.colors.button.secondary.tint}
            />

            {/* Line changes only */}
            {hasLineChanges && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                    {gitStatus.unstagedLinesAdded > 0 && (
                        <Text
                            style={{
                                fontSize: 12,
                                color: theme.colors.gitAddedText,
                                fontWeight: '600',
                            }}
                            numberOfLines={1}
                        >
                            +{gitStatus.unstagedLinesAdded}
                        </Text>
                    )}
                    {gitStatus.unstagedLinesRemoved > 0 && (
                        <Text
                            style={{
                                fontSize: 12,
                                color: theme.colors.gitRemovedText,
                                fontWeight: '600',
                            }}
                            numberOfLines={1}
                        >
                            -{gitStatus.unstagedLinesRemoved}
                        </Text>
                    )}
                </View>
            )}
        </View>
    );
}