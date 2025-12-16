/**
 * KeyboardShortcutHints - Displays keyboard shortcuts for web users (HAP-328)
 *
 * This component shows visible keyboard shortcut hints in the UI:
 * - Enter: Send message
 * - Shift+Tab: Cycle permission mode
 * - Cmd/Ctrl+M: Cycle model
 * - Escape: Abort (when operation is in progress)
 *
 * Only visible on web platform. Uses platform-appropriate symbols
 * (⌘ for Mac, Ctrl for Windows/Linux).
 */
import * as React from 'react';
import { View, Text, Platform } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

interface KeyboardShortcutHintsProps {
    /** Whether abort is currently possible (shows Esc hint) */
    showAbortHint?: boolean;
    /** Whether model cycling is available */
    showModelHint?: boolean;
    /** Whether permission mode cycling is available */
    showModeHint?: boolean;
}

/**
 * Detect if user is on macOS for platform-appropriate modifier key symbol.
 * Uses navigator.platform on web, defaults to showing ⌘ on Mac.
 */
function useIsMac(): boolean {
    const [isMac, setIsMac] = React.useState(false);

    React.useEffect(() => {
        if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
            // Check for Mac in platform string
            setIsMac(navigator.platform?.toLowerCase().includes('mac') ?? false);
        }
    }, []);

    return isMac;
}

/**
 * Single keyboard shortcut hint display
 */
const ShortcutHint = React.memo(function ShortcutHint({
    keys,
    label
}: {
    keys: string;
    label: string;
}) {
    return (
        <View style={styles.hintItem}>
            <Text style={styles.keysText}>{keys}</Text>
            <Text style={styles.labelText}>{label}</Text>
        </View>
    );
});

/**
 * KeyboardShortcutHints component
 * Only renders on web platform.
 */
export const KeyboardShortcutHints = React.memo(function KeyboardShortcutHints({
    showAbortHint = false,
    showModelHint = true,
    showModeHint = true,
}: KeyboardShortcutHintsProps) {
    // Only render on web
    if (Platform.OS !== 'web') {
        return null;
    }

    const isMac = useIsMac();
    const modifierKey = isMac ? '⌘' : 'Ctrl';

    return (
        <View style={styles.container}>
            <ShortcutHint
                keys="↵"
                label={t('agentInput.shortcuts.send')}
            />
            {showModeHint && (
                <ShortcutHint
                    keys="⇧Tab"
                    label={t('agentInput.shortcuts.cycleMode')}
                />
            )}
            {showModelHint && (
                <ShortcutHint
                    keys={`${modifierKey}M`}
                    label={t('agentInput.shortcuts.cycleModel')}
                />
            )}
            {showAbortHint && (
                <ShortcutHint
                    keys="Esc"
                    label={t('agentInput.shortcuts.abort')}
                />
            )}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: 12,
        paddingHorizontal: 4,
        paddingVertical: 4,
        flexWrap: 'wrap',
    },
    hintItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    keysText: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        backgroundColor: theme.colors.surfacePressed,
        paddingHorizontal: 4,
        paddingVertical: 2,
        borderRadius: 3,
        overflow: 'hidden',
        ...Typography.default('semiBold'),
    },
    labelText: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
}));
