/**
 * Session operations for remote procedure calls
 * Provides strictly typed functions for all session-related RPC operations
 */

import { apiSocket } from './apiSocket';
import { sync } from './sync';
import { storage } from './storage';
import type { MachineMetadata } from './storageTypes';
import { AppError, ErrorCodes } from '@/utils/errors';

// Strict type definitions for all operations

// Permission operation types
interface SessionPermissionRequest {
    id: string;
    approved: boolean;
    reason?: string;
    mode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
    allowTools?: string[];
    decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
}

// Mode change operation types
interface SessionModeChangeRequest {
    to: 'remote' | 'local';
}

// Bash operation types
interface SessionBashRequest {
    command: string;
    cwd?: string;
    timeout?: number;
}

interface SessionBashResponse {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
    error?: string;
}

// Read file operation types
interface SessionReadFileRequest {
    path: string;
}

interface SessionReadFileResponse {
    success: boolean;
    content?: string; // base64 encoded
    error?: string;
}

// Write file operation types
interface SessionWriteFileRequest {
    path: string;
    content: string; // base64 encoded
    expectedHash?: string | null;
}

interface SessionWriteFileResponse {
    success: boolean;
    hash?: string;
    error?: string;
}

// List directory operation types
interface SessionListDirectoryRequest {
    path: string;
}

interface DirectoryEntry {
    name: string;
    type: 'file' | 'directory' | 'other';
    size?: number;
    modified?: number;
}

interface SessionListDirectoryResponse {
    success: boolean;
    entries?: DirectoryEntry[];
    error?: string;
}

// Directory tree operation types
interface SessionGetDirectoryTreeRequest {
    path: string;
    maxDepth: number;
}

interface TreeNode {
    name: string;
    path: string;
    type: 'file' | 'directory';
    size?: number;
    modified?: number;
    children?: TreeNode[];
}

interface SessionGetDirectoryTreeResponse {
    success: boolean;
    tree?: TreeNode;
    error?: string;
}

// Ripgrep operation types
interface SessionRipgrepRequest {
    args: string[];
    cwd?: string;
}

interface SessionRipgrepResponse {
    success: boolean;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    error?: string;
}

// Kill session operation types
interface _SessionKillRequest {
    // No parameters needed
}

interface SessionKillResponse {
    success: boolean;
    message: string;
}

// Response types for spawn session
export type SpawnSessionResult =
    | { type: 'success'; sessionId: string; message?: string }
    | { type: 'requestToApproveDirectoryCreation'; directory: string }
    | { type: 'error'; errorMessage: string };

/**
 * Check if a session ID is a temporary PID-based ID from the daemon
 * (returned when session webhook times out but process was spawned)
 */
export function isTemporaryPidSessionId(sessionId: string): boolean {
    return sessionId.startsWith('PID-');
}

/**
 * Options for polling for a real session after temporary PID-based ID was returned
 */
export interface PollForSessionOptions {
    /** Polling interval in milliseconds (default: 5000) */
    interval?: number;
    /** Maximum number of polling attempts (default: 24, = 2 minutes with 5s interval) */
    maxAttempts?: number;
    /** Callback invoked on each poll attempt (for UI updates) */
    onPoll?: (attempt: number, maxAttempts: number) => void;
}

/**
 * Polls for a real session ID after daemon returned a temporary PID-based ID.
 *
 * When the daemon's webhook times out, it returns a PID-{pid} session ID.
 * The actual session may still be starting. This function polls the session list
 * waiting for a real session to appear on the specified machine.
 *
 * @param machineId - The machine where the session was spawned
 * @param spawnStartTime - Timestamp when spawn was initiated (sessions created after this are considered)
 * @param options - Polling configuration
 * @returns The real session ID if found, null if polling timed out
 */
