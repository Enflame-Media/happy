import { createMMKV } from 'react-native-mmkv';
import { Settings, settingsDefaults, settingsParse, SettingsSchema } from './settings';
import { LocalSettings, localSettingsDefaults, localSettingsParse } from './localSettings';
import { Purchases, purchasesDefaults, purchasesParse } from './purchases';
import { Profile, profileDefaults, profileParse } from './profile';
import type { PermissionMode } from '@/components/PermissionModeSelector';

const mmkv = createMMKV();
const NEW_SESSION_DRAFT_KEY = 'new-session-draft-v1';

export type NewSessionAgentType = 'claude' | 'codex' | 'gemini';
export type NewSessionSessionType = 'simple' | 'worktree';

export interface NewSessionDraft {
    input: string;
    selectedMachineId: string | null;
    selectedPath: string | null;
    agentType: NewSessionAgentType;
    permissionMode: PermissionMode;
    sessionType: NewSessionSessionType;
    updatedAt: number;
}

export function loadSettings(): { settings: Settings, version: number | null } {
    const settings = mmkv.getString('settings');
    if (settings) {
        try {
            const parsed = JSON.parse(settings);
            return { settings: settingsParse(parsed.settings), version: parsed.version };
        } catch (e) {
            console.error('Failed to parse settings', e);
            return { settings: { ...settingsDefaults }, version: null };
        }
    }
    return { settings: { ...settingsDefaults }, version: null };
}

export function saveSettings(settings: Settings, version: number) {
    mmkv.set('settings', JSON.stringify({ settings, version }));
}

export function loadPendingSettings(): Partial<Settings> {
    const pending = mmkv.getString('pending-settings');
    if (pending) {
        try {
            const parsed = JSON.parse(pending);
            return SettingsSchema.partial().parse(parsed);
        } catch (e) {
            console.error('Failed to parse pending settings', e);
            return {};
        }
    }
    return {};
}

export function savePendingSettings(settings: Partial<Settings>) {
    mmkv.set('pending-settings', JSON.stringify(settings));
}

export function loadLocalSettings(): LocalSettings {
    const localSettings = mmkv.getString('local-settings');
    if (localSettings) {
        try {
            const parsed = JSON.parse(localSettings);
            return localSettingsParse(parsed);
        } catch (e) {
            console.error('Failed to parse local settings', e);
            return { ...localSettingsDefaults };
        }
    }
    return { ...localSettingsDefaults };
}

export function saveLocalSettings(settings: LocalSettings) {
    mmkv.set('local-settings', JSON.stringify(settings));
}

export function loadThemePreference(): 'light' | 'dark' | 'adaptive' {
    const localSettings = mmkv.getString('local-settings');
    if (localSettings) {
        try {
            const parsed = JSON.parse(localSettings);
            const settings = localSettingsParse(parsed);
            return settings.themePreference;
        } catch (e) {
            console.error('Failed to parse local settings for theme preference', e);
            return localSettingsDefaults.themePreference;
        }
    }
    return localSettingsDefaults.themePreference;
}

export function loadPurchases(): Purchases {
    const purchases = mmkv.getString('purchases');
    if (purchases) {
        try {
            const parsed = JSON.parse(purchases);
            return purchasesParse(parsed);
        } catch (e) {
            console.error('Failed to parse purchases', e);
            return { ...purchasesDefaults };
        }
    }
    return { ...purchasesDefaults };
}

export function savePurchases(purchases: Purchases) {
    mmkv.set('purchases', JSON.stringify(purchases));
}

export function loadSessionDrafts(): Record<string, string> {
    const drafts = mmkv.getString('session-drafts');
    if (drafts) {
        try {
            return JSON.parse(drafts);
        } catch (e) {
            console.error('Failed to parse session drafts', e);
            return {};
        }
    }
    return {};
}

export function saveSessionDrafts(drafts: Record<string, string>) {
    mmkv.set('session-drafts', JSON.stringify(drafts));
}

