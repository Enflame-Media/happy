import * as React from 'react';
import { View, Text } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { StatusDot } from '../StatusDot';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { StatusDisplayProps } from './types';
import { stylesheet } from './styles';

/**
 * StatusDisplay component shows connection status, context warning, and permission mode
 * in the status bar above the input panel.
 */
export const StatusDisplay = React.memo(function StatusDisplay({
    connectionStatus,
    contextWarning,
    permissionMode,
    isCodex,
}: StatusDisplayProps) {
    const styles = stylesheet;
    const { theme } = useUnistyles();

    // Don't render if nothing to show
    if (!connectionStatus && !contextWarning && !permissionMode) {
        return null;
    }

    // Determine permission mode color
    const getPermissionColor = () => {
        if (!permissionMode) return theme.colors.textSecondary;

        switch (permissionMode) {
            case 'acceptEdits':
                return theme.colors.permission.acceptEdits;
            case 'bypassPermissions':
                return theme.colors.permission.bypass;
            case 'plan':
                return theme.colors.permission.plan;
            case 'read-only':
                return theme.colors.permission.readOnly;
            case 'safe-yolo':
                return theme.colors.permission.safeYolo;
            case 'yolo':
                return theme.colors.permission.yolo;
            default:
                return theme.colors.textSecondary;
        }
    };

    // Get permission mode label
    const getPermissionLabel = () => {
        if (!permissionMode) return '';

        if (isCodex) {
            switch (permissionMode) {
                case 'default':
                    return t('agentInput.codexPermissionMode.default');
                case 'read-only':
                    return t('agentInput.codexPermissionMode.badgeReadOnly');
                case 'safe-yolo':
                    return t('agentInput.codexPermissionMode.badgeSafeYolo');
                case 'yolo':
                    return t('agentInput.codexPermissionMode.badgeYolo');
                default:
                    return '';
            }
        } else {
            switch (permissionMode) {
                case 'default':
                    return t('agentInput.permissionMode.default');
                case 'acceptEdits':
                    return t('agentInput.permissionMode.badgeAcceptAllEdits');
                case 'bypassPermissions':
                    return t('agentInput.permissionMode.badgeBypassAllPermissions');
                case 'plan':
                    return t('agentInput.permissionMode.badgePlanMode');
                default:
                    return '';
            }
        }
    };

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
                {permissionMode && (
                    <Text style={{
                        fontSize: 11,
                        color: getPermissionColor(),
                        ...Typography.default()
                    }}>
                        {getPermissionLabel()}
                    </Text>
                )}
            </View>
        </View>
    );
});
