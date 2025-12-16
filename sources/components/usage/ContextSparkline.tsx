import React from 'react';
import { View } from 'react-native';
import Svg, { Polyline, Line } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { UsageHistoryEntry } from '@/sync/storageTypes';

/**
 * Maximum context size in tokens (190K tokens for Claude's context window).
 */
const MAX_CONTEXT_SIZE = 190000;

/**
 * Threshold percentages for warning states
 */
const WARNING_THRESHOLD = 0.80; // 80%
const CRITICAL_THRESHOLD = 0.95; // 95%

interface ContextSparklineProps {
    /** Historical usage data points */
    history: UsageHistoryEntry[];
    /** Current context size in tokens */
    currentContextSize?: number;
    /** Width of the sparkline in pixels */
    width?: number;
    /** Height of the sparkline in pixels */
    height?: number;
    /** Whether to show the warning threshold line */
    showThresholdLine?: boolean;
}

/**
 * ContextSparkline - Mini line chart showing context usage trend over time
 *
 * Displays historical context usage as a simple line graph with color coding:
 * - Blue/default: Normal usage levels
 * - Orange: Warning levels (>80%)
 * - Red: Critical levels (>95%)
 *
 * Usage:
 * ```tsx
 * <ContextSparkline
 *   history={session.usageHistory}
 *   currentContextSize={session.latestUsage?.contextSize}
 * />
 * ```
 */
export const ContextSparkline = React.memo(({
    history,
    currentContextSize,
    width = 48,
    height = 16,
    showThresholdLine = false
}: ContextSparklineProps) => {
    const { theme } = useUnistyles();

    // Need at least 2 points to draw a line
    if (!history || history.length < 2) {
        return null;
    }

    // Calculate SVG coordinates from history data
    const padding = 2;
    const chartWidth = width - (padding * 2);
    const chartHeight = height - (padding * 2);

    // Normalize context sizes to chart coordinates
    // Y-axis: 0 at bottom, MAX_CONTEXT_SIZE at top
    const points = history.map((entry, index) => {
        const x = padding + (index / (history.length - 1)) * chartWidth;
        const y = padding + chartHeight - (entry.contextSize / MAX_CONTEXT_SIZE) * chartHeight;
        return `${x},${y}`;
    }).join(' ');

    // Determine line color based on current/latest context percentage
    const latestSize = currentContextSize ?? history[history.length - 1]?.contextSize ?? 0;
    const percentage = latestSize / MAX_CONTEXT_SIZE;

    const lineColor = percentage >= CRITICAL_THRESHOLD
        ? theme.colors.warningCritical
        : percentage >= WARNING_THRESHOLD
            ? theme.colors.box.warning.text
            : theme.colors.textLink;

    // Calculate threshold line Y position
    const warningY = padding + chartHeight - (WARNING_THRESHOLD * chartHeight);

    return (
        <View style={styles.container}>
            <Svg width={width} height={height}>
                {/* Warning threshold line (optional) */}
                {showThresholdLine && (
                    <Line
                        x1={padding}
                        y1={warningY}
                        x2={width - padding}
                        y2={warningY}
                        stroke={theme.colors.box.warning.text}
                        strokeWidth={0.5}
                        strokeDasharray="2,2"
                        opacity={0.4}
                    />
                )}
                {/* Main sparkline */}
                <Polyline
                    points={points}
                    fill="none"
                    stroke={lineColor}
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </Svg>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        backgroundColor: theme.colors.surfaceHighest,
        borderRadius: 4,
        overflow: 'hidden',
    },
}));
