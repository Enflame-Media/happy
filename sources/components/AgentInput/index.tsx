/**
 * AgentInput - Main orchestrator component for text input with autocomplete,
 * settings, action buttons, and status display.
 *
 * Split into focused sub-components for maintainability:
 * - StatusDisplay: Connection status, context warning, permission mode
 * - SettingsOverlay: Permission mode and model selection
 * - ActionButtons: All action buttons including send/voice
 */
import * as React from 'react';
import { View, Platform, useWindowDimensions } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { layout } from '../layout';
import { MultiTextInput, TextInputState, MultiTextInputHandle, KeyPressEvent } from '../MultiTextInput';
import { PermissionMode, ModelMode } from '../PermissionModeSelector';
import { hapticsLight, hapticsError } from '../haptics';
import { ShakeInstance } from '../Shaker';
import { useActiveWord } from '../autocomplete/useActiveWord';
import { useActiveSuggestions } from '../autocomplete/useActiveSuggestions';
import { AgentInputAutocomplete } from '../AgentInputAutocomplete';
import { applySuggestion } from '../autocomplete/applySuggestion';

// Sub-components
import { StatusDisplay } from './StatusDisplay';
import { SettingsOverlay } from './SettingsOverlay';
import { ActionButtons } from './ActionButtons';

// Styles and types
import { stylesheet, getContextWarning } from './styles';
import { AgentInputProps } from './types';

// Re-export types for consumers
export type { AgentInputProps } from './types';

/**
 * AgentInput is the main input component for the chat interface.
 * It handles text input, autocomplete, settings, and action buttons.
 */
export const AgentInput = React.memo(React.forwardRef<MultiTextInputHandle, AgentInputProps>((props, ref) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const screenWidth = useWindowDimensions().width;

    // Destructure callbacks used in useCallback hooks to avoid eslint exhaustive-deps warnings
    const {
        onPermissionModeChange,
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
        setInputState(newState);
    }, []);

    // Use the tracked selection from inputState
    const activeWord = useActiveWord(inputState.text, inputState.selection, props.autocompletePrefixes);
    // Using default options: clampSelection=true, autoSelectFirst=true, wrapAround=true
    const [suggestions, selected, moveUp, moveDown] = useActiveSuggestions(activeWord, props.autocompleteSuggestions, { clampSelection: true, wrapAround: true });

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

    // Handle send/mic button press
    const handleSendPress = React.useCallback(() => {
        hapticsLight();
        if (hasText) {
            props.onSend();
        } else {
            props.onMicPress?.();
        }
    }, [hasText, props]);

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
                <SettingsOverlay
                    visible={showSettings}
                    onClose={() => setShowSettings(false)}
                    isCodex={isCodex}
                    permissionMode={props.permissionMode}
                    onPermissionModeChange={props.onPermissionModeChange}
                    modelMode={props.modelMode}
                    onModelModeChange={props.onModelModeChange}
                    screenWidth={screenWidth}
                />

                {/* Connection status, context warning, and permission mode */}
                <StatusDisplay
                    connectionStatus={props.connectionStatus}
                    contextWarning={contextWarning}
                    permissionMode={props.permissionMode}
                    isCodex={isCodex}
                />

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
                    <ActionButtons
                        ref={shakerRef}
                        onSettingsPress={props.onPermissionModeChange ? handleSettingsPress : undefined}
                        agentType={props.agentType}
                        onAgentClick={props.onAgentClick}
                        machineName={props.machineName}
                        onMachineClick={props.onMachineClick}
                        currentPath={props.currentPath}
                        onPathClick={props.onPathClick}
                        onAbort={props.onAbort}
                        isAborting={isAborting}
                        onAbortPress={handleAbortPress}
                        sessionId={props.sessionId}
                        onFileViewerPress={props.onFileViewerPress}
                        hasText={hasText}
                        isSending={props.isSending}
                        isSendDisabled={props.isSendDisabled}
                        onSendPress={handleSendPress}
                        onMicPress={props.onMicPress}
                        isMicActive={props.isMicActive}
                    />
                </View>
            </View>
        </View>
    );
}));
