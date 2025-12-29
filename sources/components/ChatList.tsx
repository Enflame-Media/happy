import * as React from 'react';
import { useSession, useSessionMessages } from "@/sync/storage";
import { FlatList, Platform, View, ActivityIndicator, StyleSheet } from 'react-native';
import { useCallback, useRef } from 'react';
import { useHeaderHeight } from '@/utils/responsive';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MessageView } from './MessageView';
import { Metadata, Session } from '@/sync/storageTypes';
import { ChatFooter } from './ChatFooter';
import { Message } from '@/sync/typesMessage';
import { useScrollPerformance } from '@/utils/performance';
import { sync } from '@/sync/sync';
import { useUnistyles } from 'react-native-unistyles';

export const ChatList = React.memo((props: { session: Session }) => {
    const { messages, hasOlderMessages, isLoadingOlder } = useSessionMessages(props.session.id);
    return (
        <ChatListInternal
            metadata={props.session.metadata}
            sessionId={props.session.id}
            messages={messages}
            hasOlderMessages={hasOlderMessages}
            isLoadingOlder={isLoadingOlder}
        />
    )
});

const ListHeader = React.memo(() => {
    const headerHeight = useHeaderHeight();
    const safeArea = useSafeAreaInsets();
    return <View style={{ flexDirection: 'row', alignItems: 'center', height: headerHeight + safeArea.top + 32 }} />;
});

const ListFooter = React.memo((props: { sessionId: string }) => {
    const session = useSession(props.sessionId);
    if (!session) return null;
    return (
        <ChatFooter controlledByUser={session.agentState?.controlledByUser || false} />
    )
});

/**
 * HAP-648: Loading indicator shown at top of message list while fetching older messages
 * Displayed when scrolling up to load more history
 */
const OlderMessagesLoader = React.memo((props: { isLoading: boolean; hasMore: boolean }) => {
    const { theme } = useUnistyles();

    // Only show if loading or if there are more messages to load
    if (!props.isLoading && !props.hasMore) return null;

    return (
        <View style={styles.loaderContainer}>
            {props.isLoading ? (
                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
            ) : (
                // Placeholder height to prevent layout shift when loading starts
                <View style={styles.loaderPlaceholder} />
            )}
        </View>
    );
});

const ChatListInternal = React.memo((props: {
    metadata: Metadata | null,
    sessionId: string,
    messages: Message[],
    hasOlderMessages: boolean,
    isLoadingOlder: boolean,
}) => {
    const keyExtractor = useCallback((item: Message) => item.id, []);
    const renderItem = useCallback(({ item }: { item: Message }) => (
        <MessageView message={item} metadata={props.metadata} sessionId={props.sessionId} />
    ), [props.metadata, props.sessionId]);

    // Scroll performance monitoring (HAP-380)
    const onScrollPerformance = useScrollPerformance('ChatList');

    // HAP-648: Track if we're currently fetching to prevent duplicate requests
    const isFetchingRef = useRef(false);

    /**
     * HAP-648: Load older messages when user scrolls to the top
     * With inverted={true}, onEndReached fires when scrolling up (towards older messages)
     */
    const handleEndReached = useCallback(() => {
        // Prevent duplicate fetches
        if (isFetchingRef.current || props.isLoadingOlder || !props.hasOlderMessages) {
            return;
        }

        isFetchingRef.current = true;
        sync.loadOlderMessages(props.sessionId).finally(() => {
            isFetchingRef.current = false;
        });
    }, [props.sessionId, props.isLoadingOlder, props.hasOlderMessages]);

    return (
        <FlatList
            data={props.messages}
            inverted={true}
            initialNumToRender={15}
            maxToRenderPerBatch={10}
            windowSize={10}
            removeClippedSubviews={Platform.OS !== 'web'}
            keyExtractor={keyExtractor}
            maintainVisibleContentPosition={{
                minIndexForVisible: 0,
                autoscrollToTopThreshold: 10,
            }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
            renderItem={renderItem}
            ListHeaderComponent={<ListFooter sessionId={props.sessionId} />}
            ListFooterComponent={
                <>
                    <OlderMessagesLoader
                        isLoading={props.isLoadingOlder}
                        hasMore={props.hasOlderMessages}
                    />
                    <ListHeader />
                </>
            }
            onScroll={onScrollPerformance}
            scrollEventThrottle={16}
            // HAP-648: Trigger loading older messages when scrolling to top
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.5}
        />
    )
});

const styles = StyleSheet.create({
    loaderContainer: {
        paddingVertical: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    loaderPlaceholder: {
        height: 20, // Match ActivityIndicator small size
    },
});
