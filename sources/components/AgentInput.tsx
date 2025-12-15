import Ionicons from '@expo/vector-icons/Ionicons';
import Octicons from '@expo/vector-icons/Octicons';
import * as React from 'react';
import { View, Platform, useWindowDimensions, Text, ActivityIndicator, TouchableWithoutFeedback, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { layout } from './layout';
import { MultiTextInput } from './MultiTextInput';
import { Typography } from '@/constants/Typography';
import { PermissionMode, ModelMode } from './PermissionModeSelector';
import { hapticsLight, hapticsError } from './haptics';
import { Shaker, ShakeInstance } from './Shaker';
import { StatusDot } from './StatusDot';
import { useActiveWord } from './autocomplete/useActiveWord';
import { useActiveSuggestions } from './autocomplete/useActiveSuggestions';
import { AgentInputAutocomplete } from './AgentInputAutocomplete';
import { FloatingOverlay } from './FloatingOverlay';
import { TextInputState, MultiTextInputHandle, KeyPressEvent } from './MultiTextInput';
import { applySuggestion } from './autocomplete/applySuggestion';
import { GitStatusBadge, useHasMeaningfulGitStatus } from './GitStatusBadge';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Theme } from '@/theme';
import { t } from '@/text';
import { Metadata } from '@/sync/storageTypes';

interface AgentInputProps {
    value: string;
    placeholder: string;
    onChangeText: (text: string) => void;
    sessionId?: string;
    onSend: () => void;
    sendIcon?: React.ReactNode;
    onMicPress?: () => void;
    isMicActive?: boolean;
    permissionMode?: PermissionMode;
    onPermissionModeChange?: (mode: PermissionMode) => void;
    modelMode?: ModelMode;
    onModelModeChange?: (mode: ModelMode) => void;
    metadata?: Metadata | null;
    onAbort?: () => void | Promise<void>;
    showAbortButton?: boolean;
    connectionStatus?: {
        text: string;
        color: string;
        dotColor: string;
        isPulsing?: boolean;
    };
    autocompletePrefixes: string[];
    autocompleteSuggestions: (query: string) => Promise<{ key: string, text: string, component: React.ElementType }[]>;
    usageData?: {
        inputTokens: number;
        outputTokens: number;
        cacheCreation: number;
        cacheRead: number;
        contextSize: number;
    };
    alwaysShowContextSize?: boolean;
    onFileViewerPress?: () => void;
    agentType?: 'claude' | 'codex';
    onAgentClick?: () => void;
    machineName?: string | null;
    onMachineClick?: () => void;
    currentPath?: string | null;
    onPathClick?: () => void;
    isSendDisabled?: boolean;
    isSending?: boolean;
    minHeight?: number;
}

const MAX_CONTEXT_SIZE = 190000;

// Static hit slop values - defined once, reused across all Pressable components
const actionButtonHitSlop = { top: 5, bottom: 10, left: 0, right: 0 } as const;

