import * as React from 'react';
import { View, Text } from 'react-native';
import { StatusDot } from '../StatusDot';
import { PermissionModeSelector } from '../PermissionModeSelector';
import { ModelModeSelector } from '../ModelModeSelector';
import { Typography } from '@/constants/Typography';
import { StatusDisplayProps } from './types';
import { stylesheet } from './styles';

/**
 * StatusDisplay component shows connection status, context warning, and permission mode
 * in the status bar above the input panel. The permission mode is now interactive -
 * users can tap to cycle through available modes.
 */
export const StatusDisplay = React.memo(function StatusDisplay({
    connectionStatus,
    contextWarning,
    permissionMode,
    onPermissionModeChange,
    modelMode,
    onModelModeChange,
    isCodex,
}: StatusDisplayProps) {
    const styles = stylesheet;

    // Don't render if nothing to show
    if (!connectionStatus && !contextWarning && !permissionMode && !modelMode) {
        return null;
    }

    return (
        <View style={styles.statusBarContainer}>
            <View style={styles.statusBarLeft}>
                {connectionStatus && (
                    <>
                        <StatusDot
                            color={connectionStatus.dotColor}
                            isPulsing={connectionStatus.isPulsing}
                            size={6}
                            style={{ marginRight: 6 }}
                        />
                        <Text style={{
                            fontSize: 11,
                            color: connectionStatus.color,
                            ...Typography.default()
                        }}>
                            {connectionStatus.text}
                        </Text>
                    </>
                )}
                {contextWarning && (
                    <Text style={{
                        fontSize: 11,
                        color: contextWarning.color,
                        marginLeft: connectionStatus ? 8 : 0,
                        ...Typography.default()
                    }}>
                        {connectionStatus ? '• ' : ''}{contextWarning.text}
                    </Text>
                )}
            </View>
            <View style={styles.statusBarRight}>
                {modelMode && onModelModeChange && (
                    <ModelModeSelector
                        mode={modelMode}
                        onModeChange={onModelModeChange}
                        isCodex={isCodex}
                    />
                )}
                {permissionMode && onPermissionModeChange && (
                    <PermissionModeSelector
                        mode={permissionMode}
                        onModeChange={onPermissionModeChange}
                        isCodex={isCodex}
                    />
                )}
            </View>
        </View>
    );
});
