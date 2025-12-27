import { TokenStorage } from '@/auth/tokenStorage';
import { Encryption } from './encryption/encryption';
import { AppError, ErrorCodes } from '@/utils/errors';
import { fetchWithTimeout } from '@/utils/fetchWithTimeout';
import {
    CORRELATION_ID_HEADER,
    getSessionCorrelationId,
    generateRequestCorrelationId,
    setLastFailedCorrelationId,
    getShortCorrelationId,
} from '@/utils/correlationId';
import * as Crypto from 'expo-crypto';

//
// Types
//

export interface SyncSocketConfig {
    endpoint: string;
    token: string;
}

export interface SyncSocketState {
    isConnected: boolean;
    connectionStatus: 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'error';
    lastError: Error | null;
}

export type SyncSocketListener = (state: SyncSocketState) => void;

/**
 * HAP-589: Response with correlation ID for client-side logging.
 * Enables sync operations to include correlation IDs in debug logs.
 */
export interface ResponseWithCorrelation {
    response: Response;
    correlationId: string;
    /** Short form of correlation ID for log messages (e.g., "f1e2d3c4") */
    shortId: string;
}

/**
 * Message format for native WebSocket protocol.
 * This matches the format used by happy-cli's HappyWebSocket and the Workers backend.
 */
interface HappyMessage {
    event: string;
    data?: unknown;
    ackId?: string;
    ack?: unknown;
}

/**
 * Pending acknowledgement tracking for request-response pattern.
 */
interface PendingAck<T = unknown> {
    resolve: (value: T) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

/**
 * WebSocket configuration for reconnection behavior.
 */
interface WebSocketConfig {
    reconnectionDelay: number;
    reconnectionDelayMax: number;
    randomizationFactor: number;
    ackTimeout: number;
}

/**
 * Default WebSocket reconnection configuration.
 *
 * HAP-477: Max delay increased from 5s to 30s to match CLI behavior
 * and better handle poor network conditions. Mobile devices especially
 * benefit from patience on unstable connections.
 */
const DEFAULT_CONFIG: WebSocketConfig = {
    reconnectionDelay: 1000,        // Start with 1 second delay
    reconnectionDelayMax: 30000,    // Cap at 30 seconds (HAP-477: was 5s)
    randomizationFactor: 0.5,       // ±50% jitter (centered around base)
    ackTimeout: 30000,
};

//
// Main Class
//

class ApiSocket {

    // WebSocket state
    private ws: WebSocket | null = null;
    private config: SyncSocketConfig | null = null;
    private encryption: Encryption | null = null;
    private wsConfig: WebSocketConfig = DEFAULT_CONFIG;

    // Reconnection state
    private reconnectAttempts = 0;
    private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    private isManualClose = false;
    private wasConnectedBefore = false;

    // Event handlers
    private messageHandlers: Map<string, Set<(data: unknown) => void>> = new Map();
    private reconnectedListeners: Set<() => void> = new Set();
    private statusListeners: Set<(status: 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'error') => void> = new Set();
    private currentStatus: 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'error' = 'disconnected';
    private lastError: Error | null = null;
    private errorListeners: Set<(error: Error | null) => void> = new Set();

    // Auth handshake state (HAP-360)
    private authTimeout: ReturnType<typeof setTimeout> | null = null;
    private static readonly AUTH_TIMEOUT_MS = 5000;

    // HAP-375: Track if current connection used ticket auth
    // When true, we don't need to send auth message (server already validated via ticket)
    private usedTicketAuth = false;

    // Acknowledgement tracking for request-response pattern
    private pendingAcks: Map<string, PendingAck> = new Map();

    //
    // Initialization
    //

    initialize(config: SyncSocketConfig, encryption: Encryption) {
        this.config = config;
        this.encryption = encryption;
        this.connect();
    }

    //
    // Connection Management
    //

    connect() {
        if (!this.config || this.ws) {
            return;
        }

        this.isManualClose = false;
        this.updateStatus('connecting');
        this.doConnect();
    }

