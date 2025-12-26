import Constants from 'expo-constants';
import { apiSocket } from '@/sync/apiSocket';
import { AuthCredentials } from '@/auth/tokenStorage';
import { AppError, ErrorCodes } from '@/utils/errors';
import { fetchWithTimeout } from '@/utils/fetchWithTimeout';
import { authenticatedFetch } from '@/sync/apiHelper';
import { Encryption, EncryptionCache } from '@/sync/encryption/encryption';
import { decodeBase64, encodeBase64 } from '@/encryption/base64';
import { storage } from './storage';
import { ApiEphemeralUpdateSchema, ApiMessage, ApiUpdateContainerSchema } from './apiTypes';
import type { ApiEphemeralActivityUpdate } from './apiTypes';
import { Session, Machine, MachineMetadata } from './storageTypes';
import { InvalidateSync } from '@/utils/sync';
import { LRUCache } from '@/utils/LRUCache';
import { ActivityUpdateAccumulator } from './reducer/activityUpdateAccumulator';
import { randomUUID } from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import { registerPushToken } from './apiPush';
import { Platform, AppState } from 'react-native';
import { isRunningOnMac } from '@/utils/platform';
import { NormalizedMessage, normalizeRawMessage, RawRecord } from './typesRaw';
import { applySettings, Settings, settingsDefaults, settingsParse } from './settings';
import { Profile, profileParse } from './profile';
import { loadPendingSettings, savePendingSettings, loadSyncState, saveSyncState } from './persistence';
import { initializeTracking, tracking } from '@/track';
import { parseToken } from '@/utils/parseToken';
import { RevenueCat, LogLevel, PaywallResult } from './revenueCat';
import { trackPaywallPresented, trackPaywallPurchased, trackPaywallCancelled, trackPaywallRestored, trackPaywallError } from '@/track';
import { getServerUrl } from './serverConfig';
import { config } from '@/config';
import { log } from '@/log';
import { gitStatusSync } from './gitStatusSync';
import { projectManager } from './projectManager';
import { fileSearchCache } from './suggestionFile';
import { voiceHooks } from '@/realtime/hooks/voiceHooks';
import { Message } from './typesMessage';
import { systemPrompt } from './prompt/systemPrompt';
import { fetchArtifact, fetchArtifacts, createArtifact, updateArtifact } from './apiArtifacts';
import { reportSyncMetric, setAnalyticsCredentials } from './apiAnalytics';
import { DecryptedArtifact, ArtifactCreateRequest, ArtifactUpdateRequest } from './artifactTypes';
import { ArtifactEncryption } from './encryption/artifactEncryption';
import { getFriendsList, getUserProfile } from './apiFriends';
import { fetchFeed } from './apiFeed';
import { FeedItem } from './feedTypes';
import { UserProfile } from './friendTypes';
import { parseCursorCounterOrDefault, isValidCursor } from './cursorUtils';
import { initializeTodoSync } from '../-zen/model/ops';
import { createAdvancedDebounce } from '@/utils/debounce';
import {
    getEntityTypeFromUpdate as getEntityTypeFromUpdateUtil,
    trackSeq as trackSeqUtil,
    getLastKnownSeq as getLastKnownSeqUtil,
} from './deltaSyncUtils';
import { orchestrateDeltaSync } from './deltaSyncOrchestrator';

/**
 * HAP-441: Delta sync response type from server.
 * Contains updates since the given seq numbers.
 * Note: Also exported from deltaSyncOrchestrator.ts for testing.
 */
interface DeltaSyncResponse {
    success: boolean;
    error?: string;
    updates?: Array<{
        type: string;
        data: unknown;
        seq: number;
        createdAt: number;
    }>;
    counts?: {
        sessions: number;
        machines: number;
        artifacts: number;
    };
}

/**
 * HAP-497: Sync metrics for measuring optimization effectiveness.
 * Tracks payload sizes, sync modes, and timing to validate HAP-489 optimizations.
 */
interface SyncMetrics {
    type: 'messages' | 'profile' | 'artifacts';
    mode: 'full' | 'incremental' | 'cached';
    bytesReceived: number;
    itemsReceived: number;
    itemsSkipped: number;
    durationMs: number;
    sessionId?: string;
}

/**
 * HAP-497: Log sync metrics in a structured format for analysis.
 * Uses 📊 emoji prefix for easy filtering in logs.
 *
 * HAP-547: Also reports metrics to the server for analytics.
 * Reporting is fire-and-forget and does not block sync operations.
 */
function logSyncMetrics(metrics: SyncMetrics): void {
    log.log(`📊 Sync metrics: ${JSON.stringify(metrics)}`);
    // HAP-547: Report to server (fire-and-forget, won't block)
    reportSyncMetric(metrics);
}

/**
 * Compares two arrays for shallow equality.
 * More efficient than JSON.stringify comparison as it:
 * - Returns true immediately for reference equality
 * - Compares lengths before iterating
 * - Uses direct element comparison without serialization
 */
