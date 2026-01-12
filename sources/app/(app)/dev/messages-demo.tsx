import * as React from 'react';
import { FlatList, View, Text } from 'react-native';
import { MessageView } from '@/components/MessageView';
import { Message } from '@/sync/typesMessage';
import { useDemoMessages } from '@/hooks/useDemoMessages';

// HAP-844: Demo data is moved to sources/trash which is excluded from production bundles.
// Use dynamic import with __DEV__ guard to prevent production errors.
let debugMessages: Message[] = [];
if (__DEV__) {
    // Dynamic require in dev mode - this path is blocked by metro in production
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        debugMessages = require('@/trash/messages-demo-data').debugMessages;
    } catch {
        // Fallback if the file is not available (shouldn't happen in dev)
        debugMessages = [];
    }
}

function MessagesDemoScreen() {
    // Combine all demo messages
    const allMessages = [...debugMessages];

    // Load demo messages into session storage
    const sessionId = useDemoMessages(allMessages);

    // Show message if no demo data available (production build)
    if (allMessages.length === 0) {
        return (
            <View style={{ flex: 1, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
                <Text style={{ fontSize: 16, color: '#666', textAlign: 'center' }}>
                    Demo data is only available in development builds.
                </Text>
            </View>
        );
    }

    return (
        <View style={{ flex: 1, backgroundColor: '#fff' }}>
            {allMessages.length > 0 && (
                <FlatList
                    data={allMessages}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item }) => (
                        <MessageView
                            message={item}
                            metadata={null}
                            sessionId={sessionId}
                            getMessageById={(id: string): Message | null => {
                                return allMessages.find((m)=>m.id === id) || null;
                            }}
                        />
                    )}
                    style={{ flexGrow: 1, flexBasis: 0 }}
                    contentContainerStyle={{ paddingVertical: 20 }}
                />
            )}
        </View>
    );
}

export default React.memo(MessagesDemoScreen);
