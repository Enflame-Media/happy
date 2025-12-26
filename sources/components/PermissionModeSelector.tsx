import React from 'react';
import { Pressable, Platform, Text } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { hapticsLight } from './haptics';

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'read-only' | 'safe-yolo' | 'yolo';

export type ModelMode = 'opus' | 'sonnet' | 'haiku' | 'gpt-5-minimal' | 'gpt-5-low' | 'gpt-5-medium' | 'gpt-5-high' | 'gpt-5-codex-low' | 'gpt-5-codex-medium' | 'gpt-5-codex-high';

interface PermissionModeSelectorProps {
    mode: PermissionMode;
    onModeChange: (mode: PermissionMode) => void;
    disabled?: boolean;
    isCodex?: boolean;
}

// Mode order for Claude Code
const claudeModeOrder: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];

// Mode order for Codex
const codexModeOrder: PermissionMode[] = ['default', 'read-only', 'safe-yolo', 'yolo'];

/**
 * PermissionModeSelector - A tappable pill button that displays the current permission mode
 * and cycles through available modes on tap. Shows a colored border and label.
 */
export const PermissionModeSelector: React.FC<PermissionModeSelectorProps> = ({
    mode,
    onModeChange,
    disabled = false,
    isCodex = false
}) => {
    const { theme } = useUnistyles();

    // Get the mode order based on agent type
    const activeModeOrder = isCodex ? codexModeOrder : claudeModeOrder;

    // Get color for current mode
    const getModeColor = () => {
        switch (mode) {
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
                return theme.colors.permission.default;
        }
    };

    // Get the label for the current mode
    const getModeLabel = () => {
        if (isCodex) {
            switch (mode) {
                case 'default':
                    return t('agentInput.codexPermissionMode.default');
                case 'read-only':
                    return t('agentInput.codexPermissionMode.readOnly');
                case 'safe-yolo':
                    return t('agentInput.codexPermissionMode.safeYolo');
                case 'yolo':
                    return t('agentInput.codexPermissionMode.yolo');
                default:
                    return t('agentInput.codexPermissionMode.default');
            }
        } else {
            switch (mode) {
                case 'default':
                    return t('agentInput.permissionMode.default');
                case 'acceptEdits':
                    return t('agentInput.permissionMode.acceptEdits');
                case 'plan':
                    return t('agentInput.permissionMode.plan');
                case 'bypassPermissions':
                    return t('agentInput.permissionMode.bypassPermissions');
                default:
                    return t('agentInput.permissionMode.default');
            }
        }
    };

    const handleTap = () => {
        if (disabled) return;
        hapticsLight();
        const currentIndex = activeModeOrder.indexOf(mode);
        // If mode not in order (e.g. Claude mode on Codex), start from beginning
        const safeIndex = currentIndex === -1 ? 0 : currentIndex;
        const nextIndex = (safeIndex + 1) % activeModeOrder.length;
        onModeChange(activeModeOrder[nextIndex]);
    };

    const modeColor = getModeColor();

    return (
        <Pressable
            onPress={handleTap}
            disabled={disabled}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`${t('agentInput.permissionMode.title')}: ${getModeLabel()}`}
            accessibilityState={{ disabled }}
            style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                borderRadius: Platform.select({ default: 10, android: 12 }),
                paddingHorizontal: 8,
                paddingVertical: 4,
                backgroundColor: pressed ? `${modeColor}22` : 'transparent',
                borderWidth: 1,
                borderColor: modeColor,
                opacity: disabled ? 0.5 : 1,
            })}
        >
            <Text style={{
                fontSize: 11,
                color: modeColor,
                fontWeight: '600',
                ...Typography.default('semiBold')
            }}>
                {getModeLabel()}
            </Text>
        </Pressable>
    );
};
