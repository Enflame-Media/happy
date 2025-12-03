import { TokenStorage } from '@/auth/tokenStorage';
import { Encryption } from './encryption/encryption';
import { AppError, ErrorCodes } from '@/utils/errors';
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
    connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
    lastError: Error | null;
}

export type SyncSocketListener = (state: SyncSocketState) => void;

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

const DEFAULT_CONFIG: WebSocketConfig = {
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    randomizationFactor: 0.5,
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
    private statusListeners: Set<(status: 'disconnected' | 'connecting' | 'connected' | 'error') => void> = new Set();
    private currentStatus: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';
    private lastError: Error | null = null;
    private errorListeners: Set<(error: Error | null) => void> = new Set();

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
     */
    private doConnect(): void {
        if (!this.config) return;

        // Build WebSocket URL with auth params
        const wsUrl = new URL('/v1/updates', this.config.endpoint);
        wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';

        // Add auth as query parameters (like happy-cli does)
        wsUrl.searchParams.set('token', this.config.token);
        wsUrl.searchParams.set('clientType', 'user-scoped');

        this.ws = new WebSocket(wsUrl.toString());
        this.setupEventHandlers();
    }

    disconnect() {
        this.isManualClose = true;

        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
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
     * Schedule a reconnection attempt with exponential backoff.
     */
    private scheduleReconnect(): void {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
        }

        if (this.isManualClose) {
            return;
        }

        // Calculate delay with exponential backoff and jitter
        const baseDelay = Math.min(
            this.wsConfig.reconnectionDelay * Math.pow(2, this.reconnectAttempts),
            this.wsConfig.reconnectionDelayMax
        );
        const jitter = baseDelay * this.wsConfig.randomizationFactor * Math.random();
        const delay = baseDelay + jitter;

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

    onStatusChange = (listener: (status: 'disconnected' | 'connecting' | 'connected' | 'error') => void) => {
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

    getStatus = (): 'disconnected' | 'connecting' | 'connected' | 'error' => {
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
     * @param options - Optional abort signal for cancellation
     */
    async machineRPC<R, A>(
        machineId: string,
        method: string,
        params: A,
        options?: { signal?: AbortSignal }
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
                return this.emitWithAck<{ ok?: boolean; result?: string; cancelled?: boolean; requestId?: string }>('rpc-call', {
                    method: `${machineId}:${method}`,
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
     */
    async emitWithAck<T = unknown>(event: string, data: unknown): Promise<T> {
        if (!this.ws || this.currentStatus !== 'connected') {
            throw new AppError(ErrorCodes.SOCKET_NOT_CONNECTED, 'Socket not connected');
        }

        const ackId = Crypto.randomUUID();

        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingAcks.delete(ackId);
                reject(new AppError(ErrorCodes.RPC_FAILED, `Request timed out: ${event}`));
            }, this.wsConfig.ackTimeout);

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
        const headers = {
            'Authorization': `Bearer ${credentials.token}`,
            ...options?.headers
        };

        return fetch(url, {
            ...options,
            headers
        });
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

    private updateStatus(status: 'disconnected' | 'connecting' | 'connected' | 'error', error?: Error) {
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
     */
    private handleMessage(data: string): void {
        try {
            const message = JSON.parse(data) as HappyMessage;

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

        // Connection opened
        this.ws.onopen = () => {
            this.reconnectAttempts = 0;
            this.updateStatus('connected');

            // Notify reconnection listeners if this was a reconnection
            if (this.wasConnectedBefore) {
                this.reconnectedListeners.forEach(listener => listener());
            }
            this.wasConnectedBefore = true;
        };

        // Connection closed
        this.ws.onclose = (_event) => {
            const wasConnected = this.currentStatus === 'connected';
            this.ws = null;

            // Reject any pending acks
            this.rejectAllPendingAcks(new Error('Connection closed'));

            if (wasConnected) {
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
