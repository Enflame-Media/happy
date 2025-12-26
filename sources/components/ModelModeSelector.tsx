import React from 'react';
import { Pressable, Platform, Text } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { hapticsLight } from './haptics';
import { ModelMode } from './PermissionModeSelector';

interface ModelModeSelectorProps {
    mode: ModelMode;
    onModeChange: (mode: ModelMode) => void;
    disabled?: boolean;
    isCodex?: boolean;
}

// Mode order for Claude Code
const claudeModelOrder: ModelMode[] = ['opus', 'sonnet', 'haiku'];

// Mode order for Codex
const codexModelOrder: ModelMode[] = ['gpt-5-codex-high', 'gpt-5-codex-medium', 'gpt-5-codex-low'];

/**
 * ModelModeSelector - A tappable pill button that displays the current model mode
 * and cycles through available models on tap. Shows a colored border and label.
 */
export const ModelModeSelector: React.FC<ModelModeSelectorProps> = ({
    mode,
    onModeChange,
    disabled = false,
    isCodex = false
}) => {
    const { theme } = useUnistyles();

    // Get the mode order based on agent type
    const activeModelOrder = isCodex ? codexModelOrder : claudeModelOrder;

    // Get the default model for the current agent type
    const defaultModel = isCodex ? 'gpt-5-codex-high' : 'opus';

    // Get color for current model - use a neutral accent color
    const modelColor = theme.colors.textSecondary;

    // Get the label for the current model
    const getModelLabel = () => {
        if (isCodex) {
            switch (mode) {
                case 'gpt-5-codex-high':
                    return t('agentInput.codexModel.gpt5CodexHigh');
                case 'gpt-5-codex-medium':
                    return t('agentInput.codexModel.gpt5CodexMedium');
                case 'gpt-5-codex-low':
                    return t('agentInput.codexModel.gpt5CodexLow');
                case 'gpt-5-high':
                    return t('agentInput.codexModel.gpt5High');
                case 'gpt-5-medium':
                    return t('agentInput.codexModel.gpt5Medium');
                case 'gpt-5-low':
                    return t('agentInput.codexModel.gpt5Low');
                case 'gpt-5-minimal':
                    return t('agentInput.codexModel.gpt5Minimal');
                default:
                    return t('agentInput.codexModel.gpt5CodexHigh');
            }
        } else {
            switch (mode) {
                case 'opus':
                    return t('agentInput.model.opus');
                case 'sonnet':
                    return t('agentInput.model.sonnet');
                case 'haiku':
                    return t('agentInput.model.haiku');
                default:
                    return t('agentInput.model.opus');
            }
        }
    };

    const handleTap = () => {
        if (disabled) return;
        hapticsLight();

        // Ensure mode is valid for the current agent type
        const currentMode = mode || defaultModel;
        const currentIndex = activeModelOrder.indexOf(currentMode);
        // If mode not in order, start from beginning
        const safeIndex = currentIndex === -1 ? 0 : currentIndex;
        const nextIndex = (safeIndex + 1) % activeModelOrder.length;
        onModeChange(activeModelOrder[nextIndex]);
    };

    return (
        <Pressable
            onPress={handleTap}
            disabled={disabled}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`${t('agentInput.model.title')}: ${getModelLabel()}`}
            accessibilityState={{ disabled }}
            style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                borderRadius: Platform.select({ default: 10, android: 12 }),
                paddingHorizontal: 8,
                paddingVertical: 4,
                backgroundColor: pressed ? `${modelColor}22` : 'transparent',
                borderWidth: 1,
                borderColor: modelColor,
                opacity: disabled ? 0.5 : 1,
            })}
        >
            <Text style={{
                fontSize: 11,
                color: modelColor,
                fontWeight: '600',
                ...Typography.default('semiBold')
            }}>
                {getModelLabel()}
            </Text>
        </Pressable>
    );
};
