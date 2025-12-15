import Ionicons from '@expo/vector-icons/Ionicons';
import Octicons from '@expo/vector-icons/Octicons';
import * as React from 'react';
import { View, Text, ActivityIndicator, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useUnistyles } from 'react-native-unistyles';
import { Shaker, ShakeInstance } from '../Shaker';
import { GitStatusBadge, useHasMeaningfulGitStatus } from '../GitStatusBadge';
import { hapticsLight } from '../haptics';
import { t } from '@/text';
import { ActionButtonsProps } from './types';
import { stylesheet, actionButtonHitSlop, sendButtonIconPlatformStyle } from './styles';

/**
 * GitStatusButton - Internal component for git status display
 */
const GitStatusButton = React.memo(function GitStatusButton({
    sessionId,
    onPress
}: {
    sessionId?: string;
    onPress?: () => void;
}) {
    const hasMeaningfulGitStatus = useHasMeaningfulGitStatus(sessionId || '');
    const styles = stylesheet;

    if (!sessionId || !onPress) {
        return null;
    }

    return (
        <Pressable
            style={({ pressed }) => [
                styles.gitStatusButton,
                pressed && styles.actionButtonPressed
            ]}
            hitSlop={actionButtonHitSlop}
            onPress={() => {
                hapticsLight();
                onPress?.();
            }}
        >
            {hasMeaningfulGitStatus ? (
                <GitStatusBadge sessionId={sessionId} />
            ) : (
                <Octicons
                    name="git-branch"
                    size={16}
                    style={styles.actionButtonIcon}
                />
            )}
        </Pressable>
    );
});

/**
 * ActionButtons component contains all action buttons for the AgentInput:
 * - Settings button
 * - Agent selector button
 * - Machine selector button
 * - Path selector button
 * - Abort button
 * - Git status button
 * - Send/Voice button
 */
export const ActionButtons = React.memo(React.forwardRef<ShakeInstance, ActionButtonsProps>(
    function ActionButtons({
        onSettingsPress,
        agentType,
        onAgentClick,
        machineName,
        onMachineClick,
        currentPath,
        onPathClick,
        onAbort,
        isAborting,
        onAbortPress,
        sessionId,
        onFileViewerPress,
        hasText,
        isSending,
        isSendDisabled,
        onSendPress,
        onMicPress,
        isMicActive,
    }, ref) {
        const styles = stylesheet;
        const { theme } = useUnistyles();

        return (
            <View style={styles.actionButtonsContainer}>
                <View style={styles.actionButtonsLeft}>

                    {/* Settings button */}
                    {onSettingsPress && (
                        <Pressable
                            onPress={onSettingsPress}
                            hitSlop={actionButtonHitSlop}
                            style={({ pressed }) => [
                                styles.actionButton,
                                pressed && styles.actionButtonPressed
                            ]}
                        >
                            <Octicons
                                name="gear"
                                size={16}
                                style={styles.actionButtonIcon}
                            />
                        </Pressable>
                    )}

                    {/* Agent selector button */}
                    {agentType && onAgentClick && (
                        <Pressable
                            onPress={() => {
                                hapticsLight();
                                onAgentClick?.();
                            }}
                            hitSlop={actionButtonHitSlop}
                            style={({ pressed }) => [
                                styles.actionButtonWithText,
                                pressed && styles.actionButtonPressed
                            ]}
                        >
                            <Octicons
                                name="cpu"
                                size={14}
                                style={styles.actionButtonIcon}
                            />
                            <Text style={styles.actionButtonText}>
                                {agentType === 'claude' ? t('agentInput.agent.claude') : t('agentInput.agent.codex')}
                            </Text>
                        </Pressable>
                    )}

                    {/* Machine selector button */}
                    {(machineName !== undefined) && onMachineClick && (
                        <Pressable
                            onPress={() => {
                                hapticsLight();
                                onMachineClick?.();
                            }}
                            hitSlop={actionButtonHitSlop}
                            style={({ pressed }) => [
                                styles.actionButtonWithText,
                                pressed && styles.actionButtonPressed
                            ]}
                        >
                            <Ionicons
                                name="desktop-outline"
                                size={14}
                                style={styles.actionButtonIcon}
                            />
                            <Text style={styles.actionButtonText}>
                                {machineName === null ? t('agentInput.noMachinesAvailable') : machineName}
                            </Text>
                        </Pressable>
                    )}

                    {/* Path selector button */}
                    {currentPath && onPathClick && (
                        <Pressable
                            onPress={() => {
                                hapticsLight();
                                onPathClick?.();
                            }}
                            hitSlop={actionButtonHitSlop}
                            style={({ pressed }) => [
                                styles.actionButtonWithText,
                                pressed && styles.actionButtonPressed
                            ]}
                        >
                            <Ionicons
                                name="folder-outline"
                                size={14}
                                style={styles.actionButtonIcon}
                            />
                            <Text style={styles.actionButtonText}>
                                {currentPath}
                            </Text>
                        </Pressable>
                    )}

                    {/* Abort button */}
                    {onAbort && (
                        <Shaker ref={ref}>
                            <Pressable
                                style={({ pressed }) => [
                                    styles.actionButton,
                                    pressed && styles.actionButtonPressed
                                ]}
                                hitSlop={actionButtonHitSlop}
                                onPress={onAbortPress}
                                disabled={isAborting}
                            >
                                {isAborting ? (
                                    <ActivityIndicator
                                        size="small"
                                        color={styles.actionButtonIcon.color}
                                    />
                                ) : (
                                    <Octicons
                                        name="stop"
                                        size={16}
                                        style={styles.actionButtonIcon}
                                    />
                                )}
                            </Pressable>
                        </Shaker>
                    )}

                    {/* Git Status Badge */}
                    <GitStatusButton sessionId={sessionId} onPress={onFileViewerPress} />
                </View>

                {/* Send/Voice button */}
                <View
                    style={[
                        styles.sendButton,
                        (hasText || isSending || (onMicPress && !isMicActive))
                            ? styles.sendButtonActive
                            : styles.sendButtonInactive
                    ]}
                >
                    <Pressable
                        style={({ pressed }) => [
                            styles.sendButtonInner,
                            pressed && styles.sendButtonInnerPressed
                        ]}
                        hitSlop={actionButtonHitSlop}
                        onPress={onSendPress}
                        disabled={isSendDisabled || isSending || (!hasText && !onMicPress)}
                    >
                        {isSending ? (
                            <ActivityIndicator
                                size="small"
                                color={styles.sendButtonIcon.color}
                            />
                        ) : hasText ? (
                            <Octicons
                                name="arrow-up"
                                size={16}
                                style={[
                                    styles.sendButtonIcon,
                                    sendButtonIconPlatformStyle
                                ]}
                            />
                        ) : onMicPress && !isMicActive ? (
                            <Image
                                source={require('@/assets/images/icon-voice-white.png')}
                                style={{ width: 24, height: 24 }}
                                tintColor={theme.colors.button.primary.tint}
                            />
                        ) : (
                            <Octicons
                                name="arrow-up"
                                size={16}
                                style={[
                                    styles.sendButtonIcon,
                                    sendButtonIconPlatformStyle
                                ]}
                            />
                        )}
                    </Pressable>
                </View>
            </View>
        );
    }
));
