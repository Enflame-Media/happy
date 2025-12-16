import * as React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useRealtimeStatus } from '@/sync/storage';
import { useVisibleSessionListViewData } from '@/hooks/useVisibleSessionListViewData';
import { useIsTablet } from '@/utils/responsive';
import { EmptySessionsTablet } from './EmptySessionsTablet';
import { ErrorBoundary } from './ErrorBoundary';
import { SessionsList } from './SessionsList';
import { VoiceAssistantStatusBar } from './VoiceAssistantStatusBar';
import { TabBar, TabType } from './TabBar';
import { SettingsViewWrapper } from './SettingsViewWrapper';
import { SessionsListWrapper } from './SessionsListWrapper';
import { ZenHome } from '@/-zen/ZenHome';

interface MainViewProps {
    variant: 'phone' | 'sidebar';
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    phoneContainer: {
        flex: 1,
    },
    sidebarContentContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
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
    tabletLoadingContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
        justifyContent: 'center',
        alignItems: 'center',
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
}));


export const MainView = React.memo(({ variant }: MainViewProps) => {
    const { theme } = useUnistyles();
    const sessionListViewData = useVisibleSessionListViewData();
    const isTablet = useIsTablet();
    const realtimeStatus = useRealtimeStatus();

    // Tab state management - always call hooks even if not used
    // Sessions is always the default tab
    const [activeTab, setActiveTab] = React.useState<TabType>('sessions');

    const handleTabPress = React.useCallback((tab: TabType) => {
        setActiveTab(tab);
    }, []);

    // Regular phone mode with tabs - define this before any conditional returns
    // Each tab content is wrapped in an ErrorBoundary for graceful error handling
    const renderTabContent = React.useCallback(() => {
        switch (activeTab) {
            case 'zen':
                return (
                    <ErrorBoundary name="ZenHome">
                        <ZenHome />
                    </ErrorBoundary>
                );
            case 'settings':
                return (
                    <ErrorBoundary name="Settings">
                        <SettingsViewWrapper />
                    </ErrorBoundary>
                );
            case 'sessions':
            default:
                return (
                    <ErrorBoundary name="Sessions">
                        <SessionsListWrapper />
                    </ErrorBoundary>
                );
        }
    }, [activeTab]);

    // Sidebar variant
    if (variant === 'sidebar') {
        // Loading state
        if (sessionListViewData === null) {
            return (
                <View style={styles.sidebarContentContainer}>
                    <View style={styles.tabletLoadingContainer}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    </View>
                </View>
            );
        }

        // Empty state
        if (sessionListViewData.length === 0) {
            return (
                <View style={styles.sidebarContentContainer}>
                    <View style={styles.emptyStateContainer}>
                        <ErrorBoundary name="EmptySessionsTablet">
                            <EmptySessionsTablet />
                        </ErrorBoundary>
                    </View>
                </View>
            );
        }

        // Sessions list
        return (
            <View style={styles.sidebarContentContainer}>
                <ErrorBoundary name="SessionsList">
                    <SessionsList />
                </ErrorBoundary>
            </View>
        );
    }

    // Phone variant
    // Tablet in phone mode - special case (when showing index view on tablets, show empty view)
    if (isTablet) {
        // Just show an empty view on tablets for the index view
        // The sessions list is shown in the sidebar, so the main area should be blank
        return <View style={styles.emptyStateContentContainer} />;
    }

    // Regular phone mode with tabs
    return (
        <>
            {realtimeStatus !== 'disconnected' && (
                <VoiceAssistantStatusBar variant="full" />
            )}
            <View style={styles.phoneContainer}>
                {renderTabContent()}
            </View>
            <TabBar
                activeTab={activeTab}
                onTabPress={handleTabPress}
            />
        </>
    );
});