// Platform-specific style for send button icon (marginTop adjustment for web)
const sendButtonIconPlatformStyle = Platform.OS === 'web' ? { marginTop: 2 } : undefined;

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        alignItems: 'center',
        paddingBottom: 8,
        paddingTop: 8,
    },
    innerContainer: {
        width: '100%',
        position: 'relative',
    },
    unifiedPanel: {
        backgroundColor: theme.colors.input.background,
        borderRadius: Platform.select({ default: 16, android: 20 }),
        overflow: 'hidden',
        paddingVertical: 2,
        paddingBottom: 8,
        paddingHorizontal: 8,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 0,
        paddingLeft: 8,
        paddingRight: 8,
        paddingVertical: 4,
        minHeight: 40,
    },

    // Overlay styles
    autocompleteOverlay: {
        position: 'absolute',
        bottom: '100%',
        left: 0,
        right: 0,
        marginBottom: 8,
        zIndex: 1000,
    },
    settingsOverlay: {
        position: 'absolute',
        bottom: '100%',
        left: 0,
        right: 0,
        marginBottom: 8,
        zIndex: 1000,
    },
    overlayBackdrop: {
        position: 'absolute',
        top: -1000,
        left: -1000,
        right: -1000,
        bottom: -1000,
        zIndex: 999,
    },
    overlaySection: {
        paddingVertical: 8,
    },
    overlaySectionTitle: {
        fontSize: 12,
        fontWeight: '600',
        color: theme.colors.textSecondary,
        paddingHorizontal: 16,
        paddingBottom: 4,
        ...Typography.default('semiBold'),
    },
    overlayDivider: {
        height: 1,
        backgroundColor: theme.colors.divider,
        marginHorizontal: 16,
    },

    // Selection styles
    selectionItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: 'transparent',
    },
    selectionItemPressed: {
        backgroundColor: theme.colors.surfacePressed,
    },
    radioButton: {
        width: 16,
        height: 16,
        borderRadius: 8,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    radioButtonActive: {
        borderColor: theme.colors.radio.active,
    },
    radioButtonInactive: {
        borderColor: theme.colors.radio.inactive,
    },
    radioButtonDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: theme.colors.radio.dot,
    },
    selectionLabel: {
        fontSize: 14,
        ...Typography.default(),
    },
    selectionLabelActive: {
        color: theme.colors.radio.active,
    },
    selectionLabelInactive: {
        color: theme.colors.text,
    },

    // Status styles
    statusContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingBottom: 4,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    statusText: {
        fontSize: 11,
        ...Typography.default(),
    },
    permissionModeContainer: {
        flexDirection: 'column',
        alignItems: 'flex-end',
    },
    permissionModeText: {
        fontSize: 11,
        ...Typography.default(),
    },
    contextWarningText: {
        fontSize: 11,
        marginLeft: 8,
        ...Typography.default(),
    },

    // Button styles
    actionButtonsContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 0,
    },
    actionButtonsLeft: {
        flexDirection: 'row',
        gap: 8,
        flex: 1,
        overflow: 'hidden',
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: Platform.select({ default: 16, android: 20 }),
        paddingHorizontal: 8,
        paddingVertical: 6,
        justifyContent: 'center',
        height: 32,
    },
    actionButtonPressed: {
        opacity: 0.7,
    },
    actionButtonIcon: {
        color: theme.colors.button.secondary.tint,
    },
    sendButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        flexShrink: 0,
        marginLeft: 8,
    },
    sendButtonActive: {
        backgroundColor: theme.colors.button.primary.background,
    },
    sendButtonInactive: {
        backgroundColor: theme.colors.button.primary.disabled,
    },
    sendButtonInner: {
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
    },
    sendButtonInnerPressed: {
        opacity: 0.7,
    },
    sendButtonIcon: {
        color: theme.colors.button.primary.tint,
    },
    // Action button with text and icon
    actionButtonWithText: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: Platform.select({ default: 16, android: 20 }),
        paddingHorizontal: 10,
        paddingVertical: 6,
        justifyContent: 'center',
        height: 32,
        gap: 6,
    },
    actionButtonText: {
        fontSize: 13,
        color: theme.colors.button.secondary.tint,
        fontWeight: '600',
        ...Typography.default('semiBold'),
    },
    // Git status button with flex
    gitStatusButton: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: Platform.select({ default: 16, android: 20 }),
        paddingHorizontal: 8,
        paddingVertical: 6,
        height: 32,
        flex: 1,
        overflow: 'hidden',
    },
    // Status bar container with min height
    statusBarContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingBottom: 4,
        minHeight: 20,
    },
    statusBarLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    statusBarRight: {
        flexDirection: 'column',
        alignItems: 'flex-end',
        minWidth: 150,
    },
    // Model section title
    modelSectionTitle: {
        fontSize: 12,
        fontWeight: '600',
        color: '#666',
        paddingHorizontal: 16,
        paddingBottom: 4,
        ...Typography.default('semiBold'),
    },
    // Voice button image container
    voiceButtonImage: {
        width: 24,
        height: 24,
    },
}));

const getContextWarning = (contextSize: number, alwaysShow: boolean = false, theme: Theme) => {
    const percentageUsed = (contextSize / MAX_CONTEXT_SIZE) * 100;
    const percentageRemaining = Math.max(0, Math.min(100, 100 - percentageUsed));

    if (percentageRemaining <= 5) {
        return { text: t('agentInput.context.remaining', { percent: Math.round(percentageRemaining) }), color: theme.colors.warningCritical };
    } else if (percentageRemaining <= 10) {
        return { text: t('agentInput.context.remaining', { percent: Math.round(percentageRemaining) }), color: theme.colors.warning };
    } else if (alwaysShow) {
        // Show context remaining in neutral color when not near limit
        return { text: t('agentInput.context.remaining', { percent: Math.round(percentageRemaining) }), color: theme.colors.warning };
    }
    return null; // No display needed
};

