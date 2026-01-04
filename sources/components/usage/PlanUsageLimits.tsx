import React, { useState, useEffect, useCallback } from 'react';
import { View, ActivityIndicator, Pressable } from 'react-native';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useEntitlement } from '@/sync/storage';
import {
    usePlanLimits,
    formatResetCountdown,
    formatResetDatetime,
    formatLastUpdated,
    type UsageLimit,
} from '@/hooks/usePlanLimits';
import { UsageBar } from './UsageBar';
import Ionicons from '@expo/vector-icons/Ionicons';
import { t } from '@/text';

const styles = StyleSheet.create((theme) => ({
    container: {
        margin: 16,
        marginBottom: 0,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    title: {
        fontSize: 18,
        fontWeight: '600',
        color: theme.colors.text,
    },
    section: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
    },
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 4,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: '500',
        color: theme.colors.text,
    },
    sectionLink: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    limitRow: {
        marginVertical: 8,
    },
    limitLabel: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    limitLabelText: {
        fontSize: 14,
        color: theme.colors.text,
    },
    resetText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 2,
    },
    percentageText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        fontWeight: '600',
    },
    progressBarContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 8,
        gap: 8,
    },
    progressBarWrapper: {
        flex: 1,
    },
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: 8,
        paddingTop: 4,
    },
    lastUpdatedText: {
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    refreshButton: {
        padding: 4,
    },
    loadingContainer: {
        padding: 32,
        alignItems: 'center',
    },
    errorContainer: {
        padding: 16,
        alignItems: 'center',
        gap: 8,
    },
    errorText: {
        fontSize: 14,
        color: theme.colors.status.error,
        textAlign: 'center',
    },
    unavailableContainer: {
        padding: 16,
        alignItems: 'center',
    },
    unavailableText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        textAlign: 'center',
    },
    infoIcon: {
        marginLeft: 2,
    },
}));

/**
 * Progress bar for a single usage limit
 */
interface LimitProgressBarProps {
    limit: UsageLimit;
    color?: string;
}

const LimitProgressBar: React.FC<LimitProgressBarProps> = ({ limit, color = '#007AFF' }) => {
    const { theme } = useUnistyles();

    // Format reset time, handling null case when no reset is scheduled
    const formattedTime = limit.resetDisplayType === 'countdown'
        ? formatResetCountdown(limit.resetsAt)
        : formatResetDatetime(limit.resetsAt);

    const resetTimeText = formattedTime !== null
        ? (limit.resetDisplayType === 'countdown'
            ? t('planLimits.resetsIn', { time: formattedTime })
            : t('planLimits.resetsAt', { time: formattedTime }))
        : null;

    return (
        <View style={styles.limitRow}>
            <View style={styles.limitLabel}>
                <Text style={styles.limitLabelText}>{limit.label}</Text>
                {limit.description && (
                    <Ionicons
                        name="information-circle-outline"
                        size={16}
                        color={theme.colors.textSecondary}
                        style={styles.infoIcon}
                    />
                )}
            </View>
            {resetTimeText !== null && (
                <Text style={styles.resetText}>{resetTimeText}</Text>
            )}
            <View style={styles.progressBarContainer}>
                <View style={styles.progressBarWrapper}>
                    <UsageBar
                        label=""
                        value={limit.percentageUsed}
                        maxValue={100}
                        color={color}
                        showPercentage={false}
                        height={6}
                    />
                </View>
                <Text style={styles.percentageText}>{Math.round(limit.percentageUsed)}% {t('planLimits.used')}</Text>
            </View>
        </View>
    );
};

/**
 * PlanUsageLimits - Shows subscription plan usage limits for Pro users
 *
 * This component displays:
 * - Current session usage with countdown timer
 * - Weekly limits with per-model breakdown
 * - Last updated timestamp with refresh capability
 *
 * Only renders for users with 'pro' entitlement via RevenueCat.
 */
export const PlanUsageLimits: React.FC = () => {
    const { theme } = useUnistyles();
    const isPro = __DEV__ || useEntitlement('pro');
    const { data, loading, error, refresh } = usePlanLimits();
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Update countdown timers periodically
    const [, setTick] = useState(0);
    useEffect(() => {
        const interval = setInterval(() => setTick((t) => t + 1), 60000); // Update every minute
        return () => clearInterval(interval);
    }, []);

    const handleRefresh = useCallback(async () => {
        setIsRefreshing(true);
        await refresh();
        setIsRefreshing(false);
    }, [refresh]);

    // Don't render for non-Pro users
    if (!isPro) {
        return null;
    }

    // Loading state
    if (loading && !data) {
        return (
            <View style={styles.container}>
                <View style={styles.header}>
                    <Text style={styles.title}>{t('planLimits.title')}</Text>
                </View>
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="small" color="#007AFF" />
                </View>
            </View>
        );
    }

    // Error state
    if (error && !data) {
        return (
            <View style={styles.container}>
                <View style={styles.header}>
                    <Text style={styles.title}>{t('planLimits.title')}</Text>
                </View>
                <View style={styles.errorContainer}>
                    <Ionicons name="alert-circle-outline" size={32} color={theme.colors.status.error} />
                    <Text style={styles.errorText}>{error}</Text>
                    <Pressable onPress={handleRefresh}>
                        <Text style={{ color: '#007AFF' }}>{t('common.retry')}</Text>
                    </Pressable>
                </View>
            </View>
        );
    }

    // Limits not available from provider
    if (data && !data.limitsAvailable) {
        return (
            <View style={styles.container}>
                <View style={styles.header}>
                    <Text style={styles.title}>{t('planLimits.title')}</Text>
                </View>
                <View style={styles.unavailableContainer}>
                    <Text style={styles.unavailableText}>{t('planLimits.unavailable')}</Text>
                </View>
            </View>
        );
    }

    // No data yet
    if (!data) {
        return null;
    }

    const hasSessionLimit = !!data.sessionLimit;
    const hasWeeklyLimits = data.weeklyLimits.length > 0;

    // Nothing to show
    if (!hasSessionLimit && !hasWeeklyLimits) {
        return null;
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>{t('planLimits.title')}</Text>
            </View>

            {/* Session Limit */}
            {hasSessionLimit && data.sessionLimit && (
                <View style={styles.section}>
                    <LimitProgressBar limit={data.sessionLimit} />
                </View>
            )}

            {/* Weekly Limits */}
            {hasWeeklyLimits && (
                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle}>{t('planLimits.weeklyLimits')}</Text>
                        <Text style={styles.sectionLink}>{t('planLimits.learnMore')}</Text>
                    </View>
                    {data.weeklyLimits.map((limit) => (
                        <LimitProgressBar key={limit.id} limit={limit} />
                    ))}
                </View>
            )}

            {/* Footer with last updated */}
            <View style={styles.footer}>
                <Text style={styles.lastUpdatedText}>
                    {t('planLimits.lastUpdated', { time: formatLastUpdated(data.lastUpdatedAt) })}
                </Text>
                <Pressable
                    style={styles.refreshButton}
                    onPress={handleRefresh}
                    disabled={isRefreshing}
                >
                    <Ionicons
                        name="refresh-outline"
                        size={16}
                        color={theme.colors.textSecondary}
                    />
                </Pressable>
            </View>
        </View>
    );
};