export async function pollForRealSession(
    machineId: string,
    spawnStartTime: number,
    options: PollForSessionOptions = {}
): Promise<string | null> {
    const { interval = 5000, maxAttempts = 24, onPoll } = options;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // Wait before polling (skip first iteration to allow immediate check)
        if (attempt > 0) {
            await new Promise(resolve => setTimeout(resolve, interval));
        }

        // Notify caller of progress
        onPoll?.(attempt + 1, maxAttempts);

        // Refresh sessions from server
        await sync.refreshSessions();

        // Check for new session on this machine created after spawn start
        const sessions = storage.getState().sessions;
        const newSession = Object.values(sessions).find(
            session =>
                session.metadata?.machineId === machineId &&
                session.createdAt > spawnStartTime
        );

        if (newSession) {
            return newSession.id;
        }
    }

    // Polling timed out - session never appeared
    return null;
}

// Options for spawning a session
export interface SpawnSessionOptions {
    machineId: string;
    directory: string;
    approvedNewDirectoryCreation?: boolean;
    token?: string;
    agent?: 'codex' | 'claude' | 'gemini';
    /**
     * Optional session ID to resume from. When provided with agent: 'claude',
     * the daemon passes --resume <sessionId> to Claude, which creates a NEW
     * session with the full conversation history from the original session.
     * Note: Codex does not support --resume, this parameter is ignored for Codex.
     */
    sessionId?: string;
}

// Exported session operation functions

// Session spawning can take 60-90+ seconds on cold starts (Claude auth, network, etc.)
// This timeout must be longer than the daemon's HAPPY_SESSION_SPAWN_TIMEOUT (default 30s)
// to ensure we receive the daemon's graceful fallback response instead of timing out first
const SESSION_SPAWN_TIMEOUT_MS = 90000;

/**
 * Spawn a new remote session on a specific machine.
 * If sessionId is provided with agent: 'claude', the session will be resumed
 * (forked) from the original session, preserving conversation history.
 */
export async function machineSpawnNewSession(options: SpawnSessionOptions): Promise<SpawnSessionResult> {

    const { machineId, directory, approvedNewDirectoryCreation = false, token, agent, sessionId } = options;

    try {
        const result = await apiSocket.machineRPC<SpawnSessionResult, {
            type: 'spawn-in-directory'
            directory: string
            approvedNewDirectoryCreation?: boolean,
            token?: string,
            agent?: 'codex' | 'claude' | 'gemini',
            sessionId?: string
        }>(
            machineId,
            'spawn-happy-session',
            { type: 'spawn-in-directory', directory, approvedNewDirectoryCreation, token, agent, sessionId },
            { timeout: SESSION_SPAWN_TIMEOUT_MS }
        );
        return result;
    } catch (error) {
        // Handle RPC errors
        return {
            type: 'error',
            errorMessage: error instanceof Error ? error.message : 'Failed to spawn session'
        };
    }
}

/**
 * Stop the daemon on a specific machine
 */
export async function machineStopDaemon(machineId: string): Promise<{ message: string }> {
    const result = await apiSocket.machineRPC<{ message: string }, {}>(
        machineId,
        'stop-daemon',
        {}
    );
    return result;
}

/**
 * Execute a bash command on a specific machine
 */
export async function machineBash(
    machineId: string,
    command: string,
    cwd: string
): Promise<{
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
}> {
    try {
        const result = await apiSocket.machineRPC<{
            success: boolean;
            stdout: string;
            stderr: string;
            exitCode: number;
        }, {
            command: string;
            cwd: string;
        }>(
            machineId,
            'bash',
            { command, cwd }
        );
        return result;
    } catch (error) {
        return {
            success: false,
            stdout: '',
            stderr: error instanceof Error ? error.message : 'Unknown error',
            exitCode: -1
        };
    }
}

/**
 * Update machine metadata with optimistic concurrency control and automatic retry
 */
