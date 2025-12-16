import React from 'react';
import { View } from 'react-native';
import Svg, { Polyline, Line, Circle, Text as SvgText } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { UsageHistoryEntry } from '@/sync/storageTypes';
import { t } from '@/text';

/**
 * Maximum context size in tokens (190K tokens for Claude's context window).
 */
const MAX_CONTEXT_SIZE = 190000;

/**
 * Threshold percentages for warning states
 */
const WARNING_THRESHOLD = 0.80; // 80%
const CRITICAL_THRESHOLD = 0.95; // 95%

interface ContextHistoryChartProps {
    /** Historical usage data points */
    history: UsageHistoryEntry[];
    /** Current context size in tokens */
    currentContextSize?: number;
    /** Height of the chart in pixels */
    height?: number;
}

/**
 * Formats token count with K suffix for thousands.
 */
function formatTokens(tokens: number): string {
    if (tokens >= 10000) {
        return `${(tokens / 1000).toFixed(0)}K`;
    }
    if (tokens >= 1000) {
        return `${(tokens / 1000).toFixed(1)}K`;
    }
    return tokens.toString();
}

/**
 * ContextHistoryChart - Full-size chart showing context usage trend over time
 *
 * Displays historical context usage as a line graph with:
 * - Y-axis showing token count
 * - Warning/critical threshold lines
 * - Color-coded line based on current usage level
 *
 * Used in the session info page to show context growth over time (HAP-344).
 */
export const ContextHistoryChart = React.memo(({
    history,
    currentContextSize,
    height = 120
}: ContextHistoryChartProps) => {
    const { theme } = useUnistyles();

    // Need at least 2 points to draw a meaningful chart
    if (!history || history.length < 2) {
        return (
            <View style={styles.container}>
                <View style={[styles.chartContainer, { height }]}>
                    <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                        {t('sessionInfo.contextHistory.notEnoughData')}
                    </Text>
                </View>
            </View>
        );
    }

    // Calculate chart dimensions
    const padding = { top: 16, right: 48, bottom: 24, left: 8 };
    const chartWidth = 300; // Will be scaled to container width
    const chartHeight = height - padding.top - padding.bottom;

    // Calculate coordinates from history data
    // Y-axis: max at top (based on max value in history or MAX_CONTEXT_SIZE)
    const maxContextInHistory = Math.max(...history.map(h => h.contextSize));
    const yAxisMax = Math.max(maxContextInHistory * 1.1, MAX_CONTEXT_SIZE * 0.5); // At least 50% of max or 10% above highest

    const points = history.map((entry, index) => {
        const x = padding.left + (index / (history.length - 1)) * (chartWidth - padding.left - padding.right);
        const y = padding.top + chartHeight - (entry.contextSize / yAxisMax) * chartHeight;
        return { x, y, contextSize: entry.contextSize };
    });

    const pointsString = points.map(p => `${p.x},${p.y}`).join(' ');

    // Determine line color based on current/latest context percentage
    const latestSize = currentContextSize ?? history[history.length - 1]?.contextSize ?? 0;
    const percentage = latestSize / MAX_CONTEXT_SIZE;

    const lineColor = percentage >= CRITICAL_THRESHOLD
        ? theme.colors.warningCritical
        : percentage >= WARNING_THRESHOLD
            ? theme.colors.box.warning.text
            : theme.colors.textLink;

    // Calculate threshold line Y positions
    const warningY = padding.top + chartHeight - (WARNING_THRESHOLD * MAX_CONTEXT_SIZE / yAxisMax) * chartHeight;
    const criticalY = padding.top + chartHeight - (CRITICAL_THRESHOLD * MAX_CONTEXT_SIZE / yAxisMax) * chartHeight;

    // Y-axis labels
    const yAxisLabels = [
        { value: 0, y: padding.top + chartHeight },
        { value: yAxisMax * 0.5, y: padding.top + chartHeight * 0.5 },
        { value: yAxisMax, y: padding.top }
    ];

    // Latest point for dot
    const latestPoint = points[points.length - 1];

    return (
        <View style={styles.container}>
            <View style={[styles.chartContainer, { height }]}>
                <Svg width="100%" height={height} viewBox={`0 0 ${chartWidth} ${height}`} preserveAspectRatio="xMidYMid meet">
                    {/* Warning threshold line */}
                    {warningY > padding.top && warningY < padding.top + chartHeight && (
                        <>
                            <Line
                                x1={padding.left}
                                y1={warningY}
                                x2={chartWidth - padding.right}
                                y2={warningY}
                                stroke={theme.colors.box.warning.text}
                                strokeWidth={1}
                                strokeDasharray="4,4"
                                opacity={0.5}
                            />
                            <SvgText
                                x={chartWidth - padding.right + 4}
                                y={warningY + 3}
                                fontSize={10}
                                fill={theme.colors.box.warning.text}
                                opacity={0.7}
                            >
                                80%
                            </SvgText>
                        </>
                    )}

                    {/* Critical threshold line */}
                    {criticalY > padding.top && criticalY < padding.top + chartHeight && (
                        <>
                            <Line
                                x1={padding.left}
                                y1={criticalY}
                                x2={chartWidth - padding.right}
                                y2={criticalY}
                                stroke={theme.colors.warningCritical}
                                strokeWidth={1}
                                strokeDasharray="4,4"
                                opacity={0.5}
                            />
                            <SvgText
                                x={chartWidth - padding.right + 4}
                                y={criticalY + 3}
                                fontSize={10}
                                fill={theme.colors.warningCritical}
                                opacity={0.7}
                            >
                                95%
                            </SvgText>
                        </>
                    )}

                    {/* Y-axis labels */}
                    {yAxisLabels.map((label, index) => (
                        <SvgText
                            key={index}
                            x={chartWidth - padding.right + 4}
                            y={label.y + 3}
                            fontSize={9}
                            fill={theme.colors.textSecondary}
                        >
                            {formatTokens(label.value)}
                        </SvgText>
                    ))}

                    {/* Main line */}
                    <Polyline
                        points={pointsString}
                        fill="none"
                        stroke={lineColor}
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />

                    {/* Current position dot */}
                    <Circle
                        cx={latestPoint.x}
                        cy={latestPoint.y}
                        r={4}
                        fill={lineColor}
                    />
                </Svg>
            </View>

            {/* Legend */}
            <View style={styles.legend}>
                <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: lineColor }]} />
                    <Text style={[styles.legendText, { color: theme.colors.textSecondary }]}>
                        {t('sessionInfo.contextHistory.currentUsage', { tokens: formatTokens(latestSize) })}
                    </Text>
                </View>
                <Text style={[styles.legendText, { color: theme.colors.textSecondary }]}>
                    {t('sessionInfo.contextHistory.dataPoints', { count: history.length })}
                </Text>
            </View>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        padding: 16,
    },
    chartContainer: {
        width: '100%',
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyText: {
        fontSize: 14,
        textAlign: 'center',
        ...Typography.default(),
    },
    legend: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 8,
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: 'rgba(128, 128, 128, 0.2)',
    },
    legendItem: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    legendDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: 6,
    },
    legendText: {
        fontSize: 12,
        ...Typography.default(),
    },
}));
