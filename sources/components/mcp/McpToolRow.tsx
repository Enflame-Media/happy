import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from '@/components/StyledText';
import { useUnistyles } from 'react-native-unistyles';

/**
 * Props for the MCP Tool row component
 */
export interface McpToolRowProps {
    /** Tool name (unique identifier from MCP) */
    name: string;
    /** Optional description of what the tool does */
    description?: string;
    /** Whether the tool is disabled (not available for use) */
    disabled: boolean;
    /** Whether the row is read-only (no toggle control) */
    readOnly?: boolean;
    /** Callback when tool enable/disable state changes (for future Phase 2) */
    onToggle?: (enabled: boolean) => void;
}

/**
 * Displays a single MCP tool with its name, description, and status.
 *
 * Phase 1: Read-only display showing:
 * - Tool name
 * - Tool description (if available)
 * - Enabled/disabled status via colored dot
 *
 * Phase 2 will add:
 * - Switch control for enabling/disabling tools
 */
export function McpToolRow({
    name,
    description,
    disabled,
    readOnly: _readOnly = true,
    onToggle: _onToggle,
}: McpToolRowProps) {
    const { theme } = useUnistyles();

    return (
        <View style={[styles.row, { backgroundColor: theme.colors.surface }]}>
            <View style={styles.info}>
                <Text
                    style={[
                        styles.name,
                        { color: disabled ? theme.colors.textSecondary : theme.colors.text }
                    ]}
                >
                    {name}
                </Text>
                {description && (
                    <Text
                        style={[styles.description, { color: theme.colors.textSecondary }]}
                        numberOfLines={2}
                    >
                        {description}
                    </Text>
                )}
            </View>

            {/* Phase 2: Add Switch control here when !readOnly */}

            {/* Status indicator dot */}
            <View
                style={[
                    styles.statusDot,
                    {
                        backgroundColor: disabled
                            ? theme.colors.status.disconnected
                            : theme.colors.status.connected
                    }
                ]}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: 'rgba(0,0,0,0.1)',
    },
    info: {
        flex: 1,
        marginRight: 12,
    },
    name: {
        fontSize: 15,
        fontWeight: '500',
    },
    description: {
        fontSize: 13,
        marginTop: 4,
        lineHeight: 18,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
});