function arraysEqual<T>(a: T[] | undefined, b: T[] | undefined): boolean {
    if (a === b) return true;
    if (!a || !b) return a === b;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

/**
 * Maximum number of session message syncs to keep in memory.
 * Older entries are evicted using LRU (Least Recently Used) policy.
 */
const MAX_CACHED_MESSAGE_SYNCS = 20;

/**
 * Maximum number of artifact data encryption keys to keep in memory.
 * Keys for least recently used artifacts are evicted automatically.
 * This prevents unbounded memory growth for users with many artifacts.
 */
const MAX_CACHED_ARTIFACT_KEYS = 100;

class Sync {
    // Spawned agents (especially in spawn mode) can take noticeable time to connect.
    // This timeout allows the first message to wait for the agent's websocket connection.
    private static readonly SESSION_READY_TIMEOUT_MS = 10000;

    encryption!: Encryption;
    serverID!: string;
    anonID!: string;
    private credentials!: AuthCredentials;
    public encryptionCache = new EncryptionCache();
    private sessionsSync: InvalidateSync;
    private messagesSync = new LRUCache<string, InvalidateSync>(
        MAX_CACHED_MESSAGE_SYNCS,
        (sessionId, sync) => {
            sync.stop();
            // Clean up associated data when session is evicted (HAP-469)
            this.sessionLastSeq.delete(sessionId);
            // HAP-499: Clean up additional session-scoped caches to prevent memory leaks
            this.encryption.removeSessionEncryption(sessionId);
            gitStatusSync.clearForSession(sessionId);
            fileSearchCache.clearCache(sessionId);
        }
    );
    /**
     * Tracks the highest message sequence number received per session.
     * Used for cursor-based message fetching to only request new messages.
     * Entries are automatically cleaned up when sessions are evicted from messagesSync.
     */
    private sessionLastSeq = new Map<string, number>();
    /**
     * LRU cache for artifact data encryption keys.
     * Keys are evicted when cache exceeds MAX_CACHED_ARTIFACT_KEYS to prevent memory leaks.
     * When a key is evicted, the artifact data can still be re-decrypted on next access
     * by fetching the encrypted key from the server.
     */
    private artifactDataKeys = new LRUCache<string, Uint8Array>(MAX_CACHED_ARTIFACT_KEYS);
    private settingsSync: InvalidateSync;
    private profileSync: InvalidateSync;
    private purchasesSync: InvalidateSync;
    private machinesSync: InvalidateSync;
    private pushTokenSync: InvalidateSync;
    private nativeUpdateSync: InvalidateSync;
    private artifactsSync: InvalidateSync;
    private friendsSync: InvalidateSync;
    private friendRequestsSync: InvalidateSync;
    private feedSync: InvalidateSync;
    private todosSync: InvalidateSync;
    private activityAccumulator: ActivityUpdateAccumulator;
    private pendingSettings: Partial<Settings> = loadPendingSettings();
    revenueCatInitialized = false;

    /**
     * HAP-441: Track last known sequence numbers per entity type for delta sync.
     * On WebSocket reconnection, we request updates since these seqs instead of
     * triggering a full refetch, reducing bandwidth and preventing missed updates.
     */
    private lastKnownSeq = new Map<string, number>();

    /**
     * HAP-491: ETag for profile conditional requests.
     * When set, fetchProfile sends If-None-Match header. Server returns 304
     * if profile unchanged, saving bandwidth on frequently polled data.
     */
    private profileETag: string | null = null;

    /**
     * HAP-496: Debounced sync state persistence.
     * Persists sync cursors/ETags to storage with 5-second debounce.
     * Has flush() for immediate persist on app background.
     */
    private syncStatePersistence = createAdvancedDebounce<void>(
        () => this.persistSyncStateNow(),
        { delay: 5000, immediateCount: 0 }
    );

    // Generic locking mechanism
    private recalculationLockCount = 0;
    private lastRecalculationTime = 0;


    // AppState subscription for cleanup
    private appStateSubscription?: { remove: () => void };
    private socketCleanups: (() => void)[] = [];
    constructor() {
        this.sessionsSync = new InvalidateSync(this.fetchSessions);
        this.settingsSync = new InvalidateSync(this.syncSettings);
        this.profileSync = new InvalidateSync(this.fetchProfile);
        this.purchasesSync = new InvalidateSync(this.syncPurchases);
        this.machinesSync = new InvalidateSync(this.fetchMachines);
        this.nativeUpdateSync = new InvalidateSync(this.fetchNativeUpdate);
        this.artifactsSync = new InvalidateSync(this.fetchArtifactsList);
        this.friendsSync = new InvalidateSync(this.fetchFriends);
        this.friendRequestsSync = new InvalidateSync(this.fetchFriendRequests);
        this.feedSync = new InvalidateSync(this.fetchFeed);
        this.todosSync = new InvalidateSync(this.fetchTodos);

        const registerPushToken = async () => {
            if (__DEV__) {
                return;
            }
            await this.registerPushToken();
        }
        this.pushTokenSync = new InvalidateSync(registerPushToken);
        this.activityAccumulator = new ActivityUpdateAccumulator(this.flushActivityUpdates.bind(this), 2000);

        // Listen for app state changes to refresh purchases and persist state
        this.appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
            if (nextAppState === 'active') {
                log.log('📱 App became active');
                this.invalidateOnResume();
            } else if (nextAppState === 'background' || nextAppState === 'inactive') {
                // HAP-496: Flush sync state immediately when app goes to background
                // This ensures cursors/ETags are persisted before the app might be killed
                log.log(`📱 App state changed to: ${nextAppState}, flushing sync state`);
                this.syncStatePersistence.flush();
            } else {
                log.log(`📱 App state changed to: ${nextAppState}`);
            }
        });
    }

    /**
     * HAP-455: Prioritized staggered invalidation to prevent network spike on app resume.
     *
     * Syncs are organized into priority tiers:
     * - Priority 1 (immediate): Core UX syncs - sessions, profile, settings-related
     * - Priority 2 (100ms delay): Important but not blocking - machines, purchases
     * - Priority 3 (200ms delay): Secondary features - artifacts, push tokens
     * - Priority 4 (300ms delay): Social/background - friends, feed, todos
     *
     * This reduces concurrent network requests from 11 to ~3 per wave,
     * preventing rate limiting, reducing battery drain, and improving perceived performance.
     */
    private invalidateOnResume() {
        // Priority 1: Core UX (immediate) - user sees these immediately
        this.sessionsSync.invalidate();
        this.profileSync.invalidate();
        this.nativeUpdateSync.invalidate();

        // Priority 2: Important features (100ms delay)
        setTimeout(() => {
            this.machinesSync.invalidate();
            this.purchasesSync.invalidate();
        }, 100);

        // Priority 3: Secondary features (200ms delay)
        setTimeout(() => {
            log.log('📱 App resume: Invalidating artifacts sync (staggered)');
            this.artifactsSync.invalidate();
            this.pushTokenSync.invalidate();
        }, 200);

        // Priority 4: Social/background features (300ms delay)
        setTimeout(() => {
            this.friendsSync.invalidate();
            this.friendRequestsSync.invalidate();
            this.feedSync.invalidate();
            this.todosSync.invalidate();
        }, 300);
    }

    async create(credentials: AuthCredentials, encryption: Encryption) {
        this.credentials = credentials;
        this.encryption = encryption;
        this.anonID = encryption.anonID;
        this.serverID = parseToken(credentials.token);
        // HAP-547: Enable analytics reporting with current credentials
        setAnalyticsCredentials(credentials);
        await this.#init();

        // Await initial syncs with timeout to prevent login from hanging forever
        // These are best-effort - if they fail/timeout, login still succeeds
        // and the syncs will retry in the background via backoff
        const SYNC_TIMEOUT_MS = 10000; // 10 seconds

        const awaitWithTimeout = async (name: string, syncPromise: Promise<void>) => {
            try {
                await Promise.race([
                    syncPromise,
                    new Promise<void>((_, reject) =>
                        setTimeout(() => reject(new Error(`${name} sync timed out after ${SYNC_TIMEOUT_MS}ms`)), SYNC_TIMEOUT_MS)
                    ),
                ]);
                log.log(`✅ ${name} sync completed`);
            } catch (error) {
                // Log but don't fail - syncs will continue retrying in background
                const errorMessage = error instanceof Error ? error.message : String(error);
                log.log(`⚠️ ${name} sync failed/timed out: ${errorMessage}`);
                console.warn(`${name} sync failed/timed out:`, error);
            }
        };

        // Run syncs with timeouts - these are non-blocking for login success
        await awaitWithTimeout('Settings', this.settingsSync.awaitQueue());
        await awaitWithTimeout('Profile', this.profileSync.awaitQueue());
        await awaitWithTimeout('Purchases', this.purchasesSync.awaitQueue());

        log.log('🎉 sync.create() completed - user can now use the app');
    }

    async restore(credentials: AuthCredentials, encryption: Encryption) {
        // NOTE: No awaiting anything here, we're restoring from a disk (ie app restarted)
        this.credentials = credentials;
        this.encryption = encryption;
        this.anonID = encryption.anonID;
        this.serverID = parseToken(credentials.token);
        // HAP-547: Enable analytics reporting with current credentials
        setAnalyticsCredentials(credentials);
        await this.#init();
    }


    /**
     * Cleanup method to remove event listeners and prevent memory leaks.
     * Call this when the Sync instance is no longer needed.
     */
    destroy() {
        this.appStateSubscription?.remove();
        this.socketCleanups.forEach((cleanup) => cleanup());
        // HAP-496: Cancel any pending sync state persistence and flush immediately
        this.syncStatePersistence.flush();
        // HAP-547: Disable analytics reporting on logout
        setAnalyticsCredentials(null);
    }

    async #init() {

        // HAP-496: Load persisted sync state before invalidating syncs
        // This enables incremental sync on app restart instead of full fetch
        this.loadPersistedSyncState();

        // Subscribe to updates
        this.subscribeToUpdates();

        // Sync initial PostHog opt-out state with stored settings
        if (tracking) {
            const currentSettings = storage.getState().settings;
            if (currentSettings.analyticsOptOut) {
                tracking.optOut();
            } else {
                tracking.optIn();
            }
        }

        // Invalidate sync
        log.log('🔄 #init: Invalidating all syncs');
        this.sessionsSync.invalidate();
        this.settingsSync.invalidate();
        this.profileSync.invalidate();
        this.purchasesSync.invalidate();
        this.machinesSync.invalidate();
        this.pushTokenSync.invalidate();
        this.nativeUpdateSync.invalidate();
        this.friendsSync.invalidate();
        this.friendRequestsSync.invalidate();
        this.artifactsSync.invalidate();
        this.feedSync.invalidate();
        this.todosSync.invalidate();
        log.log('🔄 #init: All syncs invalidated, including artifacts and todos');

        // Wait for both sessions and machines to load, then mark as ready
        Promise.all([
            this.sessionsSync.awaitQueue(),
            this.machinesSync.awaitQueue()
        ]).then(() => {
            storage.getState().applyReady();
        }).catch((error) => {
            console.error('Failed to load initial data:', error);
        });
    }


    onSessionVisible = (sessionId: string) => {
        let ex = this.messagesSync.get(sessionId);
        if (!ex) {
            ex = new InvalidateSync(() => this.fetchMessages(sessionId));
            this.messagesSync.set(sessionId, ex);
        }
        ex.invalidate();

        // Also invalidate git status sync for this session
        gitStatusSync.getSync(sessionId).invalidate();

        // Notify voice assistant about session visibility
        const session = storage.getState().sessions[sessionId];
        if (session) {
            voiceHooks.onSessionFocus(sessionId, session.metadata || undefined);
        }
    }


    async sendMessage(sessionId: string, text: string, displayText?: string) {

        // Get encryption
        const encryption = this.encryption.getSessionEncryption(sessionId);
        if (!encryption) { // Should never happen
            console.error(`Session ${sessionId} not found`);
            return;
        }

        // Get session data from storage
        const session = storage.getState().sessions[sessionId];
        if (!session) {
            console.error(`Session ${sessionId} not found in storage`);
            return;
        }

        // Read permission mode and model mode from session state
        const permissionMode = session.permissionMode || 'default';
        const modelMode = session.modelMode || 'default';

        // Generate local ID
        const localId = randomUUID();

        // Determine sentFrom based on platform
        let sentFrom: string;
        if (Platform.OS === 'web') {
            sentFrom = 'web';
        } else if (Platform.OS === 'android') {
            sentFrom = 'android';
        } else if (Platform.OS === 'ios') {
            // Check if running on Mac (Catalyst or Designed for iPad on Mac)
            if (isRunningOnMac()) {
                sentFrom = 'mac';
            } else {
                sentFrom = 'ios';
            }
        } else {
            sentFrom = 'web'; // fallback
        }

        // Resolve model settings based on modelMode
        let model: string | null = null;
        let fallbackModel: string | null = null;

        switch (modelMode) {
            case 'opus':
                model = 'claude-opus-4-5-20251101';
                fallbackModel = null;
                break;
            case 'sonnet':
                model = 'claude-sonnet-4-5-20250929';
                fallbackModel = null;
                break;
            case 'haiku':
                model = 'claude-haiku-4-5-20251001';
                fallbackModel = null;
                break;
            default:
                // If no modelMode is specified, use default behavior (opus)
                model = 'claude-opus-4-5-20251101';
                fallbackModel = null;
                break;
        }

        // Create user message content with metadata
        const content: RawRecord = {
            role: 'user',
            content: {
                type: 'text',
                text
            },
            meta: {
                sentFrom,
                permissionMode: permissionMode || 'default',
                model,
                fallbackModel,
                appendSystemPrompt: systemPrompt,
                ...(displayText && { displayText }) // Add displayText if provided
            }
        };
        const encryptedRawRecord = await encryption.encryptRawRecord(content);

        // Add to messages - normalize the raw record
        const createdAt = Date.now();
        const normalizedMessage = normalizeRawMessage(localId, localId, createdAt, content);
        if (normalizedMessage) {
            this.applyMessages(sessionId, [normalizedMessage]);
        }

        // Wait for agent to be ready before sending (prevents first message loss on slow startup)
        const ready = await this.waitForAgentReady(sessionId);
        if (!ready) {
            log.log(`Session ${sessionId} not ready after timeout, sending anyway`);
        }

        // Send message with optional permission mode and source identifier
        apiSocket.send('message', {
            sid: sessionId,
            message: encryptedRawRecord,
            localId,
            sentFrom,
            permissionMode: permissionMode || 'default'
        });
    }

    applySettings = (delta: Partial<Settings>) => {
        storage.getState().applySettingsLocal(delta);

        // Save pending settings
        this.pendingSettings = { ...this.pendingSettings, ...delta };
        savePendingSettings(this.pendingSettings);

        // Sync PostHog opt-out state if it was changed
        if (tracking && 'analyticsOptOut' in delta) {
            const currentSettings = storage.getState().settings;
            if (currentSettings.analyticsOptOut) {
                tracking.optOut();
            } else {
                tracking.optIn();
            }
        }

        // Sync contextNotificationsEnabled to all active CLI sessions (HAP-358)
        if ('contextNotificationsEnabled' in delta) {
            const enabled = delta.contextNotificationsEnabled ?? true;
            this.broadcastContextNotificationsEnabled(enabled);
        }

        // Invalidate settings sync
        this.settingsSync.invalidate();
    }

    refreshPurchases = () => {
        this.purchasesSync.invalidate();
    }

    refreshProfile = async () => {
        await this.profileSync.invalidateAndAwait();
    }

    /**
     * Broadcast contextNotificationsEnabled setting to all active CLI sessions.
     * This allows the CLI to respect the user's notification preference.
     * @see HAP-358
     */
    private broadcastContextNotificationsEnabled = (enabled: boolean) => {
        const activeSessions = storage.getState().getActiveSessions();
        log.log(`[HAP-358] Broadcasting contextNotificationsEnabled=${enabled} to ${activeSessions.length} active sessions`);

        for (const session of activeSessions) {
            // Send RPC call to CLI to update notification setting
            // Fire-and-forget: we don't need to wait for response
            apiSocket.sessionRPC<{ ok: boolean }, { enabled: boolean }>(
                session.id,
                'setContextNotificationsEnabled',
                { enabled }
            ).then(response => {
                if (response?.ok) {
                    log.log(`[HAP-358] Session ${session.id} acknowledged contextNotificationsEnabled=${enabled}`);
                }
            }).catch(error => {
                // Silently ignore errors - CLI may not be connected or may not support this RPC
                log.log(`[HAP-358] Failed to send contextNotificationsEnabled to session ${session.id}: ${error}`);
            });
        }
    }

    purchaseProduct = async (productId: string): Promise<{ success: boolean; error?: string }> => {
        try {
            // Check if RevenueCat is initialized
            if (!this.revenueCatInitialized) {
                return { success: false, error: 'RevenueCat not initialized' };
            }

            // Fetch the product
            const products = await RevenueCat.getProducts([productId]);
            if (products.length === 0) {
                return { success: false, error: `Product '${productId}' not found` };
            }

            // Purchase the product
            const product = products[0];
            const { customerInfo } = await RevenueCat.purchaseStoreProduct(product);

            // Update local purchases data
            storage.getState().applyPurchases(customerInfo);

            return { success: true };
        } catch (error: any) {
            // Check if user cancelled
            if (error.userCancelled) {
                return { success: false, error: 'Purchase cancelled' };
            }

            // Return the error message
            return { success: false, error: error.message || 'Purchase failed' };
        }
    }

    getOfferings = async (): Promise<{ success: boolean; offerings?: any; error?: string }> => {
        try {
            // Check if RevenueCat is initialized
            if (!this.revenueCatInitialized) {
                return { success: false, error: 'RevenueCat not initialized' };
            }

            // Fetch offerings
            const offerings = await RevenueCat.getOfferings();

            // Return the offerings data
            return {
                success: true,
                offerings: {
                    current: offerings.current,
                    all: offerings.all
                }
            };
        } catch (error: any) {
            return { success: false, error: error.message || 'Failed to fetch offerings' };
        }
    }

    presentPaywall = async (): Promise<{ success: boolean; purchased?: boolean; error?: string }> => {
        try {
            // Check if RevenueCat is initialized
            if (!this.revenueCatInitialized) {
                const error = 'RevenueCat not initialized';
                trackPaywallError(error);
                return { success: false, error };
            }

            // Track paywall presentation
            trackPaywallPresented();

            // Present the paywall
            const result = await RevenueCat.presentPaywall();

            // Handle the result
            switch (result) {
                case PaywallResult.PURCHASED:
                    trackPaywallPurchased();
                    // Refresh customer info after purchase
                    await this.syncPurchases();
                    return { success: true, purchased: true };
                case PaywallResult.RESTORED:
                    trackPaywallRestored();
                    // Refresh customer info after restore
                    await this.syncPurchases();
                    return { success: true, purchased: true };
                case PaywallResult.CANCELLED:
                    trackPaywallCancelled();
                    return { success: true, purchased: false };
                case PaywallResult.NOT_PRESENTED:
                    // Don't track error for NOT_PRESENTED as it's a platform limitation
                    return { success: false, error: 'Paywall not available on this platform' };
                case PaywallResult.ERROR:
                default:
                    const errorMsg = 'Failed to present paywall';
                    trackPaywallError(errorMsg);
                    return { success: false, error: errorMsg };
            }
        } catch (error: any) {
            const errorMessage = error.message || 'Failed to present paywall';
            trackPaywallError(errorMessage);
            return { success: false, error: errorMessage };
        }
    }

    async assumeUsers(userIds: string[]): Promise<void> {
        if (!this.credentials || userIds.length === 0) return;
        
        const state = storage.getState();
        // Filter out users we already have in cache (including null for 404s)
        const missingIds = userIds.filter(id => !(id in state.users));
        
        if (missingIds.length === 0) return;
        
        log.log(`👤 Fetching ${missingIds.length} missing users...`);
        
        // Fetch missing users in parallel
        const results = await Promise.all(
            missingIds.map(async (id) => {
                try {
                    const profile = await getUserProfile(this.credentials!, id);
                    return { id, profile };  // profile is null if 404
                } catch (error) {
                    console.error(`Failed to fetch user ${id}:`, error);
                    return { id, profile: null };  // Treat errors as 404
                }
            })
        );
        
        // Convert to Record<string, UserProfile | null>
        const usersMap: Record<string, UserProfile | null> = {};
        results.forEach(({ id, profile }) => {
            usersMap[id] = profile;
        });
        
        storage.getState().applyUsers(usersMap);
        log.log(`👤 Applied ${results.length} users to cache (${results.filter(r => r.profile).length} found, ${results.filter(r => !r.profile).length} not found)`);
    }

    //
    // Private
    //

    private fetchSessions = async () => {
        if (!this.credentials) return;

        const API_ENDPOINT = getServerUrl();
        const response = await authenticatedFetch(
            `${API_ENDPOINT}/v1/sessions`,
            this.credentials,
            { headers: { 'Content-Type': 'application/json' } },
            'fetching sessions'
        );

        if (!response.ok) {
            throw new AppError(ErrorCodes.FETCH_FAILED, `Failed to fetch sessions: ${response.status}`, { canTryAgain: true });
        }

        const data = await response.json();
        const sessions = data.sessions as Array<{
            id: string;
            tag: string;
            seq: number;
            metadata: string;
            metadataVersion: number;
            agentState: string | null;
            agentStateVersion: number;
            dataEncryptionKey: string | null;
            active: boolean;
            activeAt: number;
            createdAt: number;
            updatedAt: number;
            lastMessage: ApiMessage | null;
        }>;

        // Initialize all session encryptions first
        const sessionKeys = new Map<string, Uint8Array | null>();
        for (const session of sessions) {
            if (session.dataEncryptionKey) {
                let decrypted = await this.encryption.decryptEncryptionKey(session.dataEncryptionKey);
                if (!decrypted) {
                    console.error(`Failed to decrypt data encryption key for session ${session.id}`);
                    continue;
                }
                sessionKeys.set(session.id, decrypted);
            } else {
                sessionKeys.set(session.id, null);
            }
        }
        await this.encryption.initializeSessions(sessionKeys);

        // Decrypt sessions
        let decryptedSessions: (Omit<Session, 'presence'> & { presence?: "online" | number })[] = [];
        for (const session of sessions) {
            // Get session encryption (should always exist after initialization)
            const sessionEncryption = this.encryption.getSessionEncryption(session.id);
            if (!sessionEncryption) {
                console.error(`Session encryption not found for ${session.id} - this should never happen`);
                continue;
            }

            // Decrypt metadata using session-specific encryption
            let metadata = await sessionEncryption.decryptMetadata(session.metadataVersion, session.metadata);

            // Decrypt agent state using session-specific encryption
            let agentState = await sessionEncryption.decryptAgentState(session.agentStateVersion, session.agentState);

            // Put it all together
            const processedSession = {
                ...session,
                thinking: false,
                thinkingAt: 0,
                metadata,
                agentState
            };
            decryptedSessions.push(processedSession);
        }

        // Apply to storage
        this.applySessions(decryptedSessions);
        log.log(`📥 fetchSessions completed - processed ${decryptedSessions.length} sessions`);

    }

    public refreshMachines = async () => {
        return this.fetchMachines();
    }

    public refreshSessions = async () => {
        return this.sessionsSync.invalidateAndAwait();
    }

    public getCredentials() {
        return this.credentials;
    }

    // Artifact methods
    /**
     * HAP-492: Fetch artifacts with incremental sync support.
     * Uses lastKnownSeq to fetch only new/updated artifacts since last sync.
     * Falls back to full fetch when sinceSeq is 0 (first sync or forced refresh).
     */
    public fetchArtifactsList = async (): Promise<void> => {
        log.log('📦 fetchArtifactsList: Starting artifact sync');
        // HAP-497: Track sync timing for metrics
        const syncStartTime = Date.now();

        if (!this.credentials) {
            log.log('📦 fetchArtifactsList: No credentials, skipping');
            return;
        }

        try {
            // HAP-492: Get last known seq for incremental fetch
            const sinceSeq = this.getLastKnownSeq('artifacts');
            const isIncremental = sinceSeq > 0;

            log.log(`📦 fetchArtifactsList: Fetching artifacts from server (sinceSeq=${sinceSeq}, incremental=${isIncremental})`);
            const response = await fetchArtifacts(this.credentials, sinceSeq);
            const { artifacts, maxSeq } = response;
            // HAP-497: Estimate bytes received from response
            const bytesReceived = JSON.stringify(response).length;
            log.log(`📦 fetchArtifactsList: Received ${artifacts.length} artifacts from server (maxSeq=${maxSeq})`);

            // HAP-492: Update the lastKnownSeq for artifacts from response
            if (maxSeq > sinceSeq) {
                this.trackSeq('artifacts', maxSeq);
            }

            // If no new artifacts, nothing to process
            if (artifacts.length === 0) {
                log.log('📦 fetchArtifactsList: No new artifacts to process');
                // HAP-497: Log metrics for empty response (still useful for optimization tracking)
                logSyncMetrics({
                    type: 'artifacts',
                    mode: isIncremental ? 'incremental' : 'full',
                    bytesReceived,
                    itemsReceived: 0,
                    itemsSkipped: 0,
                    durationMs: Date.now() - syncStartTime
                });
                return;
            }

            const decryptedArtifacts: DecryptedArtifact[] = [];

            for (const artifact of artifacts) {
                try {
                    // Decrypt the data encryption key
                    const decryptedKey = await this.encryption.decryptEncryptionKey(artifact.dataEncryptionKey);
                    if (!decryptedKey) {
                        console.error(`Failed to decrypt key for artifact ${artifact.id}`);
                        continue;
                    }

                    // Store the decrypted key in memory
                    this.artifactDataKeys.set(artifact.id, decryptedKey);

                    // Create artifact encryption instance
                    const artifactEncryption = new ArtifactEncryption(decryptedKey);

                    // Decrypt header
                    const header = await artifactEncryption.decryptHeader(artifact.header);

                    decryptedArtifacts.push({
                        id: artifact.id,
                        title: header?.title || null,
                        sessions: header?.sessions,  // Include sessions from header
                        draft: header?.draft,        // Include draft flag from header
                        body: undefined, // Body not loaded in list
                        headerVersion: artifact.headerVersion,
                        bodyVersion: artifact.bodyVersion,
                        seq: artifact.seq,
                        createdAt: artifact.createdAt,
                        updatedAt: artifact.updatedAt,
                        isDecrypted: !!header,
                    });
                } catch (err) {
                    console.error(`Failed to decrypt artifact ${artifact.id}:`, err);
                    // Add with decryption failed flag
                    decryptedArtifacts.push({
                        id: artifact.id,
                        title: null,
                        body: undefined,
                        headerVersion: artifact.headerVersion,
                        seq: artifact.seq,
                        createdAt: artifact.createdAt,
                        updatedAt: artifact.updatedAt,
                        isDecrypted: false,
                    });
                }
            }

            log.log(`📦 fetchArtifactsList: Successfully decrypted ${decryptedArtifacts.length} artifacts`);
            // HAP-492: applyArtifacts already merges (doesn't replace), so both full and incremental work correctly
            storage.getState().applyArtifacts(decryptedArtifacts);
            log.log('📦 fetchArtifactsList: Artifacts applied to storage');

            // HAP-497: Log sync metrics for optimization tracking
            logSyncMetrics({
                type: 'artifacts',
                mode: isIncremental ? 'incremental' : 'full',
                bytesReceived,
                itemsReceived: decryptedArtifacts.length,
                itemsSkipped: 0, // Artifacts don't have duplicate filtering like messages
                durationMs: Date.now() - syncStartTime
            });
        } catch (error) {
            log.log(`📦 fetchArtifactsList: Error fetching artifacts: ${error}`);
            console.error('Failed to fetch artifacts:', error);
            throw error;
        }
    }

    public async fetchArtifactWithBody(artifactId: string): Promise<DecryptedArtifact | null> {
        if (!this.credentials) return null;

        try {
            const artifact = await fetchArtifact(this.credentials, artifactId);

            // Decrypt the data encryption key
            const decryptedKey = await this.encryption.decryptEncryptionKey(artifact.dataEncryptionKey);
            if (!decryptedKey) {
                console.error(`Failed to decrypt key for artifact ${artifactId}`);
                return null;
            }

            // Store the decrypted key in memory
            this.artifactDataKeys.set(artifact.id, decryptedKey);

            // Create artifact encryption instance
            const artifactEncryption = new ArtifactEncryption(decryptedKey);

            // Decrypt header and body
            const header = await artifactEncryption.decryptHeader(artifact.header);
            const body = artifact.body ? await artifactEncryption.decryptBody(artifact.body) : null;

            return {
                id: artifact.id,
                title: header?.title || null,
                sessions: header?.sessions,  // Include sessions from header
                draft: header?.draft,        // Include draft flag from header
                body: body?.body || null,
                headerVersion: artifact.headerVersion,
                bodyVersion: artifact.bodyVersion,
                seq: artifact.seq,
                createdAt: artifact.createdAt,
                updatedAt: artifact.updatedAt,
                isDecrypted: !!header,
            };
        } catch (error) {
            console.error(`Failed to fetch artifact ${artifactId}:`, error);
            return null;
        }
    }

    public async createArtifact(
        title: string | null, 
        body: string | null,
        sessions?: string[],
        draft?: boolean
    ): Promise<string> {
        if (!this.credentials) {
            throw new AppError(ErrorCodes.NOT_AUTHENTICATED, 'Not authenticated');
        }

        try {
            // Generate unique artifact ID
            const artifactId = this.encryption.generateId();

            // Generate data encryption key
            const dataEncryptionKey = ArtifactEncryption.generateDataEncryptionKey();
            
            // Store the decrypted key in memory
            this.artifactDataKeys.set(artifactId, dataEncryptionKey);
            
            // Encrypt the data encryption key with user's key
            const encryptedKey = await this.encryption.encryptEncryptionKey(dataEncryptionKey);
            
            // Create artifact encryption instance
            const artifactEncryption = new ArtifactEncryption(dataEncryptionKey);
            
            // Encrypt header and body
            const encryptedHeader = await artifactEncryption.encryptHeader({ title, sessions, draft });
            const encryptedBody = await artifactEncryption.encryptBody({ body });
            
            // Create the request
            const request: ArtifactCreateRequest = {
                id: artifactId,
                header: encryptedHeader,
                body: encryptedBody,
                dataEncryptionKey: encodeBase64(encryptedKey, 'base64'),
            };
            
            // Send to server
            const artifact = await createArtifact(this.credentials, request);
            
            // Add to local storage
            const decryptedArtifact: DecryptedArtifact = {
                id: artifact.id,
                title,
                sessions,
                draft,
                body,
                headerVersion: artifact.headerVersion,
                bodyVersion: artifact.bodyVersion,
                seq: artifact.seq,
                createdAt: artifact.createdAt,
                updatedAt: artifact.updatedAt,
                isDecrypted: true,
            };
            
            storage.getState().addArtifact(decryptedArtifact);
            
            return artifactId;
        } catch (error) {
            console.error('Failed to create artifact:', error);
            throw error;
        }
    }

    public async updateArtifact(
        artifactId: string, 
        title: string | null, 
        body: string | null,
        sessions?: string[],
        draft?: boolean
    ): Promise<void> {
        if (!this.credentials) {
            throw new AppError(ErrorCodes.NOT_AUTHENTICATED, 'Not authenticated');
        }

        try {
            // Get current artifact to get versions and encryption key
            const currentArtifact = storage.getState().artifacts[artifactId];
            if (!currentArtifact) {
                throw new AppError(ErrorCodes.NOT_FOUND, 'Artifact not found');
            }

            // Get the data encryption key from memory or fetch it
            let dataEncryptionKey = this.artifactDataKeys.get(artifactId);

            // Fetch full artifact if we don't have version info or encryption key
            let headerVersion = currentArtifact.headerVersion;
            let bodyVersion = currentArtifact.bodyVersion;

            if (headerVersion === undefined || bodyVersion === undefined || !dataEncryptionKey) {
                const fullArtifact = await fetchArtifact(this.credentials, artifactId);
                headerVersion = fullArtifact.headerVersion;
                bodyVersion = fullArtifact.bodyVersion;

                // Decrypt and store the data encryption key if we don't have it
                if (!dataEncryptionKey) {
                    const decryptedKey = await this.encryption.decryptEncryptionKey(fullArtifact.dataEncryptionKey);
                    if (!decryptedKey) {
                        throw new AppError(ErrorCodes.DECRYPTION_FAILED, 'Failed to decrypt encryption key');
                    }
                    this.artifactDataKeys.set(artifactId, decryptedKey);
                    dataEncryptionKey = decryptedKey;
                }
            }

            // Create artifact encryption instance
            const artifactEncryption = new ArtifactEncryption(dataEncryptionKey);

            // Prepare update request
            const updateRequest: ArtifactUpdateRequest = {};
            
            // Check if header needs updating (title, sessions, or draft changed)
            if (title !== currentArtifact.title ||
                !arraysEqual(sessions, currentArtifact.sessions) ||
                draft !== currentArtifact.draft) {
                const encryptedHeader = await artifactEncryption.encryptHeader({ 
                    title, 
                    sessions, 
                    draft 
                });
                updateRequest.header = encryptedHeader;
                updateRequest.expectedHeaderVersion = headerVersion;
            }

            // Only update body if it changed
            if (body !== currentArtifact.body) {
                const encryptedBody = await artifactEncryption.encryptBody({ body });
                updateRequest.body = encryptedBody;
                updateRequest.expectedBodyVersion = bodyVersion;
            }

            // Skip if no changes
            if (Object.keys(updateRequest).length === 0) {
                return;
            }

            // Send update to server
            const response = await updateArtifact(this.credentials, artifactId, updateRequest);
            
            if (!response.success) {
                // Handle version mismatch
                if (response.error === 'version-mismatch') {
                    throw new AppError(ErrorCodes.VERSION_CONFLICT, 'Artifact was modified by another client. Please refresh and try again.', { canTryAgain: true });
                }
                throw new AppError(ErrorCodes.API_ERROR, 'Failed to update artifact', { canTryAgain: true });
            }

            // Update local storage
            const updatedArtifact: DecryptedArtifact = {
                ...currentArtifact,
                title,
                sessions,
                draft,
                body,
                headerVersion: response.headerVersion !== undefined ? response.headerVersion : headerVersion,
                bodyVersion: response.bodyVersion !== undefined ? response.bodyVersion : bodyVersion,
                updatedAt: Date.now(),
            };
            
            storage.getState().updateArtifact(updatedArtifact);
        } catch (error) {
            console.error('Failed to update artifact:', error);
            throw error;
        }
    }

    private fetchMachines = async () => {
        if (!this.credentials) return;

        console.log('📊 Sync: Fetching machines...');
        const API_ENDPOINT = getServerUrl();
        const response = await authenticatedFetch(
            `${API_ENDPOINT}/v1/machines`,
            this.credentials,
            { headers: { 'Content-Type': 'application/json' } },
            'fetching machines'
        );

        if (!response.ok) {
            console.error(`Failed to fetch machines: ${response.status}`);
            return;
        }

        const data = await response.json() as { machines?: Array<{
            id: string;
            metadata: string;
            metadataVersion: number;
            daemonState?: string | null;
            daemonStateVersion?: number;
            dataEncryptionKey?: string | null;
            seq: number;
            active: boolean;
            activeAt: number;
            createdAt: number;
            updatedAt: number;
        }> };
        const machines = data.machines ?? [];
        console.log(`📊 Sync: Fetched ${machines.length} machines from server`);

        // First, collect and decrypt encryption keys for all machines
        const machineKeysMap = new Map<string, Uint8Array | null>();
        for (const machine of machines) {
            if (machine.dataEncryptionKey) {
                const decryptedKey = await this.encryption.decryptEncryptionKey(machine.dataEncryptionKey);
                if (!decryptedKey) {
                    console.error(`Failed to decrypt data encryption key for machine ${machine.id}`);
                    continue;
                }
                machineKeysMap.set(machine.id, decryptedKey);
            } else {
                machineKeysMap.set(machine.id, null);
            }
        }

        // Initialize machine encryptions
        await this.encryption.initializeMachines(machineKeysMap);

        // Process all machines first, then update state once
        const decryptedMachines: Machine[] = [];

        for (const machine of machines) {
            // Get machine-specific encryption (might exist from previous initialization)
            const machineEncryption = this.encryption.getMachineEncryption(machine.id);
            if (!machineEncryption) {
                console.error(`Machine encryption not found for ${machine.id} - this should never happen`);
                continue;
            }

            try {

                // Use machine-specific encryption (which handles fallback internally)
                const metadata = machine.metadata
                    ? await machineEncryption.decryptMetadata(machine.metadataVersion, machine.metadata)
                    : null;

                const daemonState = machine.daemonState
                    ? await machineEncryption.decryptDaemonState(machine.daemonStateVersion || 0, machine.daemonState)
                    : null;

                decryptedMachines.push({
                    id: machine.id,
                    seq: machine.seq,
                    createdAt: machine.createdAt,
                    updatedAt: machine.updatedAt,
                    active: machine.active,
                    activeAt: machine.activeAt,
                    metadata,
                    metadataVersion: machine.metadataVersion,
                    daemonState,
                    daemonStateVersion: machine.daemonStateVersion || 0
                });
            } catch (error) {
                console.error(`Failed to decrypt machine ${machine.id}:`, error);
                // Still add the machine with null metadata
                decryptedMachines.push({
                    id: machine.id,
                    seq: machine.seq,
                    createdAt: machine.createdAt,
                    updatedAt: machine.updatedAt,
                    active: machine.active,
                    activeAt: machine.activeAt,
                    metadata: null,
                    metadataVersion: machine.metadataVersion,
                    daemonState: null,
                    daemonStateVersion: 0
                });
            }
        }

        // Replace entire machine state with fetched machines
        storage.getState().applyMachines(decryptedMachines, true);
        log.log(`🖥️ fetchMachines completed - processed ${decryptedMachines.length} machines`);
    }

    private fetchFriends = async () => {
        if (!this.credentials) return;
        
        try {
            log.log('👥 Fetching friends list...');
            const friendsList = await getFriendsList(this.credentials);
            storage.getState().applyFriends(friendsList);
            log.log(`👥 fetchFriends completed - processed ${friendsList.length} friends`);
        } catch (error) {
            console.error('Failed to fetch friends:', error);
            // Silently handle error - UI will show appropriate state
        }
    }

    private fetchFriendRequests = async () => {
        // Friend requests are now included in the friends list with status='pending'
        // This method is kept for backward compatibility but does nothing
        log.log('👥 fetchFriendRequests called - now handled by fetchFriends');
    }

    private fetchTodos = async () => {
        if (!this.credentials) return;

        try {
            log.log('📝 Fetching todos...');
            await initializeTodoSync(this.credentials);
            log.log('📝 Todos loaded');
        } catch {
            // Todo fetching is non-critical - UI shows appropriate state on failure
            log.log('📝 Failed to fetch todos');
        }
    }

    private applyTodoSocketUpdates = async (changes: any[]) => {
        if (!this.credentials || !this.encryption) return;

        const currentState = storage.getState();
        const todoState = currentState.todoState;
        if (!todoState) {
            // No todo state yet, just refetch
            this.todosSync.invalidate();
            return;
        }

        const { todos, undoneOrder, doneOrder, versions } = todoState;
        let updatedTodos = { ...todos };
        let updatedVersions = { ...versions };
        let _indexUpdated = false;
        let newUndoneOrder = undoneOrder;
        let newDoneOrder = doneOrder;

        // Track failed keys to prevent partial state application
        const failedKeys: string[] = [];

        // Process each change
        for (const change of changes) {
            try {
                const key = change.key;
                const version = change.version;

                // Update version tracking
                updatedVersions[key] = version;

                if (change.value === null) {
                    // Item was deleted
                    if (key.startsWith('todo.') && key !== 'todo.index') {
                        const todoId = key.substring(5); // Remove 'todo.' prefix
                        delete updatedTodos[todoId];
                        newUndoneOrder = newUndoneOrder.filter(id => id !== todoId);
                        newDoneOrder = newDoneOrder.filter(id => id !== todoId);
                    }
                } else {
                    // Item was added or updated
                    const decrypted = await this.encryption.decryptRaw(change.value);

                    if (key === 'todo.index') {
                        // Update the index
                        const index = decrypted as any;
                        newUndoneOrder = index.undoneOrder || [];
                        newDoneOrder = index.completedOrder || []; // Map completedOrder to doneOrder
                        _indexUpdated = true;
                    } else if (key.startsWith('todo.')) {
                        // Update a todo item
                        const todoId = key.substring(5);
                        if (todoId && todoId !== 'index') {
                            updatedTodos[todoId] = decrypted as any;
                        }
                    }
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                log.log(`📝 Failed to process todo change for key ${change.key}: ${errorMessage}`);
                failedKeys.push(change.key);
            }
        }

        // If critical changes failed (todo.index), trigger full refetch without applying partial state
        if (failedKeys.some(key => key === 'todo.index')) {
            log.log(`📝 Critical todo change (todo.index) failed, triggering full refetch`);
            this.todosSync.invalidate();
            return;
        }

        // Only apply state if all changes processed successfully
        if (failedKeys.length === 0) {
            storage.getState().applyTodos({
                todos: updatedTodos,
                undoneOrder: newUndoneOrder,
                doneOrder: newDoneOrder,
                versions: updatedVersions
            });
            log.log('📝 Applied todo socket updates successfully');
        } else {
            // Some changes failed - trigger full refetch to ensure data consistency
            log.log(`📝 ${failedKeys.length} todo change(s) failed [${failedKeys.join(', ')}], triggering full refetch`);
            this.todosSync.invalidate();
        }
    }

    private fetchFeed = async () => {
        if (!this.credentials) return;

        try {
            log.log('📰 Fetching feed...');
            const state = storage.getState();
            const existingItems = state.feedItems;
            const head = state.feedHead;
            
            // Load feed items - if we have a head, load newer items
            let allItems: FeedItem[] = [];
            let hasMore = true;
            let cursor = head ? { after: head } : undefined;
            let loadedCount = 0;
            const maxItems = 500;
            
            // Keep loading until we reach known items or hit max limit
            while (hasMore && loadedCount < maxItems) {
                const response = await fetchFeed(this.credentials, {
                    limit: 100,
                    ...cursor
                });
                
                // Check if we reached known items
                const foundKnown = response.items.some(item => 
                    existingItems.some(existing => existing.id === item.id)
                );
                
                allItems.push(...response.items);
                loadedCount += response.items.length;
                hasMore = response.hasMore && !foundKnown;
                
                // Update cursor for next page
                if (response.items.length > 0) {
                    const lastItem = response.items[response.items.length - 1];
                    cursor = { after: lastItem.cursor };
                }
            }
            
            // If this is initial load (no head), also load older items
            if (!head && allItems.length < 100) {
                const response = await fetchFeed(this.credentials, {
                    limit: 100
                });
                allItems.push(...response.items);
            }
            
            // Collect user IDs from friend-related feed items
            const userIds = new Set<string>();
            allItems.forEach(item => {
                if (item.body && (item.body.kind === 'friend_request' || item.body.kind === 'friend_accepted')) {
                    userIds.add(item.body.uid);
                }
            });
            
            // Fetch missing users
            if (userIds.size > 0) {
                await this.assumeUsers(Array.from(userIds));
            }
            
            // Filter out items where user is not found (404)
            const users = storage.getState().users;
            const compatibleItems = allItems.filter(item => {
                // Keep text items
                if (item.body.kind === 'text') return true;
                
                // For friend-related items, check if user exists and is not null (404)
                if (item.body.kind === 'friend_request' || item.body.kind === 'friend_accepted') {
                    const userProfile = users[item.body.uid];
                    // Keep item only if user exists and is not null
                    return userProfile !== null && userProfile !== undefined;
                }
                
                return true;
            });
            
            // Apply only compatible items to storage
            storage.getState().applyFeedItems(compatibleItems);
            log.log(`📰 fetchFeed completed - loaded ${compatibleItems.length} compatible items (${allItems.length - compatibleItems.length} filtered)`);
        } catch (error) {
            console.error('Failed to fetch feed:', error);
        }
    }

    private syncSettings = async () => {
        if (!this.credentials) return;

        const API_ENDPOINT = getServerUrl();
        // Apply pending settings
        if (Object.keys(this.pendingSettings).length > 0) {

            while (true) {
                let version = storage.getState().settingsVersion;
                let settings = applySettings(storage.getState().settings, this.pendingSettings);
                const response = await authenticatedFetch(
                    `${API_ENDPOINT}/v1/account/settings`,
                    this.credentials,
                    {
                        method: 'POST',
                        body: JSON.stringify({
                            settings: await this.encryption.encryptRaw(settings),
                            expectedVersion: version ?? 0
                        }),
                        headers: { 'Content-Type': 'application/json' }
                    },
                    'updating settings'
                );
                const data = await response.json() as {
                    success: false,
                    error: string,
                    currentVersion: number,
                    currentSettings: string | null
                } | {
                    success: true
                };
                if (data.success) {
                    break;
                }
                if (data.error === 'version-mismatch') {
                    let parsedSettings: Settings;
                    if (data.currentSettings) {
                        parsedSettings = settingsParse(await this.encryption.decryptRaw(data.currentSettings));
                    } else {
                        parsedSettings = { ...settingsDefaults };
                    }

                    // Log
                    console.log('settings', JSON.stringify({
                        settings: parsedSettings,
                        version: data.currentVersion
                    }));

                    // Apply settings to storage
                    storage.getState().applySettings(parsedSettings, data.currentVersion);

                    // Clear pending
                    savePendingSettings({});

                    // Sync PostHog opt-out state with settings
                    if (tracking) {
                        if (parsedSettings.analyticsOptOut) {
                            tracking.optOut();
                        } else {
                            tracking.optIn();
                        }
                    }

                } else {
                    throw new AppError(ErrorCodes.SYNC_FAILED, `Failed to sync settings: ${data.error}`, { canTryAgain: true });
                }

                // Wait 1 second
                await new Promise(resolve => setTimeout(resolve, 1000));
                break;
            }
        }

        // Run request
        const response = await authenticatedFetch(
            `${API_ENDPOINT}/v1/account/settings`,
            this.credentials,
            { headers: { 'Content-Type': 'application/json' } },
            'fetching settings'
        );
        if (!response.ok) {
            throw new AppError(ErrorCodes.FETCH_FAILED, `Failed to fetch settings: ${response.status}`, { canTryAgain: true });
        }
        const data = await response.json() as {
            settings: string | null,
            settingsVersion: number
        };

        // Parse response
        let parsedSettings: Settings;
        if (data.settings) {
            parsedSettings = settingsParse(await this.encryption.decryptRaw(data.settings));
        } else {
            parsedSettings = { ...settingsDefaults };
        }

        // Log
        console.log('settings', JSON.stringify({
            settings: parsedSettings,
            version: data.settingsVersion
        }));

        // Apply settings to storage
        storage.getState().applySettings(parsedSettings, data.settingsVersion);

        // Sync PostHog opt-out state with settings
        if (tracking) {
            if (parsedSettings.analyticsOptOut) {
                tracking.optOut();
            } else {
                tracking.optIn();
            }
        }
    }

    private fetchProfile = async () => {
        if (!this.credentials) return;

        // HAP-497: Track sync timing for metrics
        const syncStartTime = Date.now();
        // HAP-497: Track if we're using conditional request (ETag)
        const hasETag = !!this.profileETag;

        const API_ENDPOINT = getServerUrl();

        // HAP-491: Build headers with conditional request support
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        // Include If-None-Match header if we have a cached ETag
        if (this.profileETag) {
            headers['If-None-Match'] = this.profileETag;
        }

        const response = await authenticatedFetch(
            `${API_ENDPOINT}/v1/account/profile`,
            this.credentials,
            { headers },
            'fetching profile'
        );

        // HAP-491: Handle 304 Not Modified - profile unchanged, skip processing
        if (response.status === 304) {
            log.log('[sync] Profile unchanged (304)');
            // HAP-497: Log cached response as a cache hit (0 bytes transferred)
            logSyncMetrics({
                type: 'profile',
                mode: 'cached',
                bytesReceived: 0,
                itemsReceived: 0,
                itemsSkipped: 1, // Profile was cached, so 1 item "skipped"
                durationMs: Date.now() - syncStartTime
            });
            return;
        }

        if (!response.ok) {
            throw new AppError(ErrorCodes.FETCH_FAILED, `Failed to fetch profile: ${response.status}`, { canTryAgain: true });
        }

        // HAP-491: Store ETag from response for next conditional request
        // HAP-496: Schedule persistence when ETag changes
        const newETag = response.headers.get('ETag');
        if (newETag && newETag !== this.profileETag) {
            this.profileETag = newETag;
            this.scheduleSyncStatePersist();
        }

        const data = await response.json();
        // HAP-497: Estimate bytes received
        const bytesReceived = JSON.stringify(data).length;
        const parsedProfile = profileParse(data);

        // Log profile data for debugging
        console.log('profile', JSON.stringify({
            id: parsedProfile.id,
            timestamp: parsedProfile.timestamp,
            firstName: parsedProfile.firstName,
            lastName: parsedProfile.lastName,
            hasAvatar: !!parsedProfile.avatar,
            hasGitHub: !!parsedProfile.github
        }));

        // Apply profile to storage
        storage.getState().applyProfile(parsedProfile);

        // HAP-497: Log sync metrics - 'incremental' if we sent ETag (conditional), 'full' otherwise
        logSyncMetrics({
            type: 'profile',
            mode: hasETag ? 'incremental' : 'full',
            bytesReceived,
            itemsReceived: 1,
            itemsSkipped: 0,
            durationMs: Date.now() - syncStartTime
        });
    }

    private fetchNativeUpdate = async () => {
        try {
            // Skip in development
            if ((Platform.OS !== 'android' && Platform.OS !== 'ios') || !Constants.expoConfig?.version) {
                return;
            }
            if (Platform.OS === 'ios' && !Constants.expoConfig?.ios?.bundleIdentifier) {
                return;
            }
            if (Platform.OS === 'android' && !Constants.expoConfig?.android?.package) {
                return;
            }

            const serverUrl = getServerUrl();

            // Get platform and app identifiers
            const platform = Platform.OS;
            const version = Constants.expoConfig?.version ?? 'unknown';
            const appId = Platform.OS === 'ios'
                ? (Constants.expoConfig?.ios?.bundleIdentifier ?? 'unknown')
                : (Constants.expoConfig?.android?.package ?? 'unknown');

            const response = await fetchWithTimeout(`${serverUrl}/v1/version`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    platform,
                    version,
                    app_id: appId,
                }),
            });

            if (!response.ok) {
                console.log(`[fetchNativeUpdate] Request failed: ${response.status}`);
                return;
            }

            const data = await response.json();
            console.log('[fetchNativeUpdate] Data:', data);

            // Apply update status to storage
            if (data.update_required && data.update_url) {
                storage.getState().applyNativeUpdateStatus({
                    available: true,
                    updateUrl: data.update_url
                });
            } else {
                storage.getState().applyNativeUpdateStatus({
                    available: false
                });
            }
        } catch (error) {
            console.log('[fetchNativeUpdate] Error:', error);
            storage.getState().applyNativeUpdateStatus(null);
        }
    }

    private syncPurchases = async () => {
        try {
            // Initialize RevenueCat if not already done
            if (!this.revenueCatInitialized) {
                // Get the appropriate API key based on platform
                let apiKey: string | undefined;

                if (Platform.OS === 'ios') {
                    apiKey = config.revenueCatAppleKey;
                } else if (Platform.OS === 'android') {
                    apiKey = config.revenueCatGoogleKey;
                } else if (Platform.OS === 'web') {
                    apiKey = config.revenueCatStripeKey;
                }

                if (!apiKey) {
                    console.log(`RevenueCat: No API key found for platform ${Platform.OS}`);
                    return;
                }

                // Configure RevenueCat
                if (__DEV__) {
                    RevenueCat.setLogLevel(LogLevel.DEBUG);
                }

                // Initialize with the public ID as user ID
                RevenueCat.configure({
                    apiKey,
                    appUserID: this.serverID, // In server this is a CUID, which we can assume is globaly unique even between servers
                    useAmazon: false,
                });

                this.revenueCatInitialized = true;
                console.log('RevenueCat initialized successfully');
            }

            // Sync purchases
            await RevenueCat.syncPurchases();

            // Fetch customer info
            const customerInfo = await RevenueCat.getCustomerInfo();

            // Apply to storage (storage handles the transformation)
            storage.getState().applyPurchases(customerInfo);

        } catch (error) {
            console.error('Failed to sync purchases:', error);
            // Don't throw - purchases are optional
        }
    }

    private fetchMessages = async (sessionId: string) => {
        log.log(`💬 fetchMessages starting for session ${sessionId} - acquiring lock`);
        // HAP-497: Track sync timing for metrics
        const syncStartTime = Date.now();

        // Get encryption - may not be ready yet if session was just created
        // Throwing an error triggers backoff retry in InvalidateSync
        const encryption = this.encryption.getSessionEncryption(sessionId);
        if (!encryption) {
            log.log(`💬 fetchMessages: Session encryption not ready for ${sessionId}, will retry`);
            throw new Error(`Session encryption not ready for ${sessionId}`);
        }

        // Get the last received sequence number for cursor-based fetching
        const lastSeq = this.sessionLastSeq.get(sessionId);
        // HAP-497: Track sync mode for metrics
        const isIncremental = lastSeq !== undefined;

        // Request with cursor if we have previous messages
        const url = lastSeq !== undefined
            ? `/v1/sessions/${sessionId}/messages?sinceSeq=${lastSeq}`
            : `/v1/sessions/${sessionId}/messages`;
        log.log(`💬 fetchMessages: Requesting ${url} (lastSeq=${lastSeq ?? 'none'})`);

        const response = await apiSocket.request(url);
        const data = await response.json();
        const messages = data.messages as ApiMessage[];
        // HAP-497: Estimate bytes received (JSON serialization approximation)
        const bytesReceived = JSON.stringify(data).length;

        // No new messages - nothing to process
        if (messages.length === 0) {
            log.log(`💬 fetchMessages: No new messages for session ${sessionId}`);
            // HAP-497: Log metrics for empty response (still useful for optimization tracking)
            logSyncMetrics({
                type: 'messages',
                mode: isIncremental ? 'incremental' : 'full',
                bytesReceived,
                itemsReceived: 0,
                itemsSkipped: 0,
                durationMs: Date.now() - syncStartTime,
                sessionId
            });
            return;
        }

        // Decrypt and normalize messages
        const start = Date.now();

        // Safety filter: skip any messages we might have already processed
        // (handles edge cases like server reordering or duplicate delivery)
        const messagesToDecrypt = lastSeq !== undefined
            ? messages.filter(msg => msg.seq > lastSeq)
            : messages;
        // HAP-497: Track messages skipped due to duplicate filtering
        const itemsSkipped = messages.length - messagesToDecrypt.length;

        if (messagesToDecrypt.length === 0) {
            log.log(`💬 fetchMessages: All messages already processed for session ${sessionId}`);
            // HAP-497: Log metrics when all messages were duplicates
            logSyncMetrics({
                type: 'messages',
                mode: isIncremental ? 'incremental' : 'full',
                bytesReceived,
                itemsReceived: 0,
                itemsSkipped: messages.length,
                durationMs: Date.now() - syncStartTime,
                sessionId
            });
            return;
        }

        // Batch decrypt all messages at once
        const decryptedMessages = await encryption.decryptMessages(messagesToDecrypt);

        // Process decrypted messages
        const normalizedMessages: NormalizedMessage[] = [];
        let maxSeq = lastSeq ?? 0;

        for (let i = 0; i < decryptedMessages.length; i++) {
            const decrypted = decryptedMessages[i];
            if (decrypted) {
                // Track the highest seq for next cursor (seq can be null for legacy messages)
                if (decrypted.seq !== null && decrypted.seq > maxSeq) {
                    maxSeq = decrypted.seq;
                }
                // Normalize the decrypted message
                const normalized = normalizeRawMessage(decrypted.id, decrypted.localId, decrypted.createdAt, decrypted.content);
                if (normalized) {
                    normalizedMessages.push(normalized);
                }
            }
        }

        // Update the cursor for next fetch
        // HAP-496: Schedule persistence when cursor changes
        this.sessionLastSeq.set(sessionId, maxSeq);
        this.scheduleSyncStatePersist();

        console.log('Batch decrypted and normalized messages in', Date.now() - start, 'ms');
        console.log('normalizedMessages', JSON.stringify(normalizedMessages));

        // Apply to storage
        this.applyMessages(sessionId, normalizedMessages);
        log.log(`💬 fetchMessages completed for session ${sessionId} - processed ${normalizedMessages.length} messages (maxSeq=${maxSeq})`);

        // HAP-497: Log sync metrics for optimization tracking
        logSyncMetrics({
            type: 'messages',
            mode: isIncremental ? 'incremental' : 'full',
            bytesReceived,
            itemsReceived: normalizedMessages.length,
            itemsSkipped,
            durationMs: Date.now() - syncStartTime,
            sessionId
        });
    }

    private registerPushToken = async () => {
        log.log('registerPushToken');
        // Only register on mobile platforms
        if (Platform.OS === 'web') {
            return;
        }

        // Request permission
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        log.log('existingStatus: ' + JSON.stringify(existingStatus));

        if (existingStatus !== 'granted') {
            const { status } = await Notifications.requestPermissionsAsync();
            finalStatus = status;
        }
        log.log('finalStatus: ' + JSON.stringify(finalStatus));

        if (finalStatus !== 'granted') {
            console.log('Failed to get push token for push notification!');
            return;
        }

        // Get push token
        const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;

        const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
        log.log('tokenData: ' + JSON.stringify(tokenData));

        // Register with server
        try {
            await registerPushToken(this.credentials, tokenData.data);
            log.log('Push token registered successfully');
        } catch (error) {
            log.log('Failed to register push token: ' + JSON.stringify(error));
        }
    }

    private subscribeToUpdates = () => {
        // Subscribe to message updates and store cleanup functions
        this.socketCleanups.push(
            apiSocket.onMessage('update', this.handleUpdate.bind(this)),
            apiSocket.onMessage('ephemeral', this.handleEphemeralUpdate.bind(this)),

            // Subscribe to connection state changes
            apiSocket.onReconnected(() => {
                log.log('🔌 Socket reconnected');
                // HAP-441: Request delta sync instead of full invalidation
                this.requestDeltaSync();
            })
        );
    }

    /**
     * HAP-441: Request delta sync on reconnection.
     * HAP-558: Delegates to orchestrateDeltaSync for testability.
     *
     * Sends last known seq numbers to server to get only missed updates.
     * Falls back to full invalidation if delta sync fails or times out.
     */
    private requestDeltaSync = async () => {
        await orchestrateDeltaSync({
            getSeq: (entityType) => this.getLastKnownSeq(entityType),
            emitWithAck: (event, data, timeoutMs) =>
                apiSocket.emitWithAck<DeltaSyncResponse>(event, data, timeoutMs),
            handleUpdate: this.handleUpdate,
            performFullInvalidation: this.performFullInvalidation,
            invalidateNonDeltaSyncs: () => {
                this.friendsSync.invalidate();
                this.friendRequestsSync.invalidate();
                this.feedSync.invalidate();

                // Invalidate git status for all sessions on reconnection
                const sessionsData = storage.getState().sessionsData;
                if (sessionsData) {
                    for (const item of sessionsData) {
                        if (typeof item !== 'string') {
                            gitStatusSync.invalidate(item.id);
                        }
                    }
                }
            },
            log: (msg) => log.log(msg),
        });
    }

    /**
     * HAP-441: Perform full invalidation (original behavior).
     * HAP-455: Now with staggered invalidation to prevent network spike.
     * Used as fallback when delta sync fails or on fresh connections.
     *
     * Priority tiers for reconnection:
     * - Priority 1 (immediate): Sessions - core data users see first
     * - Priority 2 (100ms delay): Machines, artifacts - secondary data
     * - Priority 3 (200ms delay): Social features, message syncs
     */
    private performFullInvalidation = () => {
        // Priority 1: Sessions (immediate) - most visible to user
        this.sessionsSync.invalidate();

        // Priority 2: Machines and artifacts (100ms delay)
        setTimeout(() => {
            this.machinesSync.invalidate();
            log.log('🔌 Full sync: Invalidating artifacts sync (staggered)');
            this.artifactsSync.invalidate();
        }, 100);

        // Priority 3: Social features and per-session syncs (200ms delay)
        setTimeout(() => {
            this.friendsSync.invalidate();
            this.friendRequestsSync.invalidate();
            this.feedSync.invalidate();

            // Invalidate per-session message syncs and git status
            const sessionsData = storage.getState().sessionsData;
            if (sessionsData) {
                for (const item of sessionsData) {
                    if (typeof item !== 'string') {
                        this.messagesSync.get(item.id)?.invalidate();
                        gitStatusSync.invalidate(item.id);
                    }
                }
            }
        }, 200);
    }

    /**
     * HAP-441: Map update types to entity types for seq tracking.
     * Returns the entity type (sessions, machines, artifacts) or null if not trackable.
     * HAP-486: Delegates to extracted utility for testability.
     */
    private getEntityTypeFromUpdate(updateType: string): string | null {
        return getEntityTypeFromUpdateUtil(updateType);
    }

    /**
     * HAP-441: Track the last known sequence number for an entity type.
     * Called whenever we receive an update to ensure we know the latest seq.
     * HAP-496: Schedules sync state persistence when seq changes.
     * HAP-486: Delegates to extracted utility for testability.
     */
    private trackSeq(entityType: string, seq: number | undefined) {
        const updated = trackSeqUtil(this.lastKnownSeq, entityType, seq);
        if (updated) {
            this.scheduleSyncStatePersist(); // HAP-496
        }
    }

    /**
     * HAP-441: Get last known seq for an entity type, defaulting to 0.
     * HAP-486: Delegates to extracted utility for testability.
     */
    private getLastKnownSeq(entityType: string): number {
        return getLastKnownSeqUtil(this.lastKnownSeq, entityType);
    }

    /**
     * HAP-496: Load persisted sync state from storage.
     *
     * Restores cursor/ETag/seq data from previous session if fresh (< 24h).
     * Called in #init() before invalidating syncs to enable immediate
     * incremental sync on app restart.
     */
    private loadPersistedSyncState(): void {
        const state = loadSyncState();
        if (!state) {
            log.log('[HAP-496] No persisted sync state found (first launch or expired)');
            return;
        }

        // Restore sessionLastSeq
        const sessionCount = Object.keys(state.sessionLastSeq).length;
        for (const [sessionId, seq] of Object.entries(state.sessionLastSeq)) {
            this.sessionLastSeq.set(sessionId, seq);
        }

        // Restore profileETag
        this.profileETag = state.profileETag;

        // Restore entity sequence numbers
        const entityCount = Object.keys(state.entitySeq).length;
        for (const [entityType, seq] of Object.entries(state.entitySeq)) {
            this.lastKnownSeq.set(entityType, seq);
        }

        log.log(`[HAP-496] Restored sync state: ${sessionCount} sessions, ${entityCount} entities, ETag=${state.profileETag ? 'present' : 'none'}`);
    }

    /**
     * HAP-496: Persist current sync state to storage immediately.
     *
     * Called by the debounced wrapper and on app background.
     */
    private persistSyncStateNow(): void {
        saveSyncState({
            sessionLastSeq: Object.fromEntries(this.sessionLastSeq),
            profileETag: this.profileETag,
            entitySeq: Object.fromEntries(this.lastKnownSeq),
        });
    }

    /**
     * HAP-496: Schedule sync state persistence (debounced).
     *
     * Should be called whenever sessionLastSeq, profileETag, or lastKnownSeq changes.
     */
    private scheduleSyncStatePersist(): void {
        this.syncStatePersistence.debounced();
    }

    private handleUpdate = async (update: unknown) => {
        const validatedUpdate = ApiUpdateContainerSchema.safeParse(update);
        if (!validatedUpdate.success) {
            log.log(`❌ Invalid update received: ${validatedUpdate.error}`);
            return;
        }
        const updateData = validatedUpdate.data;

        // HAP-441: Track seq for delta sync on reconnection
        // Map update types to their entity type for seq tracking
        const entityType = this.getEntityTypeFromUpdate(updateData.body.t);
        if (entityType) {
            this.trackSeq(entityType, updateData.seq);
        }

        if (updateData.body.t === 'new-message') {

            // Get encryption
            const encryption = this.encryption.getSessionEncryption(updateData.body.sid);
            if (!encryption) { // Should never happen
                console.error(`Session ${updateData.body.sid} not found`);
                this.fetchSessions(); // Just fetch sessions again
                return;
            }

            // Decrypt message
            let lastMessage: NormalizedMessage | null = null;
            if (updateData.body.message) {
                const decrypted = await encryption.decryptMessage(updateData.body.message);
                if (decrypted) {
                    lastMessage = normalizeRawMessage(decrypted.id, decrypted.localId, decrypted.createdAt, decrypted.content);

                    // Update session
                    const session = storage.getState().sessions[updateData.body.sid];
                    if (session) {
                        this.applySessions([{
                            ...session,
                            updatedAt: updateData.createdAt,
                            seq: updateData.seq
                        }])
                    } else {
                        // Fetch sessions again if we don't have this session
                        this.fetchSessions();
                    }

                    // Update messages
                    if (lastMessage) {
                        this.applyMessages(updateData.body.sid, [lastMessage]);
                        let hasMutableTool = false;
                        if (lastMessage.role === 'agent' && lastMessage.content[0] && lastMessage.content[0].type === 'tool-result') {
                            hasMutableTool = storage.getState().isMutableToolCall(updateData.body.sid, lastMessage.content[0].tool_use_id);
                        }
                        if (hasMutableTool) {
                            gitStatusSync.invalidate(updateData.body.sid);
                        }
                    }
                }
            }

            // Ping session
            this.onSessionVisible(updateData.body.sid);

        } else if (updateData.body.t === 'new-session') {
            log.log('🆕 New session update received');
            this.sessionsSync.invalidate();
        } else if (updateData.body.t === 'delete-session') {
            log.log('🗑️ Delete session update received');
            const sessionId = updateData.body.sid;

            // Remove session from storage
            storage.getState().deleteSession(sessionId);

            // Remove encryption keys from memory
            this.encryption.removeSessionEncryption(sessionId);

            // Remove from project manager
            projectManager.removeSession(sessionId);

            // Clear any cached git status
            gitStatusSync.clearForSession(sessionId);

            // HAP-499: Clear file search cache
            fileSearchCache.clearCache(sessionId);

            log.log(`🗑️ Session ${sessionId} deleted from local storage`);
        } else if (updateData.body.t === 'update-session') {
            const session = storage.getState().sessions[updateData.body.id];
            if (session) {
                // Get session encryption
                const sessionEncryption = this.encryption.getSessionEncryption(updateData.body.id);
                if (!sessionEncryption) {
                    console.error(`Session encryption not found for ${updateData.body.id} - this should never happen`);
                    return;
                }

                const agentState = updateData.body.agentState?.value && sessionEncryption
                    ? await sessionEncryption.decryptAgentState(updateData.body.agentState.version, updateData.body.agentState.value)
                    : session.agentState;
                const metadata = updateData.body.metadata?.value && sessionEncryption
                    ? await sessionEncryption.decryptMetadata(updateData.body.metadata.version, updateData.body.metadata.value)
                    : session.metadata;

                this.applySessions([{
                    ...session,
                    agentState,
                    agentStateVersion: updateData.body.agentState
                        ? updateData.body.agentState.version
                        : session.agentStateVersion,
                    metadata,
                    metadataVersion: updateData.body.metadata
                        ? updateData.body.metadata.version
                        : session.metadataVersion,
                    updatedAt: updateData.createdAt,
                    seq: updateData.seq
                }]);

                // Invalidate git status when agent state changes (files may have been modified)
                if (updateData.body.agentState) {
                    gitStatusSync.invalidate(updateData.body.id);

                    // Check for new permission requests and notify voice assistant
                    if (agentState?.requests && Object.keys(agentState.requests).length > 0) {
                        const requestIds = Object.keys(agentState.requests);
                        const firstRequest = agentState.requests[requestIds[0]];
                        const toolName = firstRequest?.tool;
                        voiceHooks.onPermissionRequested(updateData.body.id, requestIds[0], toolName, firstRequest?.arguments);
                    }

                    // Re-fetch messages when control returns to mobile (local -> remote mode switch)
                    // This catches up on any messages that were exchanged while desktop had control
                    // Use strict boolean comparisons to only trigger on actual false->true transitions,
                    // not on undefined->true which can happen on initial session load
                    const wasControlledByUser = Boolean(session.agentState?.controlledByUser);
                    const isNowControlledByUser = Boolean(agentState?.controlledByUser);
                    if (wasControlledByUser === false && isNowControlledByUser === true) {
                        log.log(`🔄 Control returned to mobile for session ${updateData.body.id}, re-fetching messages`);
                        this.onSessionVisible(updateData.body.id);
                    }
                }
            }
        } else if (updateData.body.t === 'update-account') {
            const accountUpdate = updateData.body;
            const currentProfile = storage.getState().profile;

            // Build updated profile with new data
            const updatedProfile: Profile = {
                ...currentProfile,
                firstName: accountUpdate.firstName !== undefined ? accountUpdate.firstName : currentProfile.firstName,
                lastName: accountUpdate.lastName !== undefined ? accountUpdate.lastName : currentProfile.lastName,
                avatar: accountUpdate.avatar !== undefined ? accountUpdate.avatar : currentProfile.avatar,
                github: accountUpdate.github !== undefined ? accountUpdate.github : currentProfile.github,
                timestamp: updateData.createdAt // Update timestamp to latest
            };

            // Apply the updated profile to storage
            storage.getState().applyProfile(updatedProfile);
        } else if (updateData.body.t === 'new-machine') {
            log.log('🆕 New machine update received');
            const newMachineUpdate = updateData.body;
            const machineId = newMachineUpdate.machineId;

            // Skip if machine already exists
            if (storage.getState().machines[machineId]) {
                log.log(`Machine ${machineId} already exists, skipping new-machine update`);
                return;
            }

            // Decrypt the data encryption key if provided
            let decryptedKey: Uint8Array | null = null;
            if (newMachineUpdate.dataEncryptionKey) {
                decryptedKey = await this.encryption.decryptEncryptionKey(newMachineUpdate.dataEncryptionKey);
                if (!decryptedKey) {
                    console.error(`Failed to decrypt data encryption key for new machine ${machineId}`);
                    return;
                }
            }

            // Initialize machine encryption
            const machineKeysMap = new Map<string, Uint8Array | null>();
            machineKeysMap.set(machineId, decryptedKey);
            await this.encryption.initializeMachines(machineKeysMap);

            // Get machine encryption for decryption
            const machineEncryption = this.encryption.getMachineEncryption(machineId);
            if (!machineEncryption) {
                console.error(`Failed to initialize encryption for new machine ${machineId}`);
                return;
            }

            // Decrypt metadata
            let metadata: MachineMetadata | null = null;
            if (newMachineUpdate.metadata) {
                try {
                    metadata = await machineEncryption.decryptMetadata(
                        newMachineUpdate.metadataVersion,
                        newMachineUpdate.metadata
                    );
                } catch (error) {
                    console.error(`Failed to decrypt metadata for new machine ${machineId}:`, error);
                }
            }

            // Decrypt daemonState
            let daemonState: any | null = null;
            if (newMachineUpdate.daemonState) {
                try {
                    daemonState = await machineEncryption.decryptDaemonState(
                        newMachineUpdate.daemonStateVersion,
                        newMachineUpdate.daemonState
                    );
                } catch (error) {
                    console.error(`Failed to decrypt daemonState for new machine ${machineId}:`, error);
                }
            }

            // Create the new machine object
            const newMachine: Machine = {
                id: machineId,
                seq: newMachineUpdate.seq,
                createdAt: newMachineUpdate.createdAt,
                updatedAt: newMachineUpdate.updatedAt,
                active: newMachineUpdate.active,
                activeAt: newMachineUpdate.activeAt,
                metadata,
                metadataVersion: newMachineUpdate.metadataVersion,
                daemonState,
                daemonStateVersion: newMachineUpdate.daemonStateVersion
            };

            // Apply to storage
            storage.getState().applyMachines([newMachine]);
            log.log(`🆕 New machine ${machineId} added to storage`);
        } else if (updateData.body.t === 'update-machine') {
            const machineUpdate = updateData.body;
            const machineId = machineUpdate.machineId;  // Changed from .id to .machineId
            const machine = storage.getState().machines[machineId];

            // Create or update machine with all required fields
            const updatedMachine: Machine = {
                id: machineId,
                seq: updateData.seq,
                createdAt: machine?.createdAt ?? updateData.createdAt,
                updatedAt: updateData.createdAt,
                active: machineUpdate.active ?? true,
                activeAt: machineUpdate.activeAt ?? updateData.createdAt,
                metadata: machine?.metadata ?? null,
                metadataVersion: machine?.metadataVersion ?? 0,
                daemonState: machine?.daemonState ?? null,
                daemonStateVersion: machine?.daemonStateVersion ?? 0
            };

            // Get machine-specific encryption (might not exist if machine wasn't initialized)
            const machineEncryption = this.encryption.getMachineEncryption(machineId);
            if (!machineEncryption) {
                console.error(`Machine encryption not found for ${machineId} - cannot decrypt updates`);
                return;
            }

            // If metadata is provided, decrypt and update it
            const metadataUpdate = machineUpdate.metadata;
            if (metadataUpdate) {
                try {
                    const metadata = await machineEncryption.decryptMetadata(metadataUpdate.version, metadataUpdate.value);
                    updatedMachine.metadata = metadata;
                    updatedMachine.metadataVersion = metadataUpdate.version;
                } catch (error) {
                    console.error(`Failed to decrypt machine metadata for ${machineId}:`, error);
                }
            }

            // If daemonState is provided, decrypt and update it
            const daemonStateUpdate = machineUpdate.daemonState;
            if (daemonStateUpdate) {
                try {
                    const daemonState = await machineEncryption.decryptDaemonState(daemonStateUpdate.version, daemonStateUpdate.value);
                    updatedMachine.daemonState = daemonState;
                    updatedMachine.daemonStateVersion = daemonStateUpdate.version;
                } catch (error) {
                    console.error(`Failed to decrypt machine daemonState for ${machineId}:`, error);
                }
            }

            // Update storage using applyMachines which rebuilds sessionListViewData
            storage.getState().applyMachines([updatedMachine]);
        } else if (updateData.body.t === 'relationship-updated') {
            log.log('👥 Received relationship-updated update');
            const relationshipUpdate = updateData.body;
            
            // Apply the relationship update to storage
            storage.getState().applyRelationshipUpdate({
                fromUserId: relationshipUpdate.fromUserId,
                toUserId: relationshipUpdate.toUserId,
                status: relationshipUpdate.status,
                action: relationshipUpdate.action,
                fromUser: relationshipUpdate.fromUser,
                toUser: relationshipUpdate.toUser,
                timestamp: relationshipUpdate.timestamp
            });
            
            // Invalidate friends data to refresh with latest changes
            this.friendsSync.invalidate();
            this.friendRequestsSync.invalidate();
            this.feedSync.invalidate();
        } else if (updateData.body.t === 'new-artifact') {
            log.log('📦 Received new-artifact update');
            const artifactUpdate = updateData.body;
            const artifactId = artifactUpdate.artifactId;
            
            try {
                // Decrypt the data encryption key
                const decryptedKey = await this.encryption.decryptEncryptionKey(artifactUpdate.dataEncryptionKey);
                if (!decryptedKey) {
                    console.error(`Failed to decrypt key for new artifact ${artifactId}`);
                    return;
                }
                
                // Store the decrypted key in memory
                this.artifactDataKeys.set(artifactId, decryptedKey);
                
                // Create artifact encryption instance
                const artifactEncryption = new ArtifactEncryption(decryptedKey);
                
                // Decrypt header
                const header = await artifactEncryption.decryptHeader(artifactUpdate.header);
                
                // Decrypt body if provided
                let decryptedBody: string | null | undefined = undefined;
                if (artifactUpdate.body && artifactUpdate.bodyVersion !== undefined) {
                    const body = await artifactEncryption.decryptBody(artifactUpdate.body);
                    decryptedBody = body?.body || null;
                }
                
                // Add to storage
                const decryptedArtifact: DecryptedArtifact = {
                    id: artifactId,
                    title: header?.title || null,
                    body: decryptedBody,
                    headerVersion: artifactUpdate.headerVersion,
                    bodyVersion: artifactUpdate.bodyVersion,
                    seq: artifactUpdate.seq,
                    createdAt: artifactUpdate.createdAt,
                    updatedAt: artifactUpdate.updatedAt,
                    isDecrypted: !!header,
                };
                
                storage.getState().addArtifact(decryptedArtifact);
                log.log(`📦 Added new artifact ${artifactId} to storage`);
            } catch (error) {
                console.error(`Failed to process new artifact ${artifactId}:`, error);
            }
        } else if (updateData.body.t === 'update-artifact') {
            log.log('📦 Received update-artifact update');
            const artifactUpdate = updateData.body;
            const artifactId = artifactUpdate.artifactId;
            
            // Get existing artifact
            const existingArtifact = storage.getState().artifacts[artifactId];
            if (!existingArtifact) {
                console.error(`Artifact ${artifactId} not found in storage`);
                // Fetch all artifacts to sync
                this.artifactsSync.invalidate();
                return;
            }
            
            try {
                // Get the data encryption key from memory
                let dataEncryptionKey = this.artifactDataKeys.get(artifactId);
                if (!dataEncryptionKey) {
                    console.error(`Encryption key not found for artifact ${artifactId}, fetching artifacts`);
                    this.artifactsSync.invalidate();
                    return;
                }
                
                // Create artifact encryption instance
                const artifactEncryption = new ArtifactEncryption(dataEncryptionKey);
                
                // Update artifact with new data  
                const updatedArtifact: DecryptedArtifact = {
                    ...existingArtifact,
                    seq: updateData.seq,
                    updatedAt: updateData.createdAt,
                };
                
                // Decrypt and update header if provided
                if (artifactUpdate.header) {
                    const header = await artifactEncryption.decryptHeader(artifactUpdate.header.value);
                    updatedArtifact.title = header?.title || null;
                    updatedArtifact.sessions = header?.sessions;
                    updatedArtifact.draft = header?.draft;
                    updatedArtifact.headerVersion = artifactUpdate.header.version;
                }
                
                // Decrypt and update body if provided
                if (artifactUpdate.body) {
                    const body = await artifactEncryption.decryptBody(artifactUpdate.body.value);
                    updatedArtifact.body = body?.body || null;
                    updatedArtifact.bodyVersion = artifactUpdate.body.version;
                }
                
                storage.getState().updateArtifact(updatedArtifact);
                log.log(`📦 Updated artifact ${artifactId} in storage`);
            } catch (error) {
                console.error(`Failed to process artifact update ${artifactId}:`, error);
            }
        } else if (updateData.body.t === 'delete-artifact') {
            log.log('📦 Received delete-artifact update');
            const artifactUpdate = updateData.body;
            const artifactId = artifactUpdate.artifactId;
            
            // Remove from storage
            storage.getState().deleteArtifact(artifactId);
            
            // Remove encryption key from memory
            this.artifactDataKeys.delete(artifactId);
        } else if (updateData.body.t === 'new-feed-post') {
            log.log('📰 Received new-feed-post update');
            const feedUpdate = updateData.body;

            // Validate cursor format before processing
            if (!isValidCursor(feedUpdate.cursor)) {
                log.log(`⚠️ Skipping feed update with invalid cursor: ${feedUpdate.cursor}`);
                return;
            }

            // Convert to FeedItem with counter from validated cursor
            const feedItem: FeedItem = {
                id: feedUpdate.id,
                body: feedUpdate.body,
                cursor: feedUpdate.cursor,
                createdAt: feedUpdate.createdAt,
                repeatKey: feedUpdate.repeatKey,
                counter: parseCursorCounterOrDefault(feedUpdate.cursor)
            };
            
            // Check if we need to fetch user for friend-related items
            if (feedItem.body && (feedItem.body.kind === 'friend_request' || feedItem.body.kind === 'friend_accepted')) {
                await this.assumeUsers([feedItem.body.uid]);
                
                // Check if user fetch failed (404) - don't store item if user not found
                const users = storage.getState().users;
                const userProfile = users[feedItem.body.uid];
                if (userProfile === null || userProfile === undefined) {
                    // User was not found or 404, don't store this item
                    log.log(`📰 Skipping feed item ${feedItem.id} - user ${feedItem.body.uid} not found`);
                    return;
                }
            }
            
            // Apply to storage (will handle repeatKey replacement)
            storage.getState().applyFeedItems([feedItem]);
        } else if (updateData.body.t === 'kv-batch-update') {
            log.log('📝 Received kv-batch-update');
            const kvUpdate = updateData.body;

            // Process KV changes for todos
            if (kvUpdate.changes && Array.isArray(kvUpdate.changes)) {
                const todoChanges = kvUpdate.changes.filter(change =>
                    change.key && change.key.startsWith('todo.')
                );

                if (todoChanges.length > 0) {
                    log.log(`📝 Processing ${todoChanges.length} todo KV changes from socket`);

                    // Apply the changes directly to avoid unnecessary refetch
                    try {
                        await this.applyTodoSocketUpdates(todoChanges);
                    } catch (error) {
                        console.error('Failed to apply todo socket updates:', error);
                        // Fallback to refetch on error
                        this.todosSync.invalidate();
                    }
                }
            }
        }
    }

    private flushActivityUpdates = (updates: Map<string, ApiEphemeralActivityUpdate>) => {
        // log.log(`🔄 Flushing activity updates for ${updates.size} sessions - acquiring lock`);


        const sessions: Session[] = [];

        for (const [sessionId, update] of updates) {
            const session = storage.getState().sessions[sessionId];
            if (session) {
                sessions.push({
                    ...session,
                    active: update.active,
                    activeAt: update.activeAt,
                    thinking: update.thinking ?? false,
                    thinkingAt: update.activeAt // Always use activeAt for consistency
                });
            }
        }

        if (sessions.length > 0) {
            // console.log('flushing activity updates ' + sessions.length);
            this.applySessions(sessions);
            // log.log(`🔄 Activity updates flushed - updated ${sessions.length} sessions`);
        }
    }

    private handleEphemeralUpdate = (update: unknown) => {
        const validatedUpdate = ApiEphemeralUpdateSchema.safeParse(update);
        if (!validatedUpdate.success) {
            console.log('Invalid ephemeral update received:', validatedUpdate.error);
            console.error('Invalid ephemeral update received:', update);
            return;
        } else {
            // console.log('Ephemeral update received:', update);
        }
        const updateData = validatedUpdate.data;

        // Process activity updates through smart debounce accumulator
        if (updateData.type === 'activity') {
            // console.log('adding activity update ' + updateData.id);
            this.activityAccumulator.addUpdate(updateData);
        }

        // Handle machine activity updates
        if (updateData.type === 'machine-activity') {
            // Update machine's active status and lastActiveAt
            const machine = storage.getState().machines[updateData.id];
            if (machine) {
                const updatedMachine: Machine = {
                    ...machine,
                    active: updateData.active,
                    activeAt: updateData.activeAt
                };
                storage.getState().applyMachines([updatedMachine]);
            }
        }

        // daemon-status ephemeral updates are deprecated, machine status is handled via machine-activity
    }

    //
    // Apply store
    //

    private applyMessages = (sessionId: string, messages: NormalizedMessage[]) => {
        const result = storage.getState().applyMessages(sessionId, messages);
        let m: Message[] = [];
        for (let messageId of result.changed) {
            const message = storage.getState().sessionMessages[sessionId].messagesMap[messageId];
            if (message) {
                m.push(message);
            }
        }
        if (m.length > 0) {
            voiceHooks.onMessages(sessionId, m);
        }
        if (result.hasReadyEvent) {
            voiceHooks.onReady(sessionId);
        }
    }

    private applySessions = (sessions: (Omit<Session, "presence"> & {
        presence?: "online" | number;
    })[]) => {
        const active = storage.getState().getActiveSessions();
        storage.getState().applySessions(sessions);
        const newActive = storage.getState().getActiveSessions();
        this.applySessionDiff(active, newActive);
    }

    private applySessionDiff = (active: Session[], newActive: Session[]) => {
        let wasActive = new Set(active.map(s => s.id));
        let isActive = new Set(newActive.map(s => s.id));
        for (let s of active) {
            if (!isActive.has(s.id)) {
                voiceHooks.onSessionOffline(s.id, s.metadata ?? undefined);
            }
        }
        for (let s of newActive) {
            if (!wasActive.has(s.id)) {
                voiceHooks.onSessionOnline(s.id, s.metadata ?? undefined);
                
                // HAP-372: Send current contextNotificationsEnabled setting to newly connected session
                const enabled = storage.getState().settings.contextNotificationsEnabled ?? true;
                apiSocket.sessionRPC<{ ok: boolean }, { enabled: boolean }>(
                    s.id,
                    'setContextNotificationsEnabled',
                    { enabled }
                ).catch(() => {}); // Fire and forget - CLI may not support this RPC
            }
        }
    }

    /**
     * Waits for the CLI agent to be ready by watching agentStateVersion.
     *
     * When a session is created, agentStateVersion starts at 0. Once the CLI
     * connects and sends its first state update (via updateAgentState()), the
     * version becomes > 0. This serves as a reliable signal that the CLI's
     * WebSocket is connected and ready to receive messages.
     */
    private waitForAgentReady(sessionId: string, timeoutMs: number = Sync.SESSION_READY_TIMEOUT_MS): Promise<boolean> {
        const startedAt = Date.now();

        return new Promise((resolve) => {
            const done = (ready: boolean, reason: string) => {
                clearTimeout(timeout);
                unsubscribe();
                const duration = Date.now() - startedAt;
                log.log(`Session ${sessionId} ${reason} after ${duration}ms`);
                resolve(ready);
            };

            const check = () => {
                const s = storage.getState().sessions[sessionId];
                if (s && s.agentStateVersion > 0) {
                    done(true, `ready (agentStateVersion=${s.agentStateVersion})`);
                }
            };

            const timeout = setTimeout(() => done(false, 'ready wait timed out'), timeoutMs);
            const unsubscribe = storage.subscribe(check);
            check(); // Check current state immediately
        });
    }
}