    /**
     * Internal connection logic - creates WebSocket and sets up handlers.
     *
     * HAP-375: Uses ticket-based authentication for security.
     * 1. First fetches a short-lived ticket from the server via HTTP
     * 2. Then connects with the ticket in the WebSocket URL
     * 3. Server validates ticket and creates authenticated connection immediately
     *
     * This approach keeps auth tokens out of WebSocket URLs while providing
     * immediate authentication (no need to send auth message after connect).
     *
     * Falls back to HAP-360 message-based auth if ticket fetch fails.
     */
    private async doConnect(): Promise<void> {
        if (!this.config) return;

        // Reset ticket auth flag
        this.usedTicketAuth = false;

        // Build WebSocket URL
        const wsUrl = new URL('/v1/updates', this.config.endpoint);
        wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';

        // HAP-510: Include session correlation ID in WebSocket URL for tracing
        const sessionCorrelationId = getSessionCorrelationId();
        wsUrl.searchParams.set('correlationId', sessionCorrelationId);

        // HAP-375: Try to fetch a ticket for secure authentication
        // HAP-533: Intentionally uses fetchWithTimeout instead of authenticatedFetch.
        // This preserves graceful degradation: if the ticket request fails for ANY reason
        // (including 401), we silently fall through to HAP-360 message-based auth.
        // authenticatedFetch would throw TOKEN_EXPIRED on refresh failure, breaking this pattern.
        // With HAP-512 proactive refresh handling 99%+ of token expiry cases, the trade-off
        // favors resilience over consistency with other API calls.
        try {
            const ticketResponse = await fetchWithTimeout(`${this.config.endpoint}/v1/websocket/ticket`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.config.token}`,
                    'Content-Type': 'application/json',
                },
                timeoutMs: 10000, // 10 second timeout for ticket request
            });

            if (ticketResponse.ok) {
                const { ticket } = await ticketResponse.json() as { ticket: string };
                wsUrl.searchParams.set('ticket', ticket);
                this.usedTicketAuth = true;
            }
            // If ticket request fails, fall through to connect without ticket
            // The server's HAP-360 pending-auth flow will handle it
        } catch {
            // Network error or timeout fetching ticket - continue without it
            // Will use HAP-360 message-based auth as fallback
        }

        // Connect to WebSocket
        this.ws = new WebSocket(wsUrl.toString());
        this.setupEventHandlers();
    }

    disconnect() {
        this.isManualClose = true;

        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        // Clear auth timeout (HAP-360)
        if (this.authTimeout) {
            clearTimeout(this.authTimeout);
            this.authTimeout = null;
        }

        // Reject all pending acknowledgements
        this.rejectAllPendingAcks(new Error('Connection closed'));

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.updateStatus('disconnected');
    }

    /**
     * Schedule a reconnection attempt with exponential backoff and jitter.
     *
     * Jitter Algorithm (HAP-477):
     * Uses "centered jitter" to spread reconnection times both above and below
     * the base delay, preventing thundering herd when many clients reconnect
     * after a server outage.
     *
     * With randomizationFactor=0.5:
     * - Base delay: 1000ms * 2^attempt (capped at max)
     * - Jitter range: ±50% of base delay
     * - Actual delay: 500ms to 1500ms for first attempt
     *
     * Formula: delay = base * (1 - factor + random * factor * 2)
     * This centers the distribution around the base delay rather than
     * always adding extra time (which would still cause clustering).
     */
    private scheduleReconnect(): void {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
        }

        if (this.isManualClose) {
            return;
        }

        // Calculate delay with exponential backoff and centered jitter (HAP-477)
        const baseDelay = Math.min(
            this.wsConfig.reconnectionDelay * Math.pow(2, this.reconnectAttempts),
            this.wsConfig.reconnectionDelayMax
        );
        // Centered jitter: spreads delay ±factor around base, not just +factor
        // With factor=0.5: delay ranges from base*0.5 to base*1.5
        const jitterMultiplier = 1 - this.wsConfig.randomizationFactor + (Math.random() * this.wsConfig.randomizationFactor * 2);
        const delay = Math.max(100, baseDelay * jitterMultiplier); // Minimum 100ms floor

        this.reconnectAttempts++;

        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.doConnect();
        }, delay);
    }

    /**
     * Reject all pending acknowledgements with an error.
     */
    private rejectAllPendingAcks(error: Error): void {
        for (const [_ackId, pending] of this.pendingAcks) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pendingAcks.clear();
    }

    //
    // Listener Management
    //

    onReconnected = (listener: () => void) => {
        this.reconnectedListeners.add(listener);
        return () => this.reconnectedListeners.delete(listener);
    };

    onStatusChange = (listener: (status: 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'error') => void) => {
        this.statusListeners.add(listener);
        // Immediately notify with current status
        listener(this.currentStatus);
        return () => this.statusListeners.delete(listener);
    };

    onErrorChange = (listener: (error: Error | null) => void) => {
        this.errorListeners.add(listener);
        // Immediately notify with current error
        listener(this.lastError);
        return () => this.errorListeners.delete(listener);
    };

    getLastError = (): Error | null => {
        return this.lastError;
    };

    getStatus = (): 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'error' => {
        return this.currentStatus;
    };

    //
    // Message Handling
    //

    onMessage(event: string, handler: (data: unknown) => void) {
        if (!this.messageHandlers.has(event)) {
            this.messageHandlers.set(event, new Set());
        }
        this.messageHandlers.get(event)!.add(handler);
        return () => {
            const handlers = this.messageHandlers.get(event);
            if (handlers) {
                handlers.delete(handler);
                if (handlers.size === 0) {
                    this.messageHandlers.delete(event);
                }
            }
        };
    }

    offMessage(event: string, handler: (data: unknown) => void) {
        const handlers = this.messageHandlers.get(event);
        if (handlers) {
            handlers.delete(handler);
            if (handlers.size === 0) {
                this.messageHandlers.delete(event);
            }
        }
    }

    /**
     * RPC call for sessions - uses session-specific encryption
     * @param sessionId - The session ID
     * @param method - The RPC method name
     * @param params - The parameters to pass
     * @param options - Optional abort signal for cancellation
     */
    async sessionRPC<R, A>(
        sessionId: string,
        method: string,
        params: A,
        options?: { signal?: AbortSignal }
    ): Promise<R> {
        const sessionEncryption = this.encryption!.getSessionEncryption(sessionId);
        if (!sessionEncryption) {
            throw new AppError(ErrorCodes.NOT_FOUND, `Session encryption not found for ${sessionId}`);
        }

        // Check if already aborted before making the call
        if (options?.signal?.aborted) {
            throw new AppError(ErrorCodes.RPC_CANCELLED, 'RPC call was cancelled');
        }

        if (!this.ws || this.currentStatus !== 'connected') {
            throw new AppError(ErrorCodes.SOCKET_NOT_CONNECTED, 'Socket not connected');
        }

        // Set up cancellation handling
        let abortHandler: (() => void) | undefined;
        let isSettled = false;

        const result = await new Promise<{ ok?: boolean; result?: string; cancelled?: boolean; requestId?: string }>((resolve, reject) => {
            if (options?.signal) {
                abortHandler = () => {
                    if (!isSettled) {
                        isSettled = true;
                        reject(new AppError(ErrorCodes.RPC_CANCELLED, 'RPC call was cancelled'));
                    }
                };
                options.signal.addEventListener('abort', abortHandler);
            }

            // Make the RPC call
            const encryptPromise = sessionEncryption.encryptRaw(params);
            encryptPromise.then(encryptedParams => {
                return this.emitWithAck<{ ok?: boolean; result?: string; cancelled?: boolean; requestId?: string }>('rpc-call', {
                    method: `${sessionId}:${method}`,
                    params: encryptedParams
                });
            }).then(rpcResult => {
                if (!isSettled) {
                    isSettled = true;
                    // Send cancellation to server if we got a requestId and abortion happened
                    if (options?.signal?.aborted && rpcResult.requestId) {
                        this.send('rpc-cancel', { requestId: rpcResult.requestId });
                    }
                    resolve(rpcResult);
                }
            }).catch(error => {
                if (!isSettled) {
                    isSettled = true;
                    reject(error);
                }
            });
        }).finally(() => {
            if (abortHandler && options?.signal) {
                options.signal.removeEventListener('abort', abortHandler);
            }
        });

        if (result.ok) {
            return await sessionEncryption.decryptRaw(result.result!) as R;
        }
        if (result.cancelled) {
            throw new AppError(ErrorCodes.RPC_CANCELLED, 'RPC call was cancelled');
        }
        throw new AppError(ErrorCodes.RPC_FAILED, 'RPC call failed');
    }

    /**
     * RPC call for machines - uses legacy/global encryption (for now)
     * @param machineId - The machine ID
     * @param method - The RPC method name
     * @param params - The parameters to pass
     * @param options - Optional abort signal for cancellation and custom timeout
     */
    async machineRPC<R, A>(
        machineId: string,
        method: string,
        params: A,
        options?: { signal?: AbortSignal; timeout?: number }
    ): Promise<R> {
        const machineEncryption = this.encryption!.getMachineEncryption(machineId);
        if (!machineEncryption) {
            throw new AppError(ErrorCodes.NOT_FOUND, `Machine encryption not found for ${machineId}`);
        }

        // Check if already aborted before making the call
        if (options?.signal?.aborted) {
            throw new AppError(ErrorCodes.RPC_CANCELLED, 'RPC call was cancelled');
        }

        if (!this.ws || this.currentStatus !== 'connected') {
            throw new AppError(ErrorCodes.SOCKET_NOT_CONNECTED, 'Socket not connected');
        }

        // Set up cancellation handling
        let abortHandler: (() => void) | undefined;
        let isSettled = false;

        const result = await new Promise<{ ok?: boolean; result?: string; cancelled?: boolean; requestId?: string }>((resolve, reject) => {
            if (options?.signal) {
                abortHandler = () => {
                    if (!isSettled) {
                        isSettled = true;
                        reject(new AppError(ErrorCodes.RPC_CANCELLED, 'RPC call was cancelled'));
                    }
                };
                options.signal.addEventListener('abort', abortHandler);
            }

            // Make the RPC call
            const encryptPromise = machineEncryption.encryptRaw(params);
            encryptPromise.then(encryptedParams => {
                return this.emitWithAck<{ ok?: boolean; result?: string; cancelled?: boolean; requestId?: string }>(
                    'rpc-call',
                    {
                        method: `${machineId}:${method}`,
                        params: encryptedParams
                    },
                    options?.timeout
                );
            }).then(rpcResult => {
                if (!isSettled) {
                    isSettled = true;
                    // Send cancellation to server if we got a requestId and abortion happened
                    if (options?.signal?.aborted && rpcResult.requestId) {
                        this.send('rpc-cancel', { requestId: rpcResult.requestId });
                    }
                    resolve(rpcResult);
                }
            }).catch(error => {
                if (!isSettled) {
                    isSettled = true;
                    reject(error);
                }
            });
        }).finally(() => {
            if (abortHandler && options?.signal) {
                options.signal.removeEventListener('abort', abortHandler);
            }
        });

        if (result.ok) {
            return await machineEncryption.decryptRaw(result.result!) as R;
        }
        if (result.cancelled) {
            throw new AppError(ErrorCodes.RPC_CANCELLED, 'RPC call was cancelled');
        }
        throw new AppError(ErrorCodes.RPC_FAILED, 'RPC call failed');
    }

    /**
     * Send an event without expecting acknowledgement.
     */
    send(event: string, data: unknown) {
        if (!this.ws || this.currentStatus !== 'connected') {
            return false;
        }
        this.sendRaw({ event, data });
        return true;
    }

    /**
     * Send raw message to WebSocket.
     */
    private sendRaw(message: HappyMessage): void {
        if (this.ws && this.currentStatus === 'connected') {
            this.ws.send(JSON.stringify(message));
        }
    }

    /**
     * Emit an event and wait for acknowledgement.
     * This implements the request-response pattern using ackId.
     * @param event - The event name
     * @param data - The data to send
     * @param timeout - Optional custom timeout in milliseconds (defaults to ackTimeout config)
     */
    async emitWithAck<T = unknown>(event: string, data: unknown, timeout?: number): Promise<T> {
        if (!this.ws || this.currentStatus !== 'connected') {
            throw new AppError(ErrorCodes.SOCKET_NOT_CONNECTED, 'Socket not connected');
        }

        const ackId = Crypto.randomUUID();
        const effectiveTimeout = timeout ?? this.wsConfig.ackTimeout;

        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingAcks.delete(ackId);
                reject(new AppError(ErrorCodes.RPC_FAILED, `Request timed out: ${event}`));
            }, effectiveTimeout);

            this.pendingAcks.set(ackId, { resolve: resolve as (value: unknown) => void, reject, timer });

            this.sendRaw({ event, data, ackId });
        });
    }

    //
    // HTTP Requests
    //

    async request(path: string, options?: RequestInit): Promise<Response> {
        if (!this.config) {
            throw new AppError(ErrorCodes.NOT_CONFIGURED, 'SyncSocket not initialized');
        }

        const credentials = await TokenStorage.getCredentials();
        if (!credentials) {
            throw new AppError(ErrorCodes.NOT_AUTHENTICATED, 'No authentication credentials');
        }

        const url = `${this.config.endpoint}${path}`;
        // HAP-510: Include correlation ID in all API requests
        // HAP-585: Store correlation ID for failed operations debugging
        const correlationId = generateRequestCorrelationId();
        const headers = {
            'Authorization': `Bearer ${credentials.token}`,
            [CORRELATION_ID_HEADER]: correlationId,
            ...options?.headers
        };

        try {
            const response = await fetch(url, {
                ...options,
                headers
            });

            // HAP-585: Store correlation ID for non-ok responses so it can be shown in error UI
            if (!response.ok) {
                setLastFailedCorrelationId(correlationId);
            }

            return response;
        } catch (error) {
            // HAP-585: Store correlation ID for network errors
            setLastFailedCorrelationId(correlationId);
            throw error;
        }
    }

    /**
     * HAP-589: Make an HTTP request and return the correlation ID for logging.
     *
     * This method wraps the standard request() to also return the correlation ID,
     * enabling sync operations to include correlation IDs in their log statements.
     *
     * @param path - API path (e.g., "/v1/sessions/123/messages")
     * @param options - Standard fetch options
     * @returns Response with correlation ID for logging
     *
     * @example
     * ```typescript
     * const { response, shortId } = await apiSocket.requestWithCorrelation(url);
     * log.log(`💬 fetchMessages [${shortId}] completed`);
     * ```
     */
    async requestWithCorrelation(path: string, options?: RequestInit): Promise<ResponseWithCorrelation> {
        if (!this.config) {
            throw new AppError(ErrorCodes.NOT_CONFIGURED, 'SyncSocket not initialized');
        }

        const credentials = await TokenStorage.getCredentials();
        if (!credentials) {
            throw new AppError(ErrorCodes.NOT_AUTHENTICATED, 'No authentication credentials');
        }

        const url = `${this.config.endpoint}${path}`;
        const correlationId = generateRequestCorrelationId();
        const headers = {
            'Authorization': `Bearer ${credentials.token}`,
            [CORRELATION_ID_HEADER]: correlationId,
            ...options?.headers
        };

        try {
            const response = await fetch(url, {
                ...options,
                headers
            });

            if (!response.ok) {
                setLastFailedCorrelationId(correlationId);
            }

            return {
                response,
                correlationId,
                shortId: getShortCorrelationId(correlationId)
            };
        } catch (error) {
            setLastFailedCorrelationId(correlationId);
            throw error;
        }
    }

    //
    // Token Management
    //

    updateToken(newToken: string) {
        if (this.config && this.config.token !== newToken) {
            this.config.token = newToken;

            if (this.ws) {
                this.disconnect();
                this.connect();
            }
        }
    }

    //
    // Private Methods
    //

    private updateStatus(status: 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'error', error?: Error) {
        // Update error state: store error when status is 'error', clear otherwise
        const newError = status === 'error'
            ? (error ?? new Error("Unknown error occurred in updateStatus"))
            : null;
        const errorChanged = newError !== this.lastError;

        if (errorChanged) {
            this.lastError = newError;
            this.errorListeners.forEach(listener => listener(this.lastError));
        }

        if (this.currentStatus !== status) {
            this.currentStatus = status;
            this.statusListeners.forEach(listener => listener(status));
        }
    }

    /**
     * Handle incoming WebSocket messages.
     * Parses JSON and dispatches to event handlers or resolves pending acks.
     *
     * HAP-360: Also handles the auth flow - the 'connected' event from server
     * indicates successful authentication.
     */
    private handleMessage(data: string): void {
        try {
            const message = JSON.parse(data) as HappyMessage;

            // Handle auth success response (HAP-360)
            // Server sends 'connected' event after validating auth message
            if (message.event === 'connected' && this.currentStatus === 'authenticating') {
                // Clear auth timeout
                if (this.authTimeout) {
                    clearTimeout(this.authTimeout);
                    this.authTimeout = null;
                }

                // Transition to connected state
                this.updateStatus('connected');

                // Notify reconnection listeners if this was a reconnection
                if (this.wasConnectedBefore) {
                    this.reconnectedListeners.forEach(listener => listener());
                }
                this.wasConnectedBefore = true;
                return;
            }

            // Handle auth failure (HAP-360)
            if (message.event === 'auth-error' && this.currentStatus === 'authenticating') {
                if (this.authTimeout) {
                    clearTimeout(this.authTimeout);
                    this.authTimeout = null;
                }

                const errorData = message.data as { message?: string } | undefined;
                this.updateStatus('error', new Error(errorData?.message || 'Authentication failed'));
                this.ws?.close(4001, 'Authentication failed');
                return;
            }

            // Handle acknowledgement responses (for emitWithAck)
            if (message.ackId && message.ack !== undefined) {
                const pending = this.pendingAcks.get(message.ackId);
                if (pending) {
                    clearTimeout(pending.timer);
                    this.pendingAcks.delete(message.ackId);
                    pending.resolve(message.ack);
                }
                return;
            }

            // Handle regular events - dispatch to registered handlers
            const handlers = this.messageHandlers.get(message.event);
            if (handlers) {
                handlers.forEach(handler => handler(message.data));
            }
        } catch {
            // Ignore malformed messages
        }
    }

    private setupEventHandlers() {
        if (!this.ws) return;

        // Connection opened - handle authentication
        this.ws.onopen = () => {
            this.reconnectAttempts = 0;
            this.updateStatus('authenticating');

            // HAP-375: If we used ticket auth, server already validated us
            // The server will send 'connected' event immediately
            // We don't need to send an auth message
            if (!this.usedTicketAuth) {
                // HAP-360 fallback: Send auth message as first message
                // Used when ticket fetch failed (e.g., network issues)
                if (this.ws && this.config) {
                    this.ws.send(JSON.stringify({
                        event: 'auth',
                        data: {
                            token: this.config.token,
                            clientType: 'user-scoped',
                            // HAP-510: Include session correlation ID for request tracing
                            correlationId: getSessionCorrelationId(),
                        }
                    }));
                }
            }

            // Set auth timeout - if server doesn't respond, close connection
            this.authTimeout = setTimeout(() => {
                this.authTimeout = null;
                if (this.currentStatus === 'authenticating') {
                    this.updateStatus('error', new Error('Authentication timeout'));
                    this.ws?.close(4001, 'Authentication timeout');
                }
            }, ApiSocket.AUTH_TIMEOUT_MS);
        };

        // Connection closed
        this.ws.onclose = (_event) => {
            // Track if we should update status (was in an active state)
            const wasInActiveState = this.currentStatus === 'connected' || this.currentStatus === 'authenticating';
            this.ws = null;

            // Clear auth timeout (HAP-360)
            if (this.authTimeout) {
                clearTimeout(this.authTimeout);
                this.authTimeout = null;
            }

            // Reject any pending acks
            this.rejectAllPendingAcks(new Error('Connection closed'));

            if (wasInActiveState) {
                this.updateStatus('disconnected');
            }

            // Attempt reconnection if not manually closed
            if (!this.isManualClose) {
                this.scheduleReconnect();
            }
        };

        // Connection error
        this.ws.onerror = (_event) => {
            // Error event doesn't provide useful info in browser/RN
            // The close event will follow and trigger reconnection
            this.updateStatus('error', new Error('WebSocket error'));
        };

        // Message received
        this.ws.onmessage = (event) => {
            if (typeof event.data === 'string') {
                this.handleMessage(event.data);
            }
        };
    }
}

//
// Singleton Export
//

export const apiSocket = new ApiSocket();