export async function machineUpdateMetadata(
    machineId: string,
    metadata: MachineMetadata,
    expectedVersion: number,
    maxRetries: number = 3
): Promise<{ version: number; metadata: string }> {
    let currentVersion = expectedVersion;
    let currentMetadata = { ...metadata };
    let retryCount = 0;

    const machineEncryption = sync.encryption.getMachineEncryption(machineId);
    if (!machineEncryption) {
        throw new AppError(ErrorCodes.NOT_FOUND, `Machine encryption not found for ${machineId}`);
    }

    while (retryCount < maxRetries) {
        const encryptedMetadata = await machineEncryption.encryptRaw(currentMetadata);

        const result = await apiSocket.emitWithAck<{
            result: 'success' | 'version-mismatch' | 'error';
            version?: number;
            metadata?: string;
            message?: string;
        }>('machine-update-metadata', {
            machineId,
            metadata: encryptedMetadata,
            expectedVersion: currentVersion
        });

        if (result.result === 'success') {
            return {
                version: result.version!,
                metadata: result.metadata!
            };
        } else if (result.result === 'version-mismatch') {
            // Get the latest version and metadata from the response
            currentVersion = result.version!;
            const latestMetadata = await machineEncryption.decryptRaw(result.metadata!) as MachineMetadata;

            // Merge our changes with the latest metadata
            // Preserve the displayName we're trying to set, but use latest values for other fields
            currentMetadata = {
                ...latestMetadata,
                displayName: metadata.displayName // Keep our intended displayName change
            };

            retryCount++;

            // If we've exhausted retries, throw error
            if (retryCount >= maxRetries) {
                throw new AppError(ErrorCodes.VERSION_CONFLICT, `Failed to update after ${maxRetries} retries due to version conflicts`);
            }

            // Otherwise, loop will retry with updated version and merged metadata
        } else {
            throw new AppError(ErrorCodes.API_ERROR, result.message || 'Failed to update machine metadata');
        }
    }

    throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Unexpected error in machineUpdateMetadata');
}

/**
 * Abort the current session operation
 */
export async function sessionAbort(sessionId: string): Promise<void> {
    await apiSocket.sessionRPC(sessionId, 'abort', {
        reason: `The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.`
    });
}

/**
 * Allow a permission request
 */
export async function sessionAllow(sessionId: string, id: string, mode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan', allowedTools?: string[], decision?: 'approved' | 'approved_for_session'): Promise<void> {
    const request: SessionPermissionRequest = { id, approved: true, mode, allowTools: allowedTools, decision };
    await apiSocket.sessionRPC(sessionId, 'permission', request);
}

/**
 * Deny a permission request
 */
export async function sessionDeny(sessionId: string, id: string, mode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan', allowedTools?: string[], decision?: 'denied' | 'abort'): Promise<void> {
    const request: SessionPermissionRequest = { id, approved: false, mode, allowTools: allowedTools, decision };
    await apiSocket.sessionRPC(sessionId, 'permission', request);
}

/**
 * Request mode change for a session
 */
export async function sessionSwitch(sessionId: string, to: 'remote' | 'local'): Promise<boolean> {
    const request: SessionModeChangeRequest = { to };
    const response = await apiSocket.sessionRPC<boolean, SessionModeChangeRequest>(
        sessionId,
        'switch',
        request,
    );
    return response;
}

/**
 * Execute a bash command in the session
 */