export const AgentInput = React.memo(React.forwardRef<MultiTextInputHandle, AgentInputProps>((props, ref) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const screenWidth = useWindowDimensions().width;

    // Destructure callbacks used in useCallback hooks to avoid eslint exhaustive-deps warnings
    const {
        onPermissionModeChange,
        onModelModeChange,
        onAbort,
        onSend,
        value,
        permissionMode,
        showAbortButton
    } = props;

    const hasText = value.trim().length > 0;
    
    // Check if this is a Codex session
    const isCodex = props.metadata?.flavor === 'codex';

    // Calculate context warning
    const contextWarning = props.usageData?.contextSize
        ? getContextWarning(props.usageData.contextSize, props.alwaysShowContextSize ?? false, theme)
        : null;


    // Abort button state
    const [isAborting, setIsAborting] = React.useState(false);
    const shakerRef = React.useRef<ShakeInstance>(null);
    const inputRef = React.useRef<MultiTextInputHandle>(null);

    // Ref to hold latest keyboard handler values - avoids stale closure issues
    // and prevents listener churn when dependencies change frequently
    const keyboardHandlerRef = React.useRef({
        isCodex,
        modelMode: props.modelMode,
        onModelModeChange: props.onModelModeChange,
    });

    // Keep keyboard handler ref in sync with latest values
    React.useEffect(() => {
        keyboardHandlerRef.current = {
            isCodex,
            modelMode: props.modelMode,
            onModelModeChange: props.onModelModeChange,
        };
    });

    // Forward ref to the MultiTextInput with null safety
    React.useImperativeHandle(ref, () => ({
        setTextAndSelection: (text: string, selection: { start: number; end: number }) => {
            inputRef.current?.setTextAndSelection(text, selection);
        },
        focus: () => {
            inputRef.current?.focus();
        },
        blur: () => {
            inputRef.current?.blur();
        },
    }), []);

    // Autocomplete state - track text and selection together
    const [inputState, setInputState] = React.useState<TextInputState>({
        text: props.value,
        selection: { start: 0, end: 0 }
    });

    // Handle combined text and selection state changes
    const handleInputStateChange = React.useCallback((newState: TextInputState) => {
        // console.log('📝 Input state changed:', JSON.stringify(newState));
        setInputState(newState);
    }, []);

    // Use the tracked selection from inputState
    const activeWord = useActiveWord(inputState.text, inputState.selection, props.autocompletePrefixes);
    // Using default options: clampSelection=true, autoSelectFirst=true, wrapAround=true
    // To customize: useActiveSuggestions(activeWord, props.autocompleteSuggestions, { clampSelection: false, wrapAround: false })
    const [suggestions, selected, moveUp, moveDown] = useActiveSuggestions(activeWord, props.autocompleteSuggestions, { clampSelection: true, wrapAround: true });

    // Debug logging
    // React.useEffect(() => {
    //     console.log('🔍 Autocomplete Debug:', JSON.stringify({
    //         value: props.value,
    //         inputState,
    //         activeWord,
    //         suggestionsCount: suggestions.length,
    //         selected,
    //         prefixes: props.autocompletePrefixes
    //     }, null, 2));
    // }, [props.value, inputState, activeWord, suggestions.length, selected]);

    // Handle suggestion selection
    const handleSuggestionSelect = React.useCallback((index: number) => {
        if (!suggestions[index] || !inputRef.current) return;

        const suggestion = suggestions[index];

        // Apply the suggestion
        const result = applySuggestion(
            inputState.text,
            inputState.selection,
            suggestion.text,
            props.autocompletePrefixes,
            true // add space after
        );

        // Use imperative API to set text and selection
        inputRef.current.setTextAndSelection(result.text, {
            start: result.cursorPosition,
            end: result.cursorPosition
        });

        // console.log('Selected suggestion:', suggestion.text);

        // Small haptic feedback
        hapticsLight();
    }, [suggestions, inputState, props.autocompletePrefixes]);

    // Settings modal state
    const [showSettings, setShowSettings] = React.useState(false);

    // Handle settings button press
    const handleSettingsPress = React.useCallback(() => {
        hapticsLight();
        setShowSettings(prev => !prev);
    }, []);

    // Handle settings selection
    const handleSettingsSelect = React.useCallback((mode: PermissionMode) => {
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

    // Handle abort button press
    const handleAbortPress = React.useCallback(async () => {
        if (!onAbort) return;

        hapticsError();
        setIsAborting(true);
        const startTime = Date.now();

        try {
            await onAbort?.();

            // Ensure minimum 300ms loading time
            const elapsed = Date.now() - startTime;
            if (elapsed < 300) {
                await new Promise(resolve => setTimeout(resolve, 300 - elapsed));
            }
        } catch (error) {
            // Shake on error
            shakerRef.current?.shake();
            console.error('Abort RPC call failed:', error);
        } finally {
            setIsAborting(false);
        }
    }, [onAbort]);

    // Handle keyboard navigation
    const handleKeyPress = React.useCallback((event: KeyPressEvent): boolean => {
        // Handle autocomplete navigation first
        if (suggestions.length > 0) {
            if (event.key === 'ArrowUp') {
                moveUp();
                return true;
            } else if (event.key === 'ArrowDown') {
                moveDown();
                return true;
            } else if ((event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey))) {
                // Both Enter and Tab select the current suggestion
                // If none selected (selected === -1), select the first one
                const indexToSelect = selected >= 0 ? selected : 0;
                handleSuggestionSelect(indexToSelect);
                return true;
            } else if (event.key === 'Escape') {
                // Close suggestions
                // TODO: Clear suggestions
                return true;
            }
        }

        // Handle Escape for abort when no suggestions are visible
        if (event.key === 'Escape' && showAbortButton && onAbort && !isAborting) {
            handleAbortPress();
            return true;
        }

        // Handle Escape to close settings overlay on web
        if (event.key === 'Escape' && showSettings) {
            setShowSettings(false);
            return true;
        }

        // Original key handling
        if (Platform.OS === 'web') {
            if (event.key === 'Enter' && !event.shiftKey) {
                if (value.trim()) {
                    onSend();
                    return true; // Key was handled
                }
            }
            // Handle Shift+Tab for permission mode switching
            if (event.key === 'Tab' && event.shiftKey && onPermissionModeChange) {
                const modeOrder: PermissionMode[] = isCodex
                    ? ['default', 'read-only', 'safe-yolo', 'yolo']
                    : ['default', 'acceptEdits', 'plan', 'bypassPermissions'];
                const currentIndex = modeOrder.indexOf(permissionMode || 'default');
                const nextIndex = (currentIndex + 1) % modeOrder.length;
                onPermissionModeChange(modeOrder[nextIndex]);
                hapticsLight();
                return true; // Key was handled, prevent default tab behavior
            }

        }
        return false; // Key was not handled
    }, [value, onSend, permissionMode, onPermissionModeChange, suggestions, selected, handleSuggestionSelect, moveUp, moveDown, showAbortButton, onAbort, isAborting, handleAbortPress, isCodex, showSettings]);

    // Add global keyboard handler for model mode switching on web
    // Uses ref to avoid listener churn when props change frequently (HAP-37)
    React.useEffect(() => {
        if (Platform.OS !== 'web') return;

        const handleKeyDown = (e: KeyboardEvent) => {
            const { isCodex: currentIsCodex, modelMode, onModelModeChange } = keyboardHandlerRef.current;

            // Handle Cmd/Ctrl+M for model mode switching
            if (e.key === 'm' && (e.metaKey || e.ctrlKey) && onModelModeChange) {
                e.preventDefault();
                const modelOrder: ModelMode[] = currentIsCodex
                    ? ['gpt-5-codex-high', 'gpt-5-codex-medium', 'gpt-5-codex-low']
                    : ['opus', 'sonnet', 'haiku'];
                const currentIndex = modelOrder.indexOf(modelMode || (currentIsCodex ? 'gpt-5-codex-high' : 'opus'));
                const nextIndex = (currentIndex + 1) % modelOrder.length;
                onModelModeChange(modelOrder[nextIndex]);
                hapticsLight();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, []); // Empty deps - handler reads from ref



    return (
        <View style={[
            styles.container,
            { paddingHorizontal: screenWidth > 700 ? 16 : 8 }
        ]}>
            <View style={[
                styles.innerContainer,
                { maxWidth: layout.maxWidth }
            ]}>
                {/* Autocomplete suggestions overlay */}
                {suggestions.length > 0 && (
                    <View style={[
                        styles.autocompleteOverlay,
                        { paddingHorizontal: screenWidth > 700 ? 0 : 8 }
                    ]}>
                        <AgentInputAutocomplete
                            suggestions={suggestions.map(s => {
                                const Component = s.component;
                                return <Component key={s.key} />;
                            })}
                            selectedIndex={selected}
                            onSelect={handleSuggestionSelect}
                            itemHeight={48}
                        />
                    </View>
                )}

                {/* Settings overlay */}
                {showSettings && (
                    <>
                        <TouchableWithoutFeedback onPress={() => setShowSettings(false)}>
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
                                    {(isCodex 
                                        ? (['default', 'read-only', 'safe-yolo', 'yolo'] as const)
                                        : (['default', 'acceptEdits', 'plan', 'bypassPermissions'] as const)
                                    ).map((mode) => {
                                        const modeConfig = isCodex ? {
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
                                        const config = modeConfig[mode as keyof typeof modeConfig];
                                        if (!config) return null;
                                        const isSelected = props.permissionMode === mode;

                                        return (
                                            <Pressable
                                                key={mode}
                                                onPress={() => handleSettingsSelect(mode)}
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
                                    {(isCodex
                                        ? (['gpt-5-codex-high', 'gpt-5-codex-medium', 'gpt-5-codex-low', 'gpt-5-minimal', 'gpt-5-low', 'gpt-5-medium', 'gpt-5-high'] as const)
                                        : (['opus', 'sonnet', 'haiku'] as const)
                                    ).map((model) => {
                                        const modelConfig = isCodex ? {
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
                                        const config = modelConfig[model as keyof typeof modelConfig];
                                        if (!config) return null;
                                        const isSelected = props.modelMode === model || (isCodex && model === 'gpt-5-codex-high' && !props.modelMode) || (!isCodex && model === 'opus' && !props.modelMode);

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
                )}

                {/* Connection status, context warning, and permission mode */}
                {(props.connectionStatus || contextWarning || props.permissionMode) && (
                    <View style={styles.statusBarContainer}>
                        <View style={styles.statusBarLeft}>
                            {props.connectionStatus && (
                                <>
                                    <StatusDot
                                        color={props.connectionStatus.dotColor}
                                        isPulsing={props.connectionStatus.isPulsing}
                                        size={6}
                                        style={{ marginRight: 6 }}
                                    />
                                    <Text style={{
                                        fontSize: 11,
                                        color: props.connectionStatus.color,
                                        ...Typography.default()
                                    }}>
                                        {props.connectionStatus.text}
                                    </Text>
                                </>
                            )}
                            {contextWarning && (
                                <Text style={{
                                    fontSize: 11,
                                    color: contextWarning.color,
                                    marginLeft: props.connectionStatus ? 8 : 0,
                                    ...Typography.default()
                                }}>
                                    {props.connectionStatus ? '• ' : ''}{contextWarning.text}
                                </Text>
                            )}
                        </View>
                        <View style={styles.statusBarRight}>
                            {props.permissionMode && (
                                <Text style={{
                                    fontSize: 11,
                                    color: props.permissionMode === 'acceptEdits' ? theme.colors.permission.acceptEdits :
                                        props.permissionMode === 'bypassPermissions' ? theme.colors.permission.bypass :
                                            props.permissionMode === 'plan' ? theme.colors.permission.plan :
                                                props.permissionMode === 'read-only' ? theme.colors.permission.readOnly :
                                                    props.permissionMode === 'safe-yolo' ? theme.colors.permission.safeYolo :
                                                        props.permissionMode === 'yolo' ? theme.colors.permission.yolo :
                                                            theme.colors.textSecondary, // Use secondary text color for default
                                    ...Typography.default()
                                }}>
                                    {isCodex ? (
                                        props.permissionMode === 'default' ? t('agentInput.codexPermissionMode.default') :
                                            props.permissionMode === 'read-only' ? t('agentInput.codexPermissionMode.badgeReadOnly') :
                                                props.permissionMode === 'safe-yolo' ? t('agentInput.codexPermissionMode.badgeSafeYolo') :
                                                    props.permissionMode === 'yolo' ? t('agentInput.codexPermissionMode.badgeYolo') : ''
                                    ) : (
                                        props.permissionMode === 'default' ? t('agentInput.permissionMode.default') :
                                            props.permissionMode === 'acceptEdits' ? t('agentInput.permissionMode.badgeAcceptAllEdits') :
                                                props.permissionMode === 'bypassPermissions' ? t('agentInput.permissionMode.badgeBypassAllPermissions') :
                                                    props.permissionMode === 'plan' ? t('agentInput.permissionMode.badgePlanMode') : ''
                                    )}
                                </Text>
                            )}
                        </View>
                    </View>
                )}
                {/* Unified panel containing input and action buttons */}
                <View style={styles.unifiedPanel}>
                    {/* Input field */}
                    <View style={[styles.inputContainer, props.minHeight ? { minHeight: props.minHeight } : undefined]}>
                        <MultiTextInput
                            ref={inputRef}
                            value={props.value}
                            paddingTop={Platform.OS === 'web' ? 10 : 8}
                            paddingBottom={Platform.OS === 'web' ? 10 : 8}
                            onChangeText={props.onChangeText}
                            placeholder={props.placeholder}
                            onKeyPress={handleKeyPress}
                            onStateChange={handleInputStateChange}
                            maxHeight={120}
                        />
                    </View>

                    {/* Action buttons below input */}
                    <View style={styles.actionButtonsContainer}>
                        <View style={styles.actionButtonsLeft}>

                            {/* Settings button */}
                            {props.onPermissionModeChange && (
                                <Pressable
                                    onPress={handleSettingsPress}
                                    hitSlop={actionButtonHitSlop}
                                    style={({ pressed }) => [
                                        styles.actionButton,
                                        pressed && styles.actionButtonPressed
                                    ]}
                                >
                                    <Octicons
                                        name={'gear'}
                                        size={16}
                                        style={styles.actionButtonIcon}
                                    />
                                </Pressable>
                            )}

                            {/* Agent selector button */}
                            {props.agentType && props.onAgentClick && (
                                <Pressable
                                    onPress={() => {
                                        hapticsLight();
                                        props.onAgentClick?.();
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
                                        {props.agentType === 'claude' ? t('agentInput.agent.claude') : t('agentInput.agent.codex')}
                                    </Text>
                                </Pressable>
                            )}

                            {/* Machine selector button */}
                            {(props.machineName !== undefined) && props.onMachineClick && (
                                <Pressable
                                    onPress={() => {
                                        hapticsLight();
                                        props.onMachineClick?.();
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
                                        {props.machineName === null ? t('agentInput.noMachinesAvailable') : props.machineName}
                                    </Text>
                                </Pressable>
                            )}

                            {/* Path selector button */}
                            {props.currentPath && props.onPathClick && (
                                <Pressable
                                    onPress={() => {
                                        hapticsLight();
                                        props.onPathClick?.();
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
                                        {props.currentPath}
                                    </Text>
                                </Pressable>
                            )}

                            {/* Abort button */}
                            {props.onAbort && (
                                <Shaker ref={shakerRef}>
                                    <Pressable
                                        style={({ pressed }) => [
                                            styles.actionButton,
                                            pressed && styles.actionButtonPressed
                                        ]}
                                        hitSlop={actionButtonHitSlop}
                                        onPress={handleAbortPress}
                                        disabled={isAborting}
                                    >
                                        {isAborting ? (
                                            <ActivityIndicator
                                                size="small"
                                                color={styles.actionButtonIcon.color}
                                            />
                                        ) : (
                                            <Octicons
                                                name={"stop"}
                                                size={16}
                                                style={styles.actionButtonIcon}
                                            />
                                        )}
                                    </Pressable>
                                </Shaker>
                            )}

                            {/* Git Status Badge */}
                            <GitStatusButton sessionId={props.sessionId} onPress={props.onFileViewerPress} />
                        </View>

                        {/* Send/Voice button */}
                        <View
                            style={[
                                styles.sendButton,
                                (hasText || props.isSending || (props.onMicPress && !props.isMicActive))
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
                                onPress={() => {
                                    hapticsLight();
                                    if (hasText) {
                                        props.onSend();
                                    } else {
                                        props.onMicPress?.();
                                    }
                                }}
                                disabled={props.isSendDisabled || props.isSending || (!hasText && !props.onMicPress)}
                            >
                                {props.isSending ? (
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
                                ) : props.onMicPress && !props.isMicActive ? (
                                    <Image
                                        source={require('@/assets/images/icon-voice-white.png')}
                                        style={styles.voiceButtonImage}
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
                </View>
            </View>
        </View>
    );
}));

// Git Status Button Component
function GitStatusButton({ sessionId, onPress }: { sessionId?: string, onPress?: () => void }) {
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
}
