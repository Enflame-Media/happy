import * as React from 'react';
import { ActivityIndicator, View, Text, ScrollView } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Switch } from '@/components/Switch';
import { Modal } from '@/modal';
import { useUnistyles, StyleSheet } from 'react-native-unistyles';
import { useLocalSettingMutable } from '@/sync/storage';
import {
    setRemoteLoggingEnabled,
    isRemoteLoggingEnabled,
    getRemoteLoggingStatus,
    getLogBufferStats,
    getLogBuffer,
    clearLogBuffer,
    type LogBufferEntry,
} from '@/utils/remoteLogger';

/**
 * HAP-842: Remote Logging Settings Screen
 *
 * Developer-only screen for controlling remote logging at runtime.
 * Allows toggling remote logging on/off and viewing/clearing the log buffer.
 */
function RemoteLoggingScreen() {
    const { theme } = useUnistyles();
    const [remoteLoggingSettingEnabled, setRemoteLoggingSettingEnabled] = useLocalSettingMutable('remoteLoggingEnabled');

    // Local state for status display
    const [status, setStatus] = React.useState(getRemoteLoggingStatus());
    const [bufferStats, setBufferStats] = React.useState(getLogBufferStats());
    const [refreshKey, setRefreshKey] = React.useState(0);

    // Sync the local setting with the runtime toggle
    React.useEffect(() => {
        setRemoteLoggingEnabled(remoteLoggingSettingEnabled);
    }, [remoteLoggingSettingEnabled]);

    // Refresh status periodically
    React.useEffect(() => {
        const interval = setInterval(() => {
            setStatus(getRemoteLoggingStatus());
            setBufferStats(getLogBufferStats());
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    const handleToggle = (enabled: boolean) => {
        setRemoteLoggingSettingEnabled(enabled);
        setStatus(getRemoteLoggingStatus());
    };

    const handleClearBuffer = async () => {
        const confirmed = await Modal.confirm(
            'Clear Log Buffer',
            `Are you sure you want to clear ${bufferStats.count} log entries?`,
            { confirmText: 'Clear', destructive: true }
        );
        if (confirmed) {
            clearLogBuffer();
            setBufferStats(getLogBufferStats());
            setRefreshKey(prev => prev + 1);
        }
    };

    const handleViewLogs = async () => {
        const logs = getLogBuffer();
        if (logs.length === 0) {
            Modal.alert('No Logs', 'The log buffer is empty.');
            return;
        }

        // Show last 50 logs in a modal
        const recentLogs = logs.slice(-50);
        const logText = recentLogs
            .map((entry: LogBufferEntry) => {
                const time = new Date(entry.timestamp).toLocaleTimeString();
                const level = entry.level.toUpperCase().padEnd(5);
                const message = entry.message
                    .map(m => typeof m === 'object' ? JSON.stringify(m) : String(m))
                    .join(' ');
                return `[${time}] ${level} ${message}`;
            })
            .join('\n');

        Modal.alert(
            `Recent Logs (${recentLogs.length}/${logs.length})`,
            logText
        );
    };

    const formatBytes = (bytes: number): string => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    // Status indicator
    const StatusIndicator = () => {
        if (status.active) {
            return <Ionicons name="checkmark-circle" size={22} color="#34C759" />;
        } else if (status.enabled && !status.active) {
            return <ActivityIndicator size="small" color={theme.colors.textSecondary} />;
        } else {
            return <Ionicons name="close-circle" size={22} color="#8E8E93" />;
        }
    };

    return (
        <ItemList>
            {/* Status */}
            <ItemGroup title="Remote Logging Status" footer={status.reason}>
                <Item
                    title="Remote Logging"
                    subtitle={status.active ? 'Sending logs to server' : 'Logs buffered locally only'}
                    rightElement={
                        <Switch
                            value={remoteLoggingSettingEnabled}
                            onValueChange={handleToggle}
                            accessibilityLabel="Toggle remote logging"
                            accessibilityHint="Enables or disables sending logs to the remote server"
                        />
                    }
                    showChevron={false}
                />
                <Item
                    title="Status"
                    detail={status.active ? 'Active' : status.enabled ? 'Pending' : 'Disabled'}
                    rightElement={<StatusIndicator />}
                    showChevron={false}
                />
                {status.serverUrl && (
                    <Item
                        title="Server URL"
                        detail={status.serverUrl}
                        showChevron={false}
                    />
                )}
            </ItemGroup>

            {/* Log Buffer */}
            <ItemGroup
                title="Log Buffer"
                footer={`Buffer stores up to ${bufferStats.maxCount} entries or ${formatBytes(bufferStats.maxSizeBytes)}`}
            >
                <Item
                    title="Entries"
                    detail={`${bufferStats.count} / ${bufferStats.maxCount}`}
                    showChevron={false}
                />
                <Item
                    title="Size"
                    detail={`${formatBytes(bufferStats.sizeBytes)} / ${formatBytes(bufferStats.maxSizeBytes)}`}
                    showChevron={false}
                />
                <Item
                    title="View Recent Logs"
                    icon={<Ionicons name="document-text-outline" size={28} color="#007AFF" />}
                    onPress={handleViewLogs}
                />
                <Item
                    title="Clear Buffer"
                    icon={<Ionicons name="trash-outline" size={28} color="#FF3B30" />}
                    destructive={true}
                    onPress={handleClearBuffer}
                />
            </ItemGroup>

            {/* Info */}
            <ItemGroup title="Information">
                <Item
                    title="How It Works"
                    subtitle="When enabled, console logs are sent to the configured dev server for AI debugging. Logs are always buffered locally regardless of this setting."
                    showChevron={false}
                />
                <Item
                    title="Security"
                    subtitle="Remote logging only works in __DEV__ mode and only to localhost or private network addresses. Sensitive data is automatically redacted."
                    showChevron={false}
                />
            </ItemGroup>
        </ItemList>
    );
}

export default React.memo(RemoteLoggingScreen);