export function loadNewSessionDraft(): NewSessionDraft | null {
    const raw = mmkv.getString(NEW_SESSION_DRAFT_KEY);
    if (!raw) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }

        const input = typeof parsed.input === 'string' ? parsed.input : '';
        const selectedMachineId = typeof parsed.selectedMachineId === 'string' ? parsed.selectedMachineId : null;
        const selectedPath = typeof parsed.selectedPath === 'string' ? parsed.selectedPath : null;
        const agentType: NewSessionAgentType = parsed.agentType === 'codex' || parsed.agentType === 'gemini'
            ? parsed.agentType
            : 'claude';
        const permissionMode: PermissionMode = typeof parsed.permissionMode === 'string'
            ? (parsed.permissionMode as PermissionMode)
            : 'default';
        const sessionType: NewSessionSessionType = parsed.sessionType === 'worktree' ? 'worktree' : 'simple';
        const updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now();

        return {
            input,
            selectedMachineId,
            selectedPath,
            agentType,
            permissionMode,
            sessionType,
            updatedAt,
        };
    } catch (e) {
        console.error('Failed to parse new session draft', e);
        return null;
    }
}

export function saveNewSessionDraft(draft: NewSessionDraft) {
    mmkv.set(NEW_SESSION_DRAFT_KEY, JSON.stringify(draft));
}

export function clearNewSessionDraft() {
    mmkv.remove(NEW_SESSION_DRAFT_KEY);
}

export function loadSessionPermissionModes(): Record<string, PermissionMode> {
    const modes = mmkv.getString('session-permission-modes');
    if (modes) {
        try {
            return JSON.parse(modes);
        } catch (e) {
            console.error('Failed to parse session permission modes', e);
            return {};
        }
    }
    return {};
}

export function saveSessionPermissionModes(modes: Record<string, PermissionMode>) {
    mmkv.set('session-permission-modes', JSON.stringify(modes));
}

export function loadProfile(): Profile {
    const profile = mmkv.getString('profile');
    if (profile) {
        try {
            const parsed = JSON.parse(profile);
            return profileParse(parsed);
        } catch (e) {
            console.error('Failed to parse profile', e);
            return { ...profileDefaults };
        }
    }
    return { ...profileDefaults };
}

export function saveProfile(profile: Profile) {
    mmkv.set('profile', JSON.stringify(profile));
}

// Simple temporary text storage for passing large strings between screens
export function storeTempText(content: string): string {
    const id = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    mmkv.set(`temp_text_${id}`, content);
    return id;
}

export function retrieveTempText(id: string): string | null {
    const content = mmkv.getString(`temp_text_${id}`);
    if (content) {
        // Auto-delete after retrieval
        mmkv.remove(`temp_text_${id}`);
        return content;
    }
    return null;
}

export function clearPersistence() {
    mmkv.clearAll();
}

/**
 * HAP-496: Persisted sync state for incremental sync across app restarts.
 *
 * Stores cursor/sequence tracking data so the app can resume incremental
 * sync instead of doing a full fetch after restart.
 */
export interface PersistedSyncState {
    /** Schema version for migration support */
    version: 1;
    /** When state was last persisted (Unix timestamp) */
    timestamp: number;
    /** Message sequence cursors per session (session ID → last seq) */
    sessionLastSeq: Record<string, number>;
    /** ETag for profile conditional requests */
    profileETag: string | null;
    /** Sequence numbers for entity types (e.g., 'artifacts', 'sessions') */
    entitySeq: Record<string, number>;
}

/** Maximum age for persisted sync state (24 hours in milliseconds) */
const SYNC_STATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * HAP-496: Load persisted sync state from storage.
 *
 * Returns null if:
 * - No state is persisted
 * - State is corrupted/invalid
 * - State is stale (> 24 hours old)
 * - State version is incompatible
 */
export function loadSyncState(): PersistedSyncState | null {
    const stored = mmkv.getString('sync-state');
    if (!stored) {
        return null;
    }

    try {
        const parsed = JSON.parse(stored);

        // Validate version
        if (parsed.version !== 1) {
            console.warn('[HAP-496] Sync state version mismatch, discarding');
            mmkv.remove('sync-state');
            return null;
        }

        // Check freshness (discard if > 24 hours old)
        const age = Date.now() - (parsed.timestamp ?? 0);
        if (age > SYNC_STATE_MAX_AGE_MS) {
            console.log('[HAP-496] Sync state expired, discarding');
            mmkv.remove('sync-state');
            return null;
        }

        // Validate structure
        if (
            typeof parsed.sessionLastSeq !== 'object' ||
            typeof parsed.entitySeq !== 'object' ||
            (parsed.profileETag !== null && typeof parsed.profileETag !== 'string')
        ) {
            console.warn('[HAP-496] Sync state malformed, discarding');
            mmkv.remove('sync-state');
            return null;
        }

        return parsed as PersistedSyncState;
    } catch (e) {
        console.error('[HAP-496] Failed to parse sync state', e);
        mmkv.remove('sync-state');
        return null;
    }
}