// Declare global for hot reload cleanup in development
declare global {
    // eslint-disable-next-line no-var
    var __happySyncInstance: Sync | undefined;
}

// Clean up previous instance if exists (hot reload scenario)
if (__DEV__ && global.__happySyncInstance) {
    global.__happySyncInstance.destroy();
}

// Global singleton instance
export const sync = new Sync();

// Store reference for hot reload cleanup
if (__DEV__) {
    global.__happySyncInstance = sync;
}

//
// Init sequence
//

let isInitialized = false;
let statusChangeCleanup: (() => void) | null = null;
export async function syncCreate(credentials: AuthCredentials) {
    if (isInitialized) {
        console.warn('Sync already initialized: ignoring');
        return;
    }
    isInitialized = true;
    console.log('[syncCreate] Starting sync initialization...');
    try {
        await syncInit(credentials, false);
        console.log('[syncCreate] Sync initialization completed successfully');
    } catch (error) {
        console.error('[syncCreate] Sync initialization failed:', error);
        // Reset isInitialized so user can retry
        isInitialized = false;
        throw error;
    }
}

export async function syncRestore(credentials: AuthCredentials) {
    if (isInitialized) {
        console.warn('Sync already initialized: ignoring');
        return;
    }
    isInitialized = true;
    console.log('[syncRestore] Starting sync restore...');
    try {
        await syncInit(credentials, true);
        console.log('[syncRestore] Sync restore completed successfully');
    } catch (error) {
        console.error('[syncRestore] Sync restore failed:', error);
        // Reset isInitialized so user can retry
        isInitialized = false;
        throw error;
    }
}

