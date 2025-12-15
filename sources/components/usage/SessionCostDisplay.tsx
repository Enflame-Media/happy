import React, { useState, useEffect, useCallback } from 'react';
import { View, ActivityIndicator, Pressable } from 'react-native';
import { Text } from '@/components/StyledText';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useAuth } from '@/auth/AuthContext';
import { getUsageForPeriod, calculateTotals, CostByTokenType } from '@/sync/apiUsage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { t } from '@/text';

interface SessionCostDisplayProps {
    sessionId: string;
    /** Compact mode shows just total cost inline */
    compact?: boolean;
}

const styles = StyleSheet.create((theme) => ({
    container: {
        padding: 16,
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
    },
    compactContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    title: {
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.text,
    },
    refreshButton: {
        padding: 4,
    },
    totalCost: {
        fontSize: 28,
        fontWeight: '700',
        color: theme.colors.text,
        marginBottom: 16,
    },
    compactCost: {
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.text,
    },
    breakdownContainer: {
        gap: 8,
    },
    breakdownRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    breakdownLabel: {
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    breakdownValue: {
        fontSize: 14,
        fontWeight: '500',
        color: theme.colors.text,
    },
    loadingContainer: {
        justifyContent: 'center',
        alignItems: 'center',
        padding: 16,
    },
    errorContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    errorText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    noCostText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
        textAlign: 'center',
    },
}));

/**
 * Displays cost data for a specific session.
 * Queries the usage API filtered by sessionId to get accurate cost breakdown.
 */
export const SessionCostDisplay: React.FC<SessionCostDisplayProps> = ({
    sessionId,
    compact = false
}) => {
    const { theme } = useUnistyles();
    const auth = useAuth();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [totalCost, setTotalCost] = useState<number>(0);
    const [costByTokenType, setCostByTokenType] = useState<CostByTokenType>({
        input: 0,
        output: 0,
        cache_creation: 0,
        cache_read: 0
    });

    const loadCostData = useCallback(async () => {
        if (!auth.credentials) {
            setError(t('errors.notAuthenticated'));
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            // Query usage for this specific session over the last 30 days
            const response = await getUsageForPeriod(auth.credentials, '30days', sessionId);
            const totals = calculateTotals(response.usage || []);
            setTotalCost(totals.totalCost);
            setCostByTokenType(totals.costByTokenType);
        } catch (err) {
            console.error('Failed to load session cost:', err);
            setError(t('usage.noData'));
        } finally {
            setLoading(false);
        }
    }, [auth.credentials, sessionId]);

    useEffect(() => {
        loadCostData();
    }, [loadCostData]);

    const formatCost = (cost: number): string => {
        if (cost < 0.01) {
            return `$${cost.toFixed(4)}`;
        }
        return `$${cost.toFixed(2)}`;
    };

    // Compact mode - just show cost inline
    if (compact) {
        if (loading) {
            return (
                <View style={styles.compactContainer}>
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                </View>
            );
        }

        if (error || totalCost === 0) {
            return (
                <View style={styles.compactContainer}>
                    <Text style={styles.errorText}>--</Text>
                </View>
            );
        }

        return (
            <View style={styles.compactContainer}>
                <Text style={styles.compactCost}>{formatCost(totalCost)}</Text>
            </View>
        );
    }

    // Full mode - show breakdown
    if (loading) {
        return (
            <View style={[styles.container, styles.loadingContainer]}>
                <ActivityIndicator size="large" color="#007AFF" />
            </View>
        );
    }

    if (error) {
        return (
            <View style={styles.container}>
                <View style={styles.errorContainer}>
                    <Ionicons name="alert-circle-outline" size={20} color={theme.colors.textSecondary} />
                    <Text style={styles.errorText}>{error}</Text>
                </View>
            </View>
        );
    }

    if (totalCost === 0) {
        return (
            <View style={styles.container}>
                <Text style={styles.noCostText}>{t('sessionInfo.noCostDataYet')}</Text>
            </View>
        );
    }

    // Token type labels mapping to translation keys
    const tokenTypeLabels: Record<keyof CostByTokenType, string> = {
        input: t('sessionInfo.inputCost'),
        output: t('sessionInfo.outputCost'),
        cache_creation: t('sessionInfo.cacheCreationCost'),
        cache_read: t('sessionInfo.cacheReadCost')
    };

    // Filter to only show token types with non-zero costs, sorted by cost (highest first)
    const sortedTokenTypes = (Object.entries(costByTokenType) as [keyof CostByTokenType, number][])
        .filter(([, cost]) => cost > 0)
        .sort(([, a], [, b]) => b - a);

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>{t('sessionInfo.sessionCost')}</Text>
                <Pressable style={styles.refreshButton} onPress={loadCostData}>
                    <Ionicons name="refresh-outline" size={20} color={theme.colors.textSecondary} />
                </Pressable>
            </View>

            <Text style={styles.totalCost}>{formatCost(totalCost)}</Text>

            {sortedTokenTypes.length > 0 && (
                <View style={styles.breakdownContainer}>
                    {sortedTokenTypes.map(([tokenType, cost]) => (
                        <View key={tokenType} style={styles.breakdownRow}>
                            <Text style={styles.breakdownLabel}>{tokenTypeLabels[tokenType]}</Text>
                            <Text style={styles.breakdownValue}>{formatCost(cost)}</Text>
                        </View>
                    ))}
                </View>
            )}
        </View>
    );
};