/**
 * HAP-496: Save sync state to storage.
 *
 * Called on state updates (debounced) and on app background.
 * Safe to call frequently due to MMKV's efficiency.
 */
export function saveSyncState(state: Omit<PersistedSyncState, 'version' | 'timestamp'>): void {
    try {
        const persisted: PersistedSyncState = {
            version: 1,
            timestamp: Date.now(),
            ...state,
        };
        mmkv.set('sync-state', JSON.stringify(persisted));
    } catch (e) {
        // Storage failure should not break the app - just log and continue
        console.error('[HAP-496] Failed to save sync state', e);
    }
}

/**
 * HAP-496: Clear persisted sync state.
 *
 * Called on logout or when state needs to be reset.
 */
export function clearSyncState(): void {
    mmkv.remove('sync-state');
}

// ============================================================================
// HAP-588: Message Cache Persistence
// ============================================================================

/**
 * Maximum number of messages to persist per session.
 * Limits storage size while keeping enough context for offline viewing.
 */
const MAX_CACHED_MESSAGES_PER_SESSION = 100;

/**
 * Maximum age for cached messages (30 days in milliseconds).
 * Older caches are automatically cleaned up.
 */
const MESSAGE_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Key prefix for message caches.
 */
const MESSAGE_CACHE_PREFIX = '@happy/messages/';

/**
 * Index key for tracking all cached sessions.
 */
const MESSAGE_CACHE_INDEX_KEY = '@happy/messages-index';

/**
 * HAP-588: Structure of persisted message cache.
 */
export interface PersistedMessageCache {
    /** Schema version for migration support */
    version: 1;
    /** When cache was last updated (Unix timestamp) */
    timestamp: number;
    /** Session ID this cache belongs to */
    sessionId: string;
    /** The last known message sequence number */
    lastSeq: number | null;
    /** Cached normalized messages (limited to MAX_CACHED_MESSAGES_PER_SESSION) */
    messages: unknown[]; // NormalizedMessage[] - using unknown to avoid circular imports
}

/**
 * HAP-588: Index of all cached sessions for cleanup purposes.
 */
interface MessageCacheIndex {
    /** Map of session ID → last update timestamp */
    sessions: Record<string, number>;
}

/**
 * HAP-588: Load cached messages for a session.
 *
 * Returns null if:
 * - No cache exists
 * - Cache is corrupted/invalid
 * - Cache is stale (> 30 days old)
 * - Cache version is incompatible
 */
export function loadCachedMessages(sessionId: string): PersistedMessageCache | null {
    const key = `${MESSAGE_CACHE_PREFIX}${sessionId}`;
    const stored = mmkv.getString(key);
    if (!stored) {
        return null;
    }

    try {
        const parsed = JSON.parse(stored);

        // Validate version
        if (parsed.version !== 1) {
            console.warn(`[HAP-588] Message cache version mismatch for ${sessionId}, discarding`);
            mmkv.remove(key);
            return null;
        }

        // Check freshness (discard if > 30 days old)
        const age = Date.now() - (parsed.timestamp ?? 0);
        if (age > MESSAGE_CACHE_MAX_AGE_MS) {
            console.log(`[HAP-588] Message cache expired for ${sessionId}, discarding`);
            mmkv.remove(key);
            removeFromMessageCacheIndex(sessionId);
            return null;
        }

        // Validate structure
        if (
            typeof parsed.sessionId !== 'string' ||
            !Array.isArray(parsed.messages)
        ) {
            console.warn(`[HAP-588] Message cache malformed for ${sessionId}, discarding`);
            mmkv.remove(key);
            removeFromMessageCacheIndex(sessionId);
            return null;
        }

        return parsed as PersistedMessageCache;
    } catch (e) {
        console.error(`[HAP-588] Failed to parse message cache for ${sessionId}`, e);
        mmkv.remove(key);
        removeFromMessageCacheIndex(sessionId);
        return null;
    }
}