async function syncInit(credentials: AuthCredentials, restore: boolean) {
    console.log('[syncInit] Starting...', { restore });

    // Initialize sync engine
    console.log('[syncInit] Decoding secret key...');
    const secretKey = decodeBase64(credentials.secret, 'base64url');
    if (secretKey.length !== 32) {
        throw new AppError(ErrorCodes.VALIDATION_FAILED, `Invalid secret key length: ${secretKey.length}, expected 32`);
    }
    console.log('[syncInit] Secret key decoded, length:', secretKey.length);

    console.log('[syncInit] Creating encryption...');
    const encryption = await Encryption.create(secretKey);
    console.log('[syncInit] Encryption created, anonID:', encryption.anonID);

    // Initialize tracking
    console.log('[syncInit] Initializing tracking...');
    initializeTracking(encryption.anonID);

    // Initialize socket connection
    const API_ENDPOINT = getServerUrl();
    console.log('[syncInit] Initializing socket to:', API_ENDPOINT);
    apiSocket.initialize({ endpoint: API_ENDPOINT, token: credentials.token }, encryption);

    // Clean up previous status change handler if exists (prevents accumulation on hot reload)
    statusChangeCleanup?.();

    // Wire socket status to storage
    statusChangeCleanup = apiSocket.onStatusChange((status) => {
        storage.getState().setSocketStatus(status);
    });

    // Initialize sessions engine
    console.log('[syncInit] Initializing sync engine...');
    if (restore) {
        await sync.restore(credentials, encryption);
    } else {
        await sync.create(credentials, encryption);
    }
    console.log('[syncInit] Sync engine initialized');
}