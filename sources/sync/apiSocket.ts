import { io, Socket } from 'socket.io-client';
import { TokenStorage } from '@/auth/tokenStorage';
import { Encryption } from './encryption/encryption';

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

//
// Main Class
//

class ApiSocket {

    // State
    private socket: Socket | null = null;
    private config: SyncSocketConfig | null = null;
    private encryption: Encryption | null = null;
    private messageHandlers: Map<string, Set<(data: any) => void>> = new Map();
    private reconnectedListeners: Set<() => void> = new Set();
    private statusListeners: Set<(status: 'disconnected' | 'connecting' | 'connected' | 'error') => void> = new Set();
    private currentStatus: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';
    private lastError: Error | null = null;
    private errorListeners: Set<(error: Error | null) => void> = new Set();

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
        if (!this.config || this.socket) {
            return;
        }

        this.updateStatus('connecting');

        this.socket = io(this.config.endpoint, {
            path: '/v1/updates',
            auth: {
                token: this.config.token,
                clientType: 'user-scoped' as const
            },
            transports: ['websocket'],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            reconnectionAttempts: Infinity
        });

        this.setupEventHandlers();
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.updateStatus('disconnected');
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

    onMessage(event: string, handler: (data: any) => void) {
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

    offMessage(event: string, handler: (data: any) => void) {
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
            throw new Error(`Session encryption not found for ${sessionId}`);
        }

        // Check if already aborted before making the call
        if (options?.signal?.aborted) {
            throw new Error('RPC call was cancelled');
        }

        if (!this.socket) {
            throw new Error('Socket not connected');
        }

        // Capture socket reference to avoid stale closure issues
        const socket = this.socket;

        // Set up cancellation handling
        let abortHandler: (() => void) | undefined;
        let isSettled = false;

        const result = await new Promise<any>((resolve, reject) => {
            if (options?.signal) {
                abortHandler = () => {
                    if (!isSettled) {
                        isSettled = true;
                        reject(new Error('RPC call was cancelled'));
                    }
                };
                options.signal.addEventListener('abort', abortHandler);
            }

            // Make the RPC call (not using async/await in executor to avoid anti-pattern)
            const encryptPromise = sessionEncryption.encryptRaw(params);
            encryptPromise.then(encryptedParams => {
                return socket.emitWithAck('rpc-call', {
                    method: `${sessionId}:${method}`,
                    params: encryptedParams
                });
            }).then(rpcResult => {
                if (!isSettled) {
                    isSettled = true;
                    // Send cancellation to server if we got a requestId and abortion happened
                    if (options?.signal?.aborted && rpcResult.requestId) {
                        socket.emit('rpc-cancel', { requestId: rpcResult.requestId });
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
            return await sessionEncryption.decryptRaw(result.result) as R;
        }
        if (result.cancelled) {
            throw new Error('RPC call was cancelled');
        }
        throw new Error('RPC call failed');
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
            throw new Error(`Machine encryption not found for ${machineId}`);
        }

        // Check if already aborted before making the call
        if (options?.signal?.aborted) {
            throw new Error('RPC call was cancelled');
        }

        if (!this.socket) {
            throw new Error('Socket not connected');
        }

        // Capture socket reference to avoid stale closure issues
        const socket = this.socket;

        // Set up cancellation handling
        let abortHandler: (() => void) | undefined;
        let isSettled = false;

        const result = await new Promise<any>((resolve, reject) => {
            if (options?.signal) {
                abortHandler = () => {
                    if (!isSettled) {
                        isSettled = true;
                        reject(new Error('RPC call was cancelled'));
                    }
                };
                options.signal.addEventListener('abort', abortHandler);
            }

            // Make the RPC call (not using async/await in executor to avoid anti-pattern)
            const encryptPromise = machineEncryption.encryptRaw(params);
            encryptPromise.then(encryptedParams => {
                return socket.emitWithAck('rpc-call', {
                    method: `${machineId}:${method}`,
                    params: encryptedParams
                });
            }).then(rpcResult => {
                if (!isSettled) {
                    isSettled = true;
                    // Send cancellation to server if we got a requestId and abortion happened
                    if (options?.signal?.aborted && rpcResult.requestId) {
                        socket.emit('rpc-cancel', { requestId: rpcResult.requestId });
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
            return await machineEncryption.decryptRaw(result.result) as R;
        }
        if (result.cancelled) {
            throw new Error('RPC call was cancelled');
        }
        throw new Error('RPC call failed');
    }

    send(event: string, data: any) {
        this.socket!.emit(event, data);
        return true;
    }

    async emitWithAck<T = any>(event: string, data: any): Promise<T> {
        if (!this.socket) {
            throw new Error('Socket not connected');
        }
        return await this.socket.emitWithAck(event, data);
    }

    //
    // HTTP Requests
    //

    async request(path: string, options?: RequestInit): Promise<Response> {
        if (!this.config) {
            throw new Error('SyncSocket not initialized');
        }

        const credentials = await TokenStorage.getCredentials();
        if (!credentials) {
            throw new Error('No authentication credentials');
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

            if (this.socket) {
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

    private setupEventHandlers() {
        if (!this.socket) return;

        // Connection events
        this.socket.on('connect', () => {
            // console.log('🔌 SyncSocket: Connected, recovered: ' + this.socket?.recovered);
            // console.log('🔌 SyncSocket: Socket ID:', this.socket?.id);
            this.updateStatus('connected');
            if (!this.socket?.recovered) {
                this.reconnectedListeners.forEach(listener => listener());
            }
        });

        this.socket.on('disconnect', (reason) => {
            // console.log('🔌 SyncSocket: Disconnected', reason);
            this.updateStatus('disconnected');
        });

        // Error events
        this.socket.on('connect_error', (error) => {
            // console.error('🔌 SyncSocket: Connection error', error);
            this.updateStatus('error', error);
        });

        this.socket.on('error', (error) => {
            // console.error('🔌 SyncSocket: Error', error);
            this.updateStatus('error', error);
        });

        // Message handling - dispatch to all registered handlers for each event
        this.socket.onAny((event, data) => {
            // console.log(`📥 SyncSocket: Received event '${event}':`, JSON.stringify(data).substring(0, 200));
            const handlers = this.messageHandlers.get(event);
            if (handlers) {
                // console.log(`📥 SyncSocket: Calling ${handlers.size} handler(s) for '${event}'`);
                handlers.forEach(handler => handler(data));
            } else {
                // console.log(`📥 SyncSocket: No handler registered for '${event}'`);
            }
        });
    }
}

//
// Singleton Export
//

export const apiSocket = new ApiSocket();