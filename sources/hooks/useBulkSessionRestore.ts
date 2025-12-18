/**
 * useBulkSessionRestore - Bulk restore logic for multiple archived sessions
 *
 * Handles batch restoration of archived Claude sessions with:
 * - Rate limiting (max 3 concurrent operations)
 * - Progress tracking with real-time updates
 * - Partial failure support (some succeed, some fail)
 * - Cancellation support
 *
 * Uses the existing machineSpawnNewSession with sessionId to resume sessions.
 * Only Claude sessions support restore (Codex doesn't have --resume).
 *
 * @example
 * const { restore, progress, isRestoring, cancel } = useBulkSessionRestore();
 * await restore(sessions); // Sessions to restore
 */
import * as React from 'react';
import { machineSpawnNewSession, SpawnSessionResult } from '@/sync/ops';
import { Session } from '@/sync/storageTypes';
import { useAllMachines } from '@/sync/storage';
import { isMachineOnline } from '@/utils/machineUtils';
import { t } from '@/text';

/** Maximum concurrent restore operations to avoid overwhelming the server */
const MAX_CONCURRENT = 3;

/** Timeout for individual restore operation in milliseconds */
const RESTORE_TIMEOUT = 30000;

export interface RestoreResult {
    sessionId: string;
    sessionName: string;
    success: boolean;
    newSessionId?: string;
    error?: string;
}

export interface BulkRestoreProgress {
    /** Total number of sessions to restore */
    total: number;
    /** Number of sessions processed so far */
    completed: number;
    /** Number of successful restores */
    succeeded: number;
    /** Number of failed restores */
    failed: number;
    /** Currently processing session name (for display) */
    currentSession?: string;
    /** Whether the operation was cancelled */
    cancelled: boolean;
    /** All results (populated as they complete) */
    results: RestoreResult[];
}

export interface UseBulkSessionRestoreReturn {
    /** Execute bulk restore on the given sessions */
    restore: (sessions: Session[]) => Promise<RestoreResult[]>;
    /** Current progress state */
    progress: BulkRestoreProgress | null;
    /** Whether a restore operation is in progress */
    isRestoring: boolean;
    /** Cancel the current restore operation */
    cancel: () => void;
    /** Reset progress state */
    reset: () => void;
}

/**
 * Gets a display name for a session
 */
function getSessionDisplayName(session: Session): string {
    return session.metadata?.path?.split('/').pop() || session.id.slice(0, 8);
}

/**
 * Creates a promise that rejects after the specified timeout
 */
function withTimeout<T>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(errorMessage)), ms)
        ),
    ]);
}

export function useBulkSessionRestore(): UseBulkSessionRestoreReturn {
    const machines = useAllMachines();
    const [progress, setProgress] = React.useState<BulkRestoreProgress | null>(null);
    const [isRestoring, setIsRestoring] = React.useState(false);
    const cancelledRef = React.useRef(false);

    const cancel = React.useCallback(() => {
        cancelledRef.current = true;
        setProgress(prev => prev ? { ...prev, cancelled: true } : null);
    }, []);

    const reset = React.useCallback(() => {
        setProgress(null);
        setIsRestoring(false);
        cancelledRef.current = false;
    }, []);

    const restore = React.useCallback(async (sessions: Session[]): Promise<RestoreResult[]> => {
        if (sessions.length === 0) return [];

        cancelledRef.current = false;
        setIsRestoring(true);

        // Initialize progress
        const initialProgress: BulkRestoreProgress = {
            total: sessions.length,
            completed: 0,
            succeeded: 0,
            failed: 0,
            currentSession: getSessionDisplayName(sessions[0]),
            cancelled: false,
            results: [],
        };
        setProgress(initialProgress);

        const results: RestoreResult[] = [];

        // Process sessions in batches to limit concurrency
        for (let i = 0; i < sessions.length; i += MAX_CONCURRENT) {
            if (cancelledRef.current) break;

            const batch = sessions.slice(i, i + MAX_CONCURRENT);

            // Process batch concurrently
            const batchPromises = batch.map(async (session): Promise<RestoreResult> => {
                const sessionName = getSessionDisplayName(session);

                // Update current session being processed
                setProgress(prev => prev ? {
                    ...prev,
                    currentSession: sessionName,
                } : null);

                // Check if cancelled
                if (cancelledRef.current) {
                    return {
                        sessionId: session.id,
                        sessionName,
                        success: false,
                        error: t('bulkRestore.cancelledByUser'),
                    };
                }

                // Validate session can be restored
                const isClaudeSession = !session.metadata?.flavor || session.metadata.flavor === 'claude';
                if (!isClaudeSession) {
                    return {
                        sessionId: session.id,
                        sessionName,
                        success: false,
                        error: t('sessionHistory.resumeClaudeOnly'),
                    };
                }

                if (!session.metadata?.machineId || !session.metadata?.path) {
                    return {
                        sessionId: session.id,
                        sessionName,
                        success: false,
                        error: t('sessionInfo.failedToRestoreSession'),
                    };
                }

                // Check machine is online
                const machine = machines.find(m => m.id === session.metadata?.machineId);
                if (!machine || !isMachineOnline(machine)) {
                    return {
                        sessionId: session.id,
                        sessionName,
                        success: false,
                        error: t('sessionInfo.restoreRequiresMachine'),
                    };
                }

                try {
                    // Attempt restore with timeout
                    const result = await withTimeout<SpawnSessionResult>(
                        machineSpawnNewSession({
                            machineId: session.metadata.machineId,
                            directory: session.metadata.path,
                            agent: 'claude',
                            sessionId: session.id,
                        }),
                        RESTORE_TIMEOUT,
                        t('newSession.sessionTimeout')
                    );

                    if (result.type === 'success') {
                        return {
                            sessionId: session.id,
                            sessionName,
                            success: true,
                            newSessionId: result.sessionId,
                        };
                    } else if (result.type === 'error') {
                        return {
                            sessionId: session.id,
                            sessionName,
                            success: false,
                            error: result.errorMessage,
                        };
                    } else {
                        // requestToApproveDirectoryCreation - shouldn't happen for restore
                        return {
                            sessionId: session.id,
                            sessionName,
                            success: false,
                            error: t('sessionInfo.failedToRestoreSession'),
                        };
                    }
                } catch (error) {
                    return {
                        sessionId: session.id,
                        sessionName,
                        success: false,
                        error: error instanceof Error ? error.message : t('errors.unknownError'),
                    };
                }
            });

            // Wait for batch to complete
            const batchResults = await Promise.all(batchPromises);

            // Update progress with batch results
            for (const result of batchResults) {
                results.push(result);
                setProgress(prev => {
                    if (!prev) return null;
                    return {
                        ...prev,
                        completed: prev.completed + 1,
                        succeeded: prev.succeeded + (result.success ? 1 : 0),
                        failed: prev.failed + (result.success ? 0 : 1),
                        results: [...prev.results, result],
                    };
                });
            }
        }

        // Mark as complete
        setProgress(prev => prev ? {
            ...prev,
            currentSession: undefined,
        } : null);
        setIsRestoring(false);

        return results;
    }, [machines]);

    return {
        restore,
        progress,
        isRestoring,
        cancel,
        reset,
    };
}
