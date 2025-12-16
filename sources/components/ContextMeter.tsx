import React from 'react';
import { View } from 'react-native';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { UsageHistoryEntry } from '@/sync/storageTypes';
import { ContextSparkline } from './usage/ContextSparkline';

/**
 * Maximum context size in tokens (190K tokens for Claude's context window).
 * Using 190K as practical maximum per PRD specification.
 */
const MAX_CONTEXT_SIZE = 190000;

/**
 * Threshold percentages for warning states
 */
const WARNING_THRESHOLD = 0.80; // 80%
const CRITICAL_THRESHOLD = 0.95; // 95%

interface ContextMeterProps {
    /** Context size in tokens (0-190000) */
    contextSize: number;
    /** If true, only show when usage exceeds warning threshold (default: true) */
    showWarningOnly?: boolean;
    /** Historical usage data for sparkline visualization (HAP-344) */
    usageHistory?: UsageHistoryEntry[] | null;
    /** If true, show sparkline instead of percentage when history is available */
    showSparkline?: boolean;
}

/**
 * Context usage indicator component.
 * Shows a subtle badge when context usage is high (>80%) or critical (>95%).
 * Can optionally display a sparkline showing historical context growth (HAP-344).
 *
 * Usage:
 * ```tsx
 * {session.latestUsage?.contextSize && (
 *   <ContextMeter
 *     contextSize={session.latestUsage.contextSize}
 *     usageHistory={session.usageHistory}
 *     showSparkline={true}
 *   />
 * )}
 * ```
 */
export const ContextMeter = React.memo(({
    contextSize,
    showWarningOnly = true,
    usageHistory,
    showSparkline = false
}: ContextMeterProps) => {
    const { theme } = useUnistyles();
    const styles = stylesheet;

    const percentage = Math.min(contextSize / MAX_CONTEXT_SIZE, 1);
    const percentageDisplay = Math.round(percentage * 100);

    const isCritical = percentage >= CRITICAL_THRESHOLD;
    const isWarning = percentage >= WARNING_THRESHOLD;

    // In warning-only mode, don't render anything if below warning threshold
    if (showWarningOnly && !isWarning) {
        return null;
    }

    // Determine color based on threshold
    const textColor = isCritical
        ? theme.colors.warningCritical
        : isWarning
            ? theme.colors.box.warning.text
            : styles.normalText.color;

    // Show sparkline if enabled and we have enough history (at least 2 points)
    const hasHistory = usageHistory && usageHistory.length >= 2;
    if (showSparkline && hasHistory) {
        return (
            <ContextSparkline
                history={usageHistory}
                currentContextSize={contextSize}
                width={48}
                height={16}
            />
        );
    }

    return (
        <View style={styles.container}>
            <Text style={[styles.text, { color: textColor }]}>
                {percentageDisplay}%
            </Text>
        </View>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.surfaceHighest,
        paddingHorizontal: 4,
        height: 16,
        borderRadius: 4,
    },
    text: {
        fontSize: 10,
        fontWeight: '500',
        ...Typography.default(),
    },
    normalText: {
        color: theme.colors.textSecondary,
    },
}));
