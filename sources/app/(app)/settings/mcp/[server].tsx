import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text } from '@/components/StyledText';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAllMachines } from '@/sync/storage';
import { isMachineOnline } from '@/utils/machineUtils';
import { McpToolRow } from '@/components/mcp/McpToolRow';
import { McpServerConfig } from '@/components/mcp/McpServerCard';
import { t } from '@/text';

/**
 * Tool definition from MCP server validation
 * This is the expected structure from CLI sync (Phase 2+)
 */
interface McpTool {
    name: string;
    description?: string;
}

/**
 * Extended MCP state that may include tools per server
 */
interface McpStateWithTools {
    servers: Record<string, McpServerConfig>;
    tools?: Record<string, McpTool[]>;
}

/**
 * MCP Server Detail Screen
 *
 * Displays the tools available from a specific MCP server.
 * Navigated to from the MCP Settings screen by tapping a server card.
 *
 * Phase 1 Features:
 * - Shows server name and tool count
 * - Lists all tools with their descriptions
 * - Shows enabled/disabled status for each tool
 * - Read-only (no toggle controls)
 *
 * Phase 2 will add:
 * - Toggle controls for enabling/disabling individual tools
 */
export default function McpServerDetailScreen() {
    const { theme } = useUnistyles();
    const { server } = useLocalSearchParams<{ server: string }>();
    const allMachines = useAllMachines();

    // Decode the server name (it may be URL-encoded)
    const serverName = server ? decodeURIComponent(server) : '';

    // Find the first online machine that has this server configured
    const onlineMachines = allMachines.filter(isMachineOnline);

    // Look for MCP config containing this server
    let mcpState: McpStateWithTools | null = null;
    let serverConfig: McpServerConfig | null = null;

    for (const machine of onlineMachines) {
        const state = machine.daemonState?.mcpConfig as McpStateWithTools | undefined;
        if (state?.servers?.[serverName]) {
            mcpState = state;
            serverConfig = state.servers[serverName];
            break;
        }
    }

    // Get tools for this server (may be undefined until CLI syncs tool details)
    const tools = mcpState?.tools?.[serverName] ?? [];
    const disabledTools = serverConfig?.disabledTools ?? [];

    // Server not found
    if (!serverConfig) {
        return (
            <>
                <Stack.Screen options={{ title: serverName || t('settingsMcp.title') }} />
                <View style={[styles.container, styles.centered, { backgroundColor: theme.colors.surface }]}>
                    <Ionicons
                        name="alert-circle-outline"
                        size={64}
                        color={theme.colors.textSecondary}
                    />
                    <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>
                        {t('settingsMcp.serverNotFound')}
                    </Text>
                    <Text style={[styles.emptyMessage, { color: theme.colors.textSecondary }]}>
                        {t('settingsMcp.serverNotFoundDescription')}
                    </Text>
                </View>
            </>
        );
    }

    // Server found but no tools data synced yet
    if (tools.length === 0) {
        return (
            <>
                <Stack.Screen options={{ title: serverName }} />
                <View style={[styles.container, styles.centered, { backgroundColor: theme.colors.surface }]}>
                    <Ionicons
                        name="construct-outline"
                        size={64}
                        color={theme.colors.textSecondary}
                    />
                    <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>
                        {t('settingsMcp.noTools')}
                    </Text>
                    <Text style={[styles.emptyMessage, { color: theme.colors.textSecondary }]}>
                        {t('settingsMcp.noToolsDescription')}
                    </Text>
                    {serverConfig.toolCount !== undefined && serverConfig.toolCount > 0 && (
                        <Text style={[styles.toolCountNote, { color: theme.colors.textSecondary }]}>
                            {t('settingsMcp.toolCountNote', { count: serverConfig.toolCount })}
                        </Text>
                    )}
                </View>
            </>
        );
    }

    // Display tools list
    return (
        <>
            <Stack.Screen options={{ title: serverName }} />
            <ScrollView
                style={[styles.container, { backgroundColor: theme.colors.surface }]}
                contentContainerStyle={styles.scrollContent}
            >
                <View style={styles.header}>
                    <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                        {t('settingsMcp.toolsAvailable', { count: tools.length })}
                    </Text>
                </View>

                <View style={[styles.toolsList, { backgroundColor: theme.colors.groupped?.background ?? theme.colors.surface }]}>
                    {tools.map((tool) => (
                        <McpToolRow
                            key={tool.name}
                            name={tool.name}
                            description={tool.description}
                            disabled={disabledTools.includes(tool.name)}
                            readOnly={true}
                        />
                    ))}
                </View>

                <View style={styles.footer}>
                    <Text style={[styles.footerText, { color: theme.colors.textSecondary }]}>
                        {t('settingsMcp.toolsReadOnlyNote')}
                    </Text>
                </View>
            </ScrollView>
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    centered: {
        justifyContent: 'center',
        alignItems: 'center',
        padding: 32,
    },
    scrollContent: {
        paddingTop: 16,
        paddingBottom: 32,
    },
    header: {
        paddingHorizontal: 16,
        marginBottom: 16,
    },
    subtitle: {
        fontSize: 14,
        textAlign: 'center',
    },
    toolsList: {
        marginHorizontal: 16,
        borderRadius: 12,
        overflow: 'hidden',
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '600',
        marginTop: 16,
        marginBottom: 8,
        textAlign: 'center',
    },
    emptyMessage: {
        fontSize: 14,
        textAlign: 'center',
        maxWidth: 280,
        lineHeight: 20,
    },
    toolCountNote: {
        fontSize: 13,
        marginTop: 16,
        fontStyle: 'italic',
    },
    footer: {
        paddingHorizontal: 32,
        paddingTop: 16,
    },
    footerText: {
        fontSize: 12,
        textAlign: 'center',
        lineHeight: 18,
    },
});