export async function sessionBash(sessionId: string, request: SessionBashRequest): Promise<SessionBashResponse> {
    try {
        const response = await apiSocket.sessionRPC<SessionBashResponse, SessionBashRequest>(
            sessionId,
            'bash',
            request
        );
        return response;
    } catch (error) {
        return {
            success: false,
            stdout: '',
            stderr: error instanceof Error ? error.message : 'Unknown error',
            exitCode: -1,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Read a file from the session
 */
export async function sessionReadFile(sessionId: string, path: string): Promise<SessionReadFileResponse> {
    try {
        const request: SessionReadFileRequest = { path };
        const response = await apiSocket.sessionRPC<SessionReadFileResponse, SessionReadFileRequest>(
            sessionId,
            'readFile',
            request
        );
        return response;
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Write a file to the session
 */
export async function sessionWriteFile(
    sessionId: string,
    path: string,
    content: string,
    expectedHash?: string | null
): Promise<SessionWriteFileResponse> {
    try {
        const request: SessionWriteFileRequest = { path, content, expectedHash };
        const response = await apiSocket.sessionRPC<SessionWriteFileResponse, SessionWriteFileRequest>(
            sessionId,
            'writeFile',
            request
        );
        return response;
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * List directory contents in the session
 */
export async function sessionListDirectory(sessionId: string, path: string): Promise<SessionListDirectoryResponse> {
    try {
        const request: SessionListDirectoryRequest = { path };
        const response = await apiSocket.sessionRPC<SessionListDirectoryResponse, SessionListDirectoryRequest>(
            sessionId,
            'listDirectory',
            request
        );
        return response;
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Get directory tree from the session
 */
export async function sessionGetDirectoryTree(
    sessionId: string,
    path: string,
    maxDepth: number
): Promise<SessionGetDirectoryTreeResponse> {
    try {
        const request: SessionGetDirectoryTreeRequest = { path, maxDepth };
        const response = await apiSocket.sessionRPC<SessionGetDirectoryTreeResponse, SessionGetDirectoryTreeRequest>(
            sessionId,
            'getDirectoryTree',
            request
        );
        return response;
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Run ripgrep in the session
 */
export async function sessionRipgrep(
    sessionId: string,
    args: string[],
    cwd?: string
): Promise<SessionRipgrepResponse> {
    try {
        const request: SessionRipgrepRequest = { args, cwd };
        const response = await apiSocket.sessionRPC<SessionRipgrepResponse, SessionRipgrepRequest>(
            sessionId,
            'ripgrep',
            request
        );
        return response;
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Helper to wait for a session to go offline.
 * Resolves when session presence changes from "online" to a timestamp.
 * Used by sessionKill to detect when CLI disconnects after killing Claude Code.
 *
 * @param sessionId - The session ID to monitor
 * @param timeoutMs - Maximum time to wait before rejecting
 * @returns Promise that resolves when session goes offline
 */
function waitForSessionOffline(sessionId: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const session = storage.getState().sessions[sessionId];

        // Already offline - resolve immediately
        if (!session || session.presence !== "online") {
            resolve();
            return;
        }

        let unsubscribe: (() => void) | null = null;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
            if (timer) clearTimeout(timer);
            if (unsubscribe) unsubscribe();
        };

        // Set up timeout
        timer = setTimeout(() => {
            cleanup();
            reject(new Error('Timeout waiting for session offline'));
        }, timeoutMs);

        // Subscribe to state changes
        unsubscribe = storage.subscribe((state) => {
            const currentSession = state.sessions[sessionId];
            if (!currentSession || currentSession.presence !== "online") {
                cleanup();
                resolve();
            }
        });
    });
}

// Result types for the race between RPC and offline detection
type RaceResult =
    | { type: 'offline' }
    | { type: 'offline-timeout' }
    | { type: 'rpc'; response: SessionKillResponse }
    | { type: 'rpc-error'; error: unknown };

/**
 * Kill the session process immediately.
 *
 * Uses a race condition pattern to handle the case where CLI disconnects
 * before sending an RPC acknowledgement (HAP-575). This happens because:
 * 1. killSession RPC is sent to CLI
 * 2. CLI terminates Claude Code process
 * 3. CLI disconnects from WebSocket (session goes offline)
 * 4. RPC ack is never sent because connection is severed
 *
 * Solution: Race the RPC response against session state change.
 * If session goes offline during the RPC call, treat as success.
 */
export async function sessionKill(sessionId: string): Promise<SessionKillResponse> {
    // Check if already offline - nothing to kill
    const session = storage.getState().sessions[sessionId];
    if (!session || session.presence !== "online") {
        return { success: true, message: 'Session already offline' };
    }

    // Race the RPC call against session going offline
    // Use 15 second timeout for offline detection (less than 30s RPC timeout)
    const offlinePromise: Promise<RaceResult> = waitForSessionOffline(sessionId, 15000)
        .then(() => ({ type: 'offline' as const }))
        .catch(() => ({ type: 'offline-timeout' as const }));

    const rpcPromise: Promise<RaceResult> = apiSocket.sessionRPC<SessionKillResponse, {}>(
        sessionId,
        'killSession',
        {}
    )
        .then((response) => ({ type: 'rpc' as const, response }))
        .catch((error) => ({ type: 'rpc-error' as const, error }));

    const result = await Promise.race([offlinePromise, rpcPromise]);

    if (result.type === 'offline') {
        // Session went offline - CLI disconnected after killing, treat as success
        return { success: true, message: 'Session terminated' };
    }

    if (result.type === 'rpc') {
        // RPC responded (unlikely for killSession, but handle it)
        return result.response;
    }

    if (result.type === 'rpc-error') {
        // RPC failed - check if session went offline during the error
        const currentSession = storage.getState().sessions[sessionId];
        if (!currentSession || currentSession.presence !== "online") {
            // Session went offline, so kill succeeded despite RPC timeout
            return { success: true, message: 'Session terminated' };
        }
        // Genuine error - session still online
        return {
            success: false,
            message: result.error instanceof Error ? result.error.message : 'Unknown error'
        };
    }

    // Offline timeout occurred - wait for RPC to complete
    const rpcResult = await rpcPromise;
    if (rpcResult.type === 'rpc') {
        return rpcResult.response;
    }

    // Check one more time if session went offline
    const finalSession = storage.getState().sessions[sessionId];
    if (!finalSession || finalSession.presence !== "online") {
        return { success: true, message: 'Session terminated' };
    }

    return {
        success: false,
        message: rpcResult.type === 'rpc-error' && rpcResult.error instanceof Error
            ? rpcResult.error.message
            : 'Unknown error'
    };
}

/**
 * Permanently delete a session from the server
 * This will remove the session and all its associated data (messages, usage reports, access keys)
 * The session should be inactive/archived before deletion
 *
 * Note: After successful deletion, the session is immediately removed from local storage
 * (optimistic update) rather than waiting for the socket delete-session event. This ensures
 * the UI updates immediately even if the socket connection has issues.
 */
export async function sessionDelete(sessionId: string): Promise<{ success: boolean; message?: string }> {
    try {
        // HAP-589: Use requestWithCorrelation to include correlation ID in logs
        const { response, shortId } = await apiSocket.requestWithCorrelation(`/v1/sessions/${sessionId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            const _result = await response.json();
            console.log(`🗑️ sessionDelete [${shortId}]: Successfully deleted session ${sessionId}`);

            // Optimistic update: immediately remove from local storage
            // This ensures the UI updates even if the socket delete-session event is delayed/dropped
            const { storage } = await import('./storage');
            storage.getState().deleteSession(sessionId);

            // Also clean up encryption keys and project manager
            sync.encryption.removeSessionEncryption(sessionId);
            const { projectManager } = await import('./projectManager');
            projectManager.removeSession(sessionId);
            const { gitStatusSync } = await import('./gitStatusSync');
            gitStatusSync.clearForSession(sessionId);
            // HAP-499: Clear file search cache
            const { fileSearchCache } = await import('./suggestionFile');
            fileSearchCache.clearCache(sessionId);

            return { success: true };
        } else {
            const error = await response.text();
            console.log(`🗑️ sessionDelete [${shortId}]: Failed to delete session ${sessionId}: ${error || 'Unknown error'}`);
            return {
                success: false,
                message: error || 'Failed to delete session'
            };
        }
    } catch (error) {
        // Note: shortId not available here since requestWithCorrelation threw
        // The correlation ID is still stored via setLastFailedCorrelationId for error UI
        console.log(`🗑️ sessionDelete: Failed to delete session ${sessionId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return {
            success: false,
            message: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Clear conversation context for a session
 * This sends the /clear command which resets the session context,
 * starting fresh while maintaining the current working state.
 * @param sessionId - The session ID to clear context for
 */
export async function sessionClearContext(sessionId: string): Promise<void> {
    const { sync } = await import('./sync');
    await sync.sendMessage(sessionId, '/clear');
}

/**
 * Compact/summarize conversation context for a session
 * This sends the /compact command which compresses the conversation
 * history into a summary to reduce context usage.
 * @param sessionId - The session ID to compact context for
 */
export async function sessionCompactContext(sessionId: string): Promise<void> {
    const { sync } = await import('./sync');
    await sync.sendMessage(sessionId, '/compact');
}

// Export types for external use
export type {
    SessionBashRequest,
    SessionBashResponse,
    SessionReadFileResponse,
    SessionWriteFileResponse,
    SessionListDirectoryResponse,
    DirectoryEntry,
    SessionGetDirectoryTreeResponse,
    TreeNode,
    SessionRipgrepResponse,
    SessionKillResponse
};