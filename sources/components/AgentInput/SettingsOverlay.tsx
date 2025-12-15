import * as React from 'react';
import { View, Text, TouchableWithoutFeedback, Pressable } from 'react-native';
import { FloatingOverlay } from '../FloatingOverlay';
import { PermissionMode, ModelMode } from '../PermissionModeSelector';
import { hapticsLight } from '../haptics';
import { t } from '@/text';
import { SettingsOverlayProps } from './types';
import { stylesheet } from './styles';

/**
 * SettingsOverlay component displays the permission mode and model selection overlay.
 */
export const SettingsOverlay = React.memo(function SettingsOverlay({
    visible,
    onClose,
    isCodex,
    permissionMode,
    onPermissionModeChange,
    modelMode,
    onModelModeChange,
    screenWidth,
}: SettingsOverlayProps) {
    const styles = stylesheet;

    // Handle permission mode selection
    const handlePermissionSelect = React.useCallback((mode: PermissionMode) => {
        hapticsLight();
        onPermissionModeChange?.(mode);
        // Don't close the settings overlay - let users see the change and potentially switch again
    }, [onPermissionModeChange]);

    // Handle model selection
    const handleModelSelect = React.useCallback((mode: ModelMode) => {
        hapticsLight();
        onModelModeChange?.(mode);
        // Don't close the settings overlay - let users see the change and potentially switch again
    }, [onModelModeChange]);

    if (!visible) {
        return null;
    }

    // Permission modes configuration
    const permissionModes = isCodex
        ? (['default', 'read-only', 'safe-yolo', 'yolo'] as const)
        : (['default', 'acceptEdits', 'plan', 'bypassPermissions'] as const);

    const permissionModeConfig = isCodex ? {
        'default': { label: t('agentInput.codexPermissionMode.default') },
        'read-only': { label: t('agentInput.codexPermissionMode.readOnly') },
        'safe-yolo': { label: t('agentInput.codexPermissionMode.safeYolo') },
        'yolo': { label: t('agentInput.codexPermissionMode.yolo') },
    } : {
        default: { label: t('agentInput.permissionMode.default') },
        acceptEdits: { label: t('agentInput.permissionMode.acceptEdits') },
        plan: { label: t('agentInput.permissionMode.plan') },
        bypassPermissions: { label: t('agentInput.permissionMode.bypassPermissions') },
    };

    // Model modes configuration
    const modelModes = isCodex
        ? (['gpt-5-codex-high', 'gpt-5-codex-medium', 'gpt-5-codex-low', 'gpt-5-minimal', 'gpt-5-low', 'gpt-5-medium', 'gpt-5-high'] as const)
        : (['opus', 'sonnet', 'haiku'] as const);

    const modelModeConfig = isCodex ? {
        'gpt-5-codex-high': { label: t('agentInput.codexModel.gpt5CodexHigh') },
        'gpt-5-codex-medium': { label: t('agentInput.codexModel.gpt5CodexMedium') },
        'gpt-5-codex-low': { label: t('agentInput.codexModel.gpt5CodexLow') },
        'gpt-5-minimal': { label: t('agentInput.codexModel.gpt5Minimal') },
        'gpt-5-low': { label: t('agentInput.codexModel.gpt5Low') },
        'gpt-5-medium': { label: t('agentInput.codexModel.gpt5Medium') },
        'gpt-5-high': { label: t('agentInput.codexModel.gpt5High') },
    } : {
        opus: { label: t('agentInput.model.opus') },
        sonnet: { label: t('agentInput.model.sonnet') },
        haiku: { label: t('agentInput.model.haiku') },
    };

    const defaultModel = isCodex ? 'gpt-5-codex-high' : 'opus';

    return (
        <>
            <TouchableWithoutFeedback onPress={onClose}>
                <View style={styles.overlayBackdrop} />
            </TouchableWithoutFeedback>
            <View style={[
                styles.settingsOverlay,
                { paddingHorizontal: screenWidth > 700 ? 0 : 8 }
            ]}>
                <FloatingOverlay maxHeight={280} keyboardShouldPersistTaps="always">
                    {/* Permission Mode Section */}
                    <View style={styles.overlaySection}>
                        <Text style={styles.overlaySectionTitle}>
                            {isCodex ? t('agentInput.codexPermissionMode.title') : t('agentInput.permissionMode.title')}
                        </Text>
                        {permissionModes.map((mode) => {
                            const config = permissionModeConfig[mode as keyof typeof permissionModeConfig];
                            if (!config) return null;
                            const isSelected = permissionMode === mode;

                            return (
                                <Pressable
                                    key={mode}
                                    onPress={() => handlePermissionSelect(mode)}
                                    style={({ pressed }) => [
                                        styles.selectionItem,
                                        pressed && styles.selectionItemPressed
                                    ]}
                                >
                                    <View style={[
                                        styles.radioButton,
                                        isSelected ? styles.radioButtonActive : styles.radioButtonInactive
                                    ]}>
                                        {isSelected && (
                                            <View style={styles.radioButtonDot} />
                                        )}
                                    </View>
                                    <Text style={[
                                        styles.selectionLabel,
                                        isSelected ? styles.selectionLabelActive : styles.selectionLabelInactive
                                    ]}>
                                        {config.label}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>

                    {/* Divider */}
                    <View style={styles.overlayDivider} />

                    {/* Model Section */}
                    <View style={styles.overlaySection}>
                        <Text style={styles.modelSectionTitle}>
                            {isCodex ? t('agentInput.codexModel.title') : t('agentInput.model.title')}
                        </Text>
                        {modelModes.map((model) => {
                            const config = modelModeConfig[model as keyof typeof modelModeConfig];
                            if (!config) return null;
                            const isSelected = modelMode === model || (!modelMode && model === defaultModel);

                            return (
                                <Pressable
                                    key={model}
                                    onPress={() => handleModelSelect(model)}
                                    style={({ pressed }) => [
                                        styles.selectionItem,
                                        pressed && styles.selectionItemPressed
                                    ]}
                                >
                                    <View style={[
                                        styles.radioButton,
                                        isSelected ? styles.radioButtonActive : styles.radioButtonInactive
                                    ]}>
                                        {isSelected && (
                                            <View style={styles.radioButtonDot} />
                                        )}
                                    </View>
                                    <Text style={[
                                        styles.selectionLabel,
                                        isSelected ? styles.selectionLabelActive : styles.selectionLabelInactive
                                    ]}>
                                        {config.label}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                </FloatingOverlay>
            </View>
        </>
    );
});
