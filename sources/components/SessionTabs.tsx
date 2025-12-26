import * as React from 'react';
import { View, Pressable, ScrollView } from 'react-native';
import { Text } from '@/components/StyledText';
import { Session } from '@/sync/storageTypes';
import { useAllSessions } from '@/sync/storage';
import { getSessionName, useSessionStatus } from '@/utils/sessionUtils';
import { StatusDot } from './StatusDot';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { layout } from '@/components/layout';
import { Typography } from '@/constants/Typography';
import { StyleSheet } from 'react-native-unistyles';

/**
 * SessionTabs - Horizontal scrollable tab bar for switching between active sessions
 *
 * HAP-327: Added session tabs component for quick session switching when 2+ sessions are active.
 *
 * Features:
 * - Shows only when 2+ active sessions exist
 * - Current session is highlighted
 * - Status indicator (dot) shows session state
 * - Tapping a tab navigates to that session
 * - Horizontal scrolling for many sessions
 */

interface SessionTabsProps {
    /** Current session ID */
    currentSessionId: string;
}

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        width: '100%',
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        backgroundColor: theme.colors.header.background,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    scrollContent: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        flexDirection: 'row',
        gap: 8,
    },
    tab: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        backgroundColor: theme.colors.surfaceHigh,
        maxWidth: 160,
    },
    tabActive: {
        backgroundColor: theme.colors.textLink,
    },
    statusDot: {
        marginRight: 6,
    },
    tabText: {
        fontSize: 13,
        color: theme.colors.text,
        ...Typography.default(),
    },
    tabTextActive: {
        color: '#fff',
        fontWeight: '600',
        ...Typography.default('semiBold'),
    },
    tabTextInactive: {
        color: theme.colors.textSecondary,
    },
}));

/**
 * Individual session tab component
 */
const SessionTab = React.memo(({
    session,
    isActive,
    onPress
}: {
    session: Session;
    isActive: boolean;
    onPress: () => void;
}) => {
    const styles = stylesheet;
    const sessionStatus = useSessionStatus(session);
    const sessionName = getSessionName(session);

    return (
        <Pressable
            style={[
                styles.tab,
                isActive && styles.tabActive
            ]}
            onPress={onPress}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            accessibilityRole="tab"
            accessibilityLabel={`${sessionName}, ${sessionStatus.statusText}`}
            accessibilityState={{ selected: isActive }}
        >
            <View style={styles.statusDot}>
                <StatusDot
                    color={isActive ? '#fff' : sessionStatus.statusDotColor}
                    isPulsing={sessionStatus.isPulsing && !isActive}
                    size={8}
                />
            </View>
            <Text
                style={[
                    styles.tabText,
                    isActive && styles.tabTextActive,
                    !sessionStatus.isConnected && !isActive && styles.tabTextInactive
                ]}
                numberOfLines={1}
            >
                {sessionName}
            </Text>
        </Pressable>
    );
});

/**
 * SessionTabs - Horizontal scrollable tab bar for active sessions
 *
 * Only renders when 2 or more active sessions exist.
 * Provides quick session switching without going back to the sessions list.
 */
export const SessionTabs = React.memo(({ currentSessionId }: SessionTabsProps) => {
    const styles = stylesheet;
    const navigateToSession = useNavigateToSession();
    const allSessions = useAllSessions();
    const scrollViewRef = React.useRef<ScrollView>(null);

    // Filter to only active sessions and sort by updatedAt
    const activeSessions = React.useMemo(() => {
        return allSessions
            .filter(session => session.active)
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }, [allSessions]);

    // Don't render if less than 2 active sessions
    if (activeSessions.length < 2) {
        return null;
    }

    // Find index of current session for auto-scrolling
    const currentIndex = activeSessions.findIndex(s => s.id === currentSessionId);

    // Auto-scroll to show current session tab (on mount and when currentSessionId changes)
    React.useEffect(() => {
        if (scrollViewRef.current && currentIndex !== -1) {
            // Estimate tab width (including gap) - average around 100px per tab
            const estimatedTabWidth = 100;
            const scrollX = Math.max(0, (currentIndex * estimatedTabWidth) - 50);
            scrollViewRef.current.scrollTo({ x: scrollX, animated: true });
        }
    }, [currentSessionId, currentIndex]);

    return (
        <View style={styles.container}>
            <ScrollView
                ref={scrollViewRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
            >
                {activeSessions.map((session) => (
                    <SessionTab
                        key={session.id}
                        session={session}
                        isActive={session.id === currentSessionId}
                        onPress={() => {
                            if (session.id !== currentSessionId) {
                                navigateToSession(session.id);
                            }
                        }}
                    />
                ))}
            </ScrollView>
        </View>
    );
});
