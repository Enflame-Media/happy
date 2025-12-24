import { createMMKV } from 'react-native-mmkv';
import { Settings, settingsDefaults, settingsParse, SettingsSchema } from './settings';
import { LocalSettings, localSettingsDefaults, localSettingsParse } from './localSettings';
import { Purchases, purchasesDefaults, purchasesParse } from './purchases';
import { Profile, profileDefaults, profileParse } from './profile';
import type { PermissionMode } from '@/components/PermissionModeSelector';

const mmkv = createMMKV();

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