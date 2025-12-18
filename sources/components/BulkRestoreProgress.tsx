/**
 * BulkRestoreProgress - Progress modal for bulk session restore
 *
 * Shows real-time progress during bulk restore operation:
 * - Progress bar with percentage
 * - Current session being processed
 * - Success/failure counts
 * - Cancel button
 * - Final summary with detailed results
 */
import React from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { BaseModal } from '@/modal/components/BaseModal';
import { Typography } from '@/constants/Typography';
import { StyleSheet } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import Ionicons from '@expo/vector-icons/Ionicons';
import { t } from '@/text';
import type { BulkRestoreProgress as BulkRestoreProgressType } from '@/hooks/useBulkSessionRestore';

interface BulkRestoreProgressProps {
    /** Progress state from useBulkSessionRestore */
    progress: BulkRestoreProgressType | null;
    /** Whether restore is in progress */
    isRestoring: boolean;
    /** Cancel handler */
    onCancel: () => void;
    /** Close handler (when done) */
    onClose: () => void;
}

export const BulkRestoreProgress = React.memo(function BulkRestoreProgress({
    progress,
    isRestoring,
    onCancel,
    onClose,
}: BulkRestoreProgressProps) {
    const { theme } = useUnistyles();

    if (!progress) return null;

    const percentage = progress.total > 0
        ? Math.round((progress.completed / progress.total) * 100)
        : 0;

    const isDone = !isRestoring && progress.completed === progress.total;
    const hasFailures = progress.failed > 0;

    const styles = StyleSheet.create({
        container: {
            backgroundColor: theme.colors.surface,
            borderRadius: 14,
            width: 320,
            maxWidth: '90%',
            overflow: 'hidden',
            shadowColor: theme.colors.shadow.color,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.25,
            shadowRadius: 4,
            elevation: 5,
        },
        content: {
            paddingHorizontal: 20,
            paddingTop: 24,
            paddingBottom: 20,
        },
        title: {
            fontSize: 17,
            textAlign: 'center',
            color: theme.colors.text,
            marginBottom: 16,
        },
        progressContainer: {
            marginBottom: 16,
        },
        progressBar: {
            height: 8,
            backgroundColor: theme.colors.divider,
            borderRadius: 4,
            overflow: 'hidden',
        },
        progressFill: {
            height: '100%',
            backgroundColor: hasFailures && isDone ? '#FF9500' : '#34C759',
            borderRadius: 4,
        },
        progressText: {
            fontSize: 13,
            color: theme.colors.textSecondary,
            textAlign: 'center',
            marginTop: 8,
        },
        statusContainer: {
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            marginBottom: 16,
            gap: 16,
        },
        statusItem: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
        },
        statusText: {
            fontSize: 13,
            color: theme.colors.textSecondary,
        },
        successText: {
            color: '#34C759',
        },
        failText: {
            color: '#FF3B30',
        },
        currentSession: {
            fontSize: 12,
            color: theme.colors.textSecondary,
            textAlign: 'center',
            marginBottom: 16,
            fontStyle: 'italic',
        },
        loadingContainer: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            marginBottom: 16,
        },
        // Results section
        resultsContainer: {
            maxHeight: 200,
            marginBottom: 16,
        },
        resultItem: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 6,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.divider,
        },
        resultItemLast: {
            borderBottomWidth: 0,
        },
        resultIcon: {
            marginRight: 8,
        },
        resultText: {
            flex: 1,
            fontSize: 13,
            color: theme.colors.text,
        },
        resultError: {
            fontSize: 11,
            color: theme.colors.textSecondary,
            marginTop: 2,
        },
        // Buttons
        buttonContainer: {
            borderTopWidth: 1,
            borderTopColor: theme.colors.divider,
            flexDirection: 'row',
        },
        button: {
            flex: 1,
            paddingVertical: 12,
            alignItems: 'center',
            justifyContent: 'center',
        },
        buttonPressed: {
            backgroundColor: theme.colors.divider,
        },
        buttonText: {
            fontSize: 17,
            color: theme.colors.textLink,
        },
        cancelText: {
            color: '#FF3B30',
        },
        summaryTitle: {
            fontSize: 15,
            color: theme.colors.text,
            marginBottom: 12,
            textAlign: 'center',
        },
    });

    // Render results list when done
    const renderResults = () => {
        if (!isDone || progress.results.length === 0) return null;

        // Show failures first, then successes
        const sortedResults = [...progress.results].sort((a, b) => {
            if (a.success === b.success) return 0;
            return a.success ? 1 : -1;
        });

        return (
            <View>
                <Text style={[styles.summaryTitle, Typography.default('semiBold')]}>
                    {t('bulkRestore.results')}
                </Text>
                <ScrollView style={styles.resultsContainer}>
                    {sortedResults.map((result, index) => (
                        <View
                            key={result.sessionId}
                            style={[
                                styles.resultItem,
                                index === sortedResults.length - 1 && styles.resultItemLast,
                            ]}
                        >
                            <Ionicons
                                name={result.success ? 'checkmark-circle' : 'close-circle'}
                                size={18}
                                color={result.success ? '#34C759' : '#FF3B30'}
                                style={styles.resultIcon}
                            />
                            <View style={{ flex: 1 }}>
                                <Text style={styles.resultText} numberOfLines={1}>
                                    {result.sessionName}
                                </Text>
                                {result.error && (
                                    <Text style={styles.resultError} numberOfLines={1}>
                                        {result.error}
                                    </Text>
                                )}
                            </View>
                        </View>
                    ))}
                </ScrollView>
            </View>
        );
    };

    return (
        <BaseModal visible={true} onClose={isDone ? onClose : undefined} closeOnBackdrop={isDone}>
            <View style={styles.container}>
                <View style={styles.content}>
                    <Text style={[styles.title, Typography.default('semiBold')]}>
                        {isDone
                            ? t('bulkRestore.complete')
                            : progress.cancelled
                                ? t('bulkRestore.cancelling')
                                : t('bulkRestore.restoring')}
                    </Text>

                    {/* Progress bar */}
                    <View style={styles.progressContainer}>
                        <View style={styles.progressBar}>
                            <View style={[styles.progressFill, { width: `${percentage}%` }]} />
                        </View>
                        <Text style={[styles.progressText, Typography.default()]}>
                            {t('bulkRestore.progressText', {
                                completed: progress.completed,
                                total: progress.total,
                            })}
                        </Text>
                    </View>

                    {/* Status counts */}
                    <View style={styles.statusContainer}>
                        <View style={styles.statusItem}>
                            <Ionicons name="checkmark-circle" size={16} color="#34C759" />
                            <Text style={[styles.statusText, styles.successText, Typography.default()]}>
                                {progress.succeeded}
                            </Text>
                        </View>
                        <View style={styles.statusItem}>
                            <Ionicons name="close-circle" size={16} color="#FF3B30" />
                            <Text style={[styles.statusText, styles.failText, Typography.default()]}>
                                {progress.failed}
                            </Text>
                        </View>
                    </View>

                    {/* Current session or loading */}
                    {isRestoring && !progress.cancelled && (
                        <View style={styles.loadingContainer}>
                            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                            {progress.currentSession && (
                                <Text style={[styles.currentSession, Typography.default()]} numberOfLines={1}>
                                    {progress.currentSession}
                                </Text>
                            )}
                        </View>
                    )}

                    {/* Results when done */}
                    {renderResults()}
                </View>

                {/* Action buttons */}
                <View style={styles.buttonContainer}>
                    {isDone ? (
                        <Pressable
                            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
                            onPress={onClose}
                        >
                            <Text style={[styles.buttonText, Typography.default('semiBold')]}>
                                {t('common.ok')}
                            </Text>
                        </Pressable>
                    ) : (
                        <Pressable
                            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
                            onPress={onCancel}
                            disabled={progress.cancelled}
                        >
                            <Text style={[styles.buttonText, styles.cancelText, Typography.default('semiBold')]}>
                                {progress.cancelled ? t('bulkRestore.cancelling') : t('common.cancel')}
                            </Text>
                        </Pressable>
                    )}
                </View>
            </View>
        </BaseModal>
    );
});