/**
 * HAP-588: Save messages to cache for offline access.
 *
 * Only persists the most recent MAX_CACHED_MESSAGES_PER_SESSION messages.
 * Safe to call frequently due to MMKV's efficiency.
 *
 * @param sessionId - The session ID
 * @param messages - Array of normalized messages (newest first expected)
 * @param lastSeq - The highest sequence number in the messages
 */
export function saveCachedMessages(
    sessionId: string,
    messages: unknown[],
    lastSeq: number | null
): void {
    try {
        // Limit to most recent messages
        const limitedMessages = messages.slice(0, MAX_CACHED_MESSAGES_PER_SESSION);

        const cache: PersistedMessageCache = {
            version: 1,
            timestamp: Date.now(),
            sessionId,
            lastSeq,
            messages: limitedMessages,
        };

        const key = `${MESSAGE_CACHE_PREFIX}${sessionId}`;
        mmkv.set(key, JSON.stringify(cache));

        // Update index
        updateMessageCacheIndex(sessionId);

        console.log(`[HAP-588] Saved ${limitedMessages.length} messages to cache for ${sessionId}`);
    } catch (e) {
        // Storage failure should not break the app
        console.error(`[HAP-588] Failed to save message cache for ${sessionId}`, e);
    }
}

/**
 * HAP-588: Clear cached messages for a specific session.
 */
export function clearCachedMessages(sessionId: string): void {
    const key = `${MESSAGE_CACHE_PREFIX}${sessionId}`;
    mmkv.remove(key);
    removeFromMessageCacheIndex(sessionId);
}

/**
 * HAP-588: Clear all cached messages.
 * Called on logout.
 */
export function clearAllCachedMessages(): void {
    const index = loadMessageCacheIndex();
    for (const sessionId of Object.keys(index.sessions)) {
        const key = `${MESSAGE_CACHE_PREFIX}${sessionId}`;
        mmkv.remove(key);
    }
    mmkv.remove(MESSAGE_CACHE_INDEX_KEY);
    console.log('[HAP-588] Cleared all message caches');
}

/**
 * HAP-588: Clean up stale message caches.
 * Removes caches older than 30 days.
 * Should be called periodically (e.g., on app startup).
 */
export function cleanupStaleCaches(): void {
    const index = loadMessageCacheIndex();
    const now = Date.now();
    let cleanedCount = 0;

    for (const [sessionId, timestamp] of Object.entries(index.sessions)) {
        const age = now - timestamp;
        if (age > MESSAGE_CACHE_MAX_AGE_MS) {
            const key = `${MESSAGE_CACHE_PREFIX}${sessionId}`;
            mmkv.remove(key);
            delete index.sessions[sessionId];
            cleanedCount++;
        }
    }

    if (cleanedCount > 0) {
        saveMessageCacheIndex(index);
        console.log(`[HAP-588] Cleaned up ${cleanedCount} stale message caches`);
    }
}

/**
 * HAP-588: Get all cached session IDs.
 * Useful for debugging and cache management.
 */
export function getCachedSessionIds(): string[] {
    const index = loadMessageCacheIndex();
    return Object.keys(index.sessions);
}

// Internal helpers for message cache index

function loadMessageCacheIndex(): MessageCacheIndex {
    const stored = mmkv.getString(MESSAGE_CACHE_INDEX_KEY);
    if (!stored) {
        return { sessions: {} };
    }
    try {
        const parsed = JSON.parse(stored);
        if (typeof parsed.sessions !== 'object') {
            return { sessions: {} };
        }
        return parsed as MessageCacheIndex;
    } catch {
        return { sessions: {} };
    }
}

function saveMessageCacheIndex(index: MessageCacheIndex): void {
    try {
        mmkv.set(MESSAGE_CACHE_INDEX_KEY, JSON.stringify(index));
    } catch (e) {
        console.error('[HAP-588] Failed to save message cache index', e);
    }
}

function updateMessageCacheIndex(sessionId: string): void {
    const index = loadMessageCacheIndex();
    index.sessions[sessionId] = Date.now();
    saveMessageCacheIndex(index);
}

function removeFromMessageCacheIndex(sessionId: string): void {
    const index = loadMessageCacheIndex();
    delete index.sessions[sessionId];
    saveMessageCacheIndex(index);
}