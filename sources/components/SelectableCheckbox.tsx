/**
 * SelectableCheckbox - Animated checkbox for multi-select mode
 *
 * Displays an animated checkbox that slides in from the left when
 * multi-select mode is active. Used in session rows for bulk selection.
 */
import React from 'react';
import { Pressable } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
    useAnimatedStyle,
    withTiming,
    Easing,
} from 'react-native-reanimated';
import { hapticsLight } from '@/components/haptics';

interface SelectableCheckboxProps {
    /** Whether the checkbox is visible (multi-select mode active) */
    visible: boolean;
    /** Whether this item is selected */
    selected: boolean;
    /** Called when checkbox is tapped */
    onToggle: () => void;
    /** Whether checkbox can be interacted with */
    disabled?: boolean;
}

const CHECKBOX_WIDTH = 44;

export const SelectableCheckbox = React.memo(function SelectableCheckbox({
    visible,
    selected,
    onToggle,
    disabled = false,
}: SelectableCheckboxProps) {
    const { theme } = useUnistyles();

    const handlePress = React.useCallback(() => {
        if (!disabled) {
            hapticsLight();
            onToggle();
        }
    }, [disabled, onToggle]);

    // Animated width for slide-in effect
    const containerAnimatedStyle = useAnimatedStyle(() => {
        return {
            width: withTiming(visible ? CHECKBOX_WIDTH : 0, {
                duration: 200,
                easing: Easing.out(Easing.cubic),
            }),
            opacity: withTiming(visible ? 1 : 0, {
                duration: 150,
            }),
        };
    }, [visible]);

    // Animated scale for checkbox state change
    const checkboxAnimatedStyle = useAnimatedStyle(() => {
        return {
            transform: [
                {
                    scale: withTiming(selected ? 1 : 0.9, {
                        duration: 100,
                    }),
                },
            ],
        };
    }, [selected]);

    const styles = StyleSheet.create({
        container: {
            overflow: 'hidden',
            justifyContent: 'center',
            alignItems: 'center',
        },
        pressable: {
            width: CHECKBOX_WIDTH,
            height: '100%',
            justifyContent: 'center',
            alignItems: 'center',
        },
        checkbox: {
            width: 24,
            height: 24,
            borderRadius: 12,
            borderWidth: 2,
            borderColor: theme.colors.textSecondary,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'transparent',
        },
        checkboxSelected: {
            backgroundColor: '#007AFF',
            borderColor: '#007AFF',
        },
        checkboxDisabled: {
            opacity: 0.5,
        },
    });

    return (
        <Animated.View style={[styles.container, containerAnimatedStyle]}>
            <Pressable
                style={styles.pressable}
                onPress={handlePress}
                disabled={disabled}
                hitSlop={8}
                accessibilityRole="checkbox"
                accessibilityLabel={selected ? 'Selected' : 'Not selected'}
                accessibilityState={{
                    checked: selected,
                    disabled: disabled,
                }}
            >
                <Animated.View
                    style={[
                        styles.checkbox,
                        selected && styles.checkboxSelected,
                        disabled && styles.checkboxDisabled,
                        checkboxAnimatedStyle,
                    ]}
                >
                    {selected && (
                        <Ionicons name="checkmark" size={16} color="white" />
                    )}
                </Animated.View>
            </Pressable>
        </Animated.View>
    );
});
