/* oxlint-disable no-console */
/**
 * Unit tests for remoteLogger.ts
 *
 * Tests cover:
 * - Production guardrails (gating behavior)
 * - Sensitive data redaction
 * - Log buffer management (truncation and batching)
 * - Safe serialization of log entries
 * - Local console output preservation
 *
 * NOTE: This test file uses console.* methods intentionally to test
 * the remoteLogger's console patching behavior. The no-console rule
 * is disabled for this file.
 *
 * @see HAP-849
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Store original process.env for restoration
const originalEnv = { ...process.env };

/**
 * Helper to find a fetch call containing a specific message pattern
 */
function findFetchCallWithMessage(
    mockFn: ReturnType<typeof vi.fn>,
    pattern: string | RegExp
): [string, { method: string; headers: Record<string, string>; body: string }] | undefined {
    for (const call of mockFn.mock.calls) {
        if (!call[0].includes('/logs-combined-from-cli-and-mobile-for-simple-ai-debugging')) {
            continue;
        }
        try {
            const body = JSON.parse(call[1].body);
            const matches =
                typeof pattern === 'string'
                    ? body.message.includes(pattern)
                    : pattern.test(body.message);
            if (matches) {
                return call as [
                    string,
                    { method: string; headers: Record<string, string>; body: string },
                ];
            }
        } catch {
            continue;
        }
    }
    return undefined;
}

describe('remoteLogger', () => {
    // Mocks for console methods
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

    // Mock for fetchWithTimeout
    let mockFetchWithTimeout: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        // Reset process.env
        process.env = { ...originalEnv };

        // Reset module cache for fresh imports
        vi.resetModules();

        // Setup console spies
        consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

        // Setup fetchWithTimeout mock
        mockFetchWithTimeout = vi.fn().mockResolvedValue({ ok: true });
    });

    afterEach(() => {
        // Restore console methods
        consoleLogSpy.mockRestore();
        consoleInfoSpy.mockRestore();
        consoleWarnSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        consoleDebugSpy.mockRestore();

        // Restore process.env
        process.env = originalEnv;

        // Clear all mocks
        vi.clearAllMocks();
    });

    describe('gating behavior', () => {
        it('does not patch console when EXPO_PUBLIC_DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING is not set', async () => {
            // Ensure env var is not set
            delete process.env.EXPO_PUBLIC_DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING;

            vi.doMock('@/utils/fetchWithTimeout', () => ({
                fetchWithTimeout: mockFetchWithTimeout,
            }));
            vi.doMock('@/config', () => ({
                config: { serverUrl: 'http://localhost:3000' },
            }));

            const { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } =
                await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();

            // Console.log should still be a spy (not patched)
            console.log('test message');

            // Should NOT have called fetchWithTimeout since logging is disabled
            expect(mockFetchWithTimeout).not.toHaveBeenCalled();
        });

        it('blocks remote logging when server URL is not a local/dev URL', async () => {
            process.env.EXPO_PUBLIC_DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING = '1';

            vi.doMock('@/utils/fetchWithTimeout', () => ({
                fetchWithTimeout: mockFetchWithTimeout,
            }));
            vi.doMock('@/config', () => ({
                config: { serverUrl: 'https://production.example.com' },
            }));

            const { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } =
                await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();

            // Should have logged a warning about blocked URL
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('[RemoteLogger] BLOCKED')
            );
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('is not a local/dev URL')
            );
        });

        it('blocks remote logging when server URL is missing', async () => {
            process.env.EXPO_PUBLIC_DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING = '1';

            vi.doMock('@/utils/fetchWithTimeout', () => ({
                fetchWithTimeout: mockFetchWithTimeout,
            }));
            vi.doMock('@/config', () => ({
                config: { serverUrl: undefined },
            }));

            const { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } =
                await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();

            // Should have logged about missing URL
            expect(consoleLogSpy).toHaveBeenCalledWith(
                '[RemoteLogger] No server URL provided, remote logging disabled'
            );
        });

        it('allows localhost URLs', async () => {
            process.env.EXPO_PUBLIC_DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING = '1';

            vi.doMock('@/utils/fetchWithTimeout', () => ({
                fetchWithTimeout: mockFetchWithTimeout,
            }));
            vi.doMock('@/config', () => ({
                config: { serverUrl: 'http://localhost:3000' },
            }));

            const { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } =
                await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();

            // Should have initialized successfully
            expect(consoleLogSpy).toHaveBeenCalledWith(
                '[RemoteLogger] Initialized with server:',
                'http://localhost:3000'
            );
        });

        it('allows 127.0.0.1 URLs', async () => {
            process.env.EXPO_PUBLIC_DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING = '1';

            vi.doMock('@/utils/fetchWithTimeout', () => ({
                fetchWithTimeout: mockFetchWithTimeout,
            }));
            vi.doMock('@/config', () => ({
                config: { serverUrl: 'http://127.0.0.1:3000' },
            }));

            const { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } =
                await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();

            // Should have initialized successfully
            expect(consoleLogSpy).toHaveBeenCalledWith(
                '[RemoteLogger] Initialized with server:',
                'http://127.0.0.1:3000'
            );
        });

        it('allows private network 10.x.x.x URLs', async () => {
            process.env.EXPO_PUBLIC_DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING = '1';

            vi.doMock('@/utils/fetchWithTimeout', () => ({
                fetchWithTimeout: mockFetchWithTimeout,
            }));
            vi.doMock('@/config', () => ({
                config: { serverUrl: 'http://10.0.0.1:3000' },
            }));

            const { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } =
                await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();

            // Should have initialized successfully
            expect(consoleLogSpy).toHaveBeenCalledWith(
                '[RemoteLogger] Initialized with server:',
                'http://10.0.0.1:3000'
            );
        });

        it('allows private network 192.168.x.x URLs', async () => {
            process.env.EXPO_PUBLIC_DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING = '1';

            vi.doMock('@/utils/fetchWithTimeout', () => ({
                fetchWithTimeout: mockFetchWithTimeout,
            }));
            vi.doMock('@/config', () => ({
                config: { serverUrl: 'http://192.168.1.100:3000' },
            }));

            const { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } =
                await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();

            // Should have initialized successfully
            expect(consoleLogSpy).toHaveBeenCalledWith(
                '[RemoteLogger] Initialized with server:',
                'http://192.168.1.100:3000'
            );
        });

        it('allows private network 172.16-31.x.x URLs', async () => {
            process.env.EXPO_PUBLIC_DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING = '1';

            vi.doMock('@/utils/fetchWithTimeout', () => ({
                fetchWithTimeout: mockFetchWithTimeout,
            }));
            vi.doMock('@/config', () => ({
                config: { serverUrl: 'http://172.16.0.1:3000' },
            }));

            const { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } =
                await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();

            // Should have initialized successfully
            expect(consoleLogSpy).toHaveBeenCalledWith(
                '[RemoteLogger] Initialized with server:',
                'http://172.16.0.1:3000'
            );
        });

        it('blocks 172.32.x.x URLs (outside valid range)', async () => {
            process.env.EXPO_PUBLIC_DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING = '1';

            vi.doMock('@/utils/fetchWithTimeout', () => ({
                fetchWithTimeout: mockFetchWithTimeout,
            }));
            vi.doMock('@/config', () => ({
                config: { serverUrl: 'http://172.32.0.1:3000' },
            }));

            const { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } =
                await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();

            // Should have logged a warning about blocked URL
            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('[RemoteLogger] BLOCKED')
            );
        });

        it('is idempotent - only patches console once', async () => {
            process.env.EXPO_PUBLIC_DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING = '1';

            vi.doMock('@/utils/fetchWithTimeout', () => ({
                fetchWithTimeout: mockFetchWithTimeout,
            }));
            vi.doMock('@/config', () => ({
                config: { serverUrl: 'http://localhost:3000' },
            }));

            const { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } =
                await import('../remoteLogger');

            // Call multiple times
            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();
            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();
            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();

            // Should only have initialized once
            const initCalls = consoleLogSpy.mock.calls.filter(
                (call: unknown[]) => call[0] === '[RemoteLogger] Initialized with server:'
            );
            expect(initCalls).toHaveLength(1);
        });
    });

    describe('console patching and logging', () => {
        beforeEach(async () => {
            process.env.EXPO_PUBLIC_DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING = '1';

            vi.doMock('@/utils/fetchWithTimeout', () => ({
                fetchWithTimeout: mockFetchWithTimeout,
            }));
            vi.doMock('@/config', () => ({
                config: { serverUrl: 'http://localhost:3000' },
            }));
        });

        it('calls original console methods when patched', async () => {
            const { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } =
                await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();

            // Clear initialization logs
            consoleLogSpy.mockClear();
            consoleInfoSpy.mockClear();
            consoleWarnSpy.mockClear();
            consoleErrorSpy.mockClear();
            consoleDebugSpy.mockClear();

            // Call each console method
            console.log('log message');
            console.info('info message');
            console.warn('warn message');
            console.error('error message');
            console.debug('debug message');

            // Original methods should still be called
            expect(consoleLogSpy).toHaveBeenCalledWith('log message');
            expect(consoleInfoSpy).toHaveBeenCalledWith('info message');
            expect(consoleWarnSpy).toHaveBeenCalledWith('warn message');
            expect(consoleErrorSpy).toHaveBeenCalledWith('error message');
            expect(consoleDebugSpy).toHaveBeenCalledWith('debug message');
        });

        it('sends logs to remote server with correct format', async () => {
            const { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } =
                await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();

            // Clear mock to focus on our specific log
            mockFetchWithTimeout.mockClear();

            console.log('UNIQUE_TEST_LOG_MESSAGE_12345');

            // Wait for async sendLog to complete
            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(mockFetchWithTimeout).toHaveBeenCalled();

            const call = findFetchCallWithMessage(
                mockFetchWithTimeout,
                'UNIQUE_TEST_LOG_MESSAGE_12345'
            );

            expect(call).toBeDefined();
            expect(call![0]).toBe(
                'http://localhost:3000/logs-combined-from-cli-and-mobile-for-simple-ai-debugging'
            );
            expect(call![1].method).toBe('POST');
            expect(call![1].headers['Content-Type']).toBe('application/json');

            const body = JSON.parse(call![1].body);
            expect(body).toMatchObject({
                level: 'log',
                source: 'mobile',
                platform: 'web',
            });
            expect(body.timestamp).toBeDefined();
            expect(body.message).toContain('UNIQUE_TEST_LOG_MESSAGE_12345');
        });

        it('handles multiple arguments in log messages', async () => {
            const { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } =
                await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();
            mockFetchWithTimeout.mockClear();

            console.log('MULTI_ARG_first', 'second', 12345);

            // Wait for async sendLog to complete
            await new Promise((resolve) => setTimeout(resolve, 50));

            const call = findFetchCallWithMessage(mockFetchWithTimeout, 'MULTI_ARG_first');

            expect(call).toBeDefined();
            const body = JSON.parse(call![1].body);
            expect(body.message).toContain('MULTI_ARG_first');
            expect(body.message).toContain('second');
            expect(body.message).toContain('12345');
        });

        it('silently handles fetch failures', async () => {
            // Make fetch fail
            mockFetchWithTimeout.mockRejectedValue(new Error('Network error'));

            const { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } =
                await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();

            // This should not throw
            expect(() => {
                console.log('test message');
            }).not.toThrow();

            // Wait for async sendLog to complete
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Original log should still have been called
            expect(consoleLogSpy).toHaveBeenCalledWith('test message');
        });
    });

    describe('redaction', () => {
        beforeEach(async () => {
            process.env.EXPO_PUBLIC_DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING = '1';

            vi.doMock('@/utils/fetchWithTimeout', () => ({
                fetchWithTimeout: mockFetchWithTimeout,
            }));
            vi.doMock('@/config', () => ({
                config: { serverUrl: 'http://localhost:3000' },
            }));
        });

        it('redacts JWT tokens in log messages before sending', async () => {
            const { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } =
                await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();
            mockFetchWithTimeout.mockClear();

            const jwt =
                'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
            console.log('JWT_TOKEN_TEST:', jwt);

            // Wait for async sendLog to complete
            await new Promise((resolve) => setTimeout(resolve, 50));

            const call = findFetchCallWithMessage(mockFetchWithTimeout, 'JWT_TOKEN_TEST');

            expect(call).toBeDefined();
            const body = JSON.parse(call![1].body);
            expect(body.message).toContain('[REDACTED]');
            expect(body.message).not.toContain('eyJ');
        });

        it('redacts long alphanumeric strings (tokens) before sending', async () => {
            const { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } =
                await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();
            mockFetchWithTimeout.mockClear();

            const longToken = 'a'.repeat(50);
            console.log('LONG_TOKEN_TEST:', longToken);

            // Wait for async sendLog to complete
            await new Promise((resolve) => setTimeout(resolve, 50));

            const call = findFetchCallWithMessage(mockFetchWithTimeout, 'LONG_TOKEN_TEST');

            expect(call).toBeDefined();
            const body = JSON.parse(call![1].body);
            expect(body.message).toContain('[REDACTED]');
            expect(body.message).not.toContain(longToken);
        });

        it('redacts sensitive object fields before sending', async () => {
            const { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } =
                await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();
            mockFetchWithTimeout.mockClear();

            console.log('OBJECT_FIELD_TEST:', { token: 'secret123', name: 'visible' });

            // Wait for async sendLog to complete
            await new Promise((resolve) => setTimeout(resolve, 50));

            const call = findFetchCallWithMessage(mockFetchWithTimeout, 'OBJECT_FIELD_TEST');

            expect(call).toBeDefined();
            const body = JSON.parse(call![1].body);
            expect(body.message).toContain('[REDACTED]');
            expect(body.message).not.toContain('secret123');
            expect(body.message).toContain('visible');
        });

        it('redacts Bearer tokens before sending', async () => {
            const { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } =
                await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();
            mockFetchWithTimeout.mockClear();

            console.log(
                'BEARER_TEST: Auth Bearer sk_live_12345678901234567890123456789012345678901234567890'
            );

            // Wait for async sendLog to complete
            await new Promise((resolve) => setTimeout(resolve, 50));

            const call = findFetchCallWithMessage(mockFetchWithTimeout, 'BEARER_TEST');

            expect(call).toBeDefined();
            const body = JSON.parse(call![1].body);
            expect(body.message).toContain('[REDACTED]');
            expect(body.message).not.toContain('sk_live');
        });
    });

    describe('log buffer management', () => {
        beforeEach(async () => {
            process.env.EXPO_PUBLIC_DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING = '1';

            vi.doMock('@/utils/fetchWithTimeout', () => ({
                fetchWithTimeout: mockFetchWithTimeout,
            }));
            vi.doMock('@/config', () => ({
                config: { serverUrl: 'http://localhost:3000' },
            }));
        });

        it('stores logs in buffer for developer settings UI', async () => {
            const {
                monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds,
                getLogBuffer,
            } = await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();

            console.log('BUFFER_TEST_message 1');
            console.warn('BUFFER_TEST_message 2');
            console.error('BUFFER_TEST_message 3');

            const buffer = getLogBuffer();

            // Buffer should contain entries (initialization log + our 3 logs)
            expect(buffer.length).toBeGreaterThanOrEqual(3);

            // Find our log entries
            const testLogs = buffer.filter((entry) =>
                entry.message.some(
                    (m: unknown) => typeof m === 'string' && m.startsWith('BUFFER_TEST_message')
                )
            );

            expect(testLogs.length).toBe(3);
            expect(testLogs[0].level).toBe('log');
            expect(testLogs[1].level).toBe('warn');
            expect(testLogs[2].level).toBe('error');
        });

        it('clears log buffer when clearLogBuffer is called', async () => {
            const {
                monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds,
                getLogBuffer,
                clearLogBuffer,
            } = await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();

            console.log('test message');

            expect(getLogBuffer().length).toBeGreaterThan(0);

            clearLogBuffer();

            expect(getLogBuffer()).toHaveLength(0);
        });

        it('returns a copy of the buffer, not the original', async () => {
            const {
                monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds,
                getLogBuffer,
            } = await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();

            console.log('test message');

            const buffer1 = getLogBuffer();
            const buffer2 = getLogBuffer();

            // Should be different array instances
            expect(buffer1).not.toBe(buffer2);
            // But contain the same data
            expect(buffer1).toEqual(buffer2);
        });

        it('limits buffer to MAX_BUFFER_SIZE entries', async () => {
            const {
                monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds,
                getLogBuffer,
                clearLogBuffer,
            } = await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();
            clearLogBuffer();

            // Add more than MAX_BUFFER_SIZE (1000) entries
            for (let i = 0; i < 1050; i++) {
                console.log(`Message ${i}`);
            }

            const buffer = getLogBuffer();

            // Buffer should be capped at 1000
            expect(buffer.length).toBeLessThanOrEqual(1000);
        });

        it('evicts oldest entries when byte limit is reached', async () => {
            const {
                monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds,
                getLogBuffer,
                clearLogBuffer,
            } = await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();
            clearLogBuffer();

            // Create large log entries to trigger byte limit eviction
            // MAX_BUFFER_BYTES is 5MB
            const largeMessage = 'x'.repeat(100000); // 100KB each

            // Add 60 entries = 6MB (should trigger eviction)
            for (let i = 0; i < 60; i++) {
                console.log(`Entry ${i}: ${largeMessage}`);
            }

            const buffer = getLogBuffer();

            // Earlier entries should have been evicted
            // The first entry should NOT be Entry 0
            const firstEntry = buffer[0];
            expect(firstEntry.message[0]).not.toBe('Entry 0: ' + largeMessage);
        });

        it('handles entries with circular references gracefully', async () => {
            const {
                monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds,
                getLogBuffer,
            } = await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();

            // Create circular reference
            const obj: Record<string, unknown> = { name: 'test' };
            obj.self = obj;

            // This should not throw
            expect(() => {
                console.log('Circular:', obj);
            }).not.toThrow();

            // Buffer should still work
            const buffer = getLogBuffer();
            expect(buffer.length).toBeGreaterThan(0);
        });
    });

    describe('serialization', () => {
        beforeEach(async () => {
            process.env.EXPO_PUBLIC_DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING = '1';

            vi.doMock('@/utils/fetchWithTimeout', () => ({
                fetchWithTimeout: mockFetchWithTimeout,
            }));
            vi.doMock('@/config', () => ({
                config: { serverUrl: 'http://localhost:3000' },
            }));
        });

        it('serializes objects to JSON in message field', async () => {
            const { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } =
                await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();
            mockFetchWithTimeout.mockClear();

            const data = { itemName: 'testValue', count: 42 };
            console.log('SERIALIZE_OBJ_TEST:', data);

            // Wait for async sendLog to complete
            await new Promise((resolve) => setTimeout(resolve, 50));

            const call = findFetchCallWithMessage(mockFetchWithTimeout, 'SERIALIZE_OBJ_TEST');

            expect(call).toBeDefined();
            const body = JSON.parse(call![1].body);
            expect(body.message).toContain('"itemName": "testValue"');
            expect(body.message).toContain('"count": 42');
        });

        it('includes raw object in messageRawObject field', async () => {
            const { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } =
                await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();
            mockFetchWithTimeout.mockClear();

            const data = { itemName: 'testValue', count: 42 };
            console.log('RAW_OBJECT_TEST:', data);

            // Wait for async sendLog to complete
            await new Promise((resolve) => setTimeout(resolve, 50));

            const call = findFetchCallWithMessage(mockFetchWithTimeout, 'RAW_OBJECT_TEST');

            expect(call).toBeDefined();
            const body = JSON.parse(call![1].body);
            expect(body.messageRawObject).toBeDefined();
            expect(Array.isArray(body.messageRawObject)).toBe(true);
        });

        it('converts non-string primitives to strings', async () => {
            const { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } =
                await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();
            mockFetchWithTimeout.mockClear();

            console.log('PRIMITIVE_TEST:', 12345, true, null, undefined);

            // Wait for async sendLog to complete
            await new Promise((resolve) => setTimeout(resolve, 50));

            const call = findFetchCallWithMessage(mockFetchWithTimeout, 'PRIMITIVE_TEST');

            expect(call).toBeDefined();
            const body = JSON.parse(call![1].body);
            expect(body.message).toContain('12345');
            expect(body.message).toContain('true');
            expect(body.message).toContain('null');
            expect(body.message).toContain('undefined');
        });

        it('includes platform metadata in log entries', async () => {
            const { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } =
                await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();
            mockFetchWithTimeout.mockClear();

            console.log('METADATA_TEST_unique');

            // Wait for async sendLog to complete
            await new Promise((resolve) => setTimeout(resolve, 50));

            const call = findFetchCallWithMessage(mockFetchWithTimeout, 'METADATA_TEST_unique');

            expect(call).toBeDefined();
            const body = JSON.parse(call![1].body);
            expect(body.source).toBe('mobile');
            expect(body.platform).toBe('web'); // From mock
        });

        it('includes ISO timestamp in log entries', async () => {
            const { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } =
                await import('../remoteLogger');

            monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();
            mockFetchWithTimeout.mockClear();

            console.log('TIMESTAMP_TEST_unique');

            // Wait for async sendLog to complete
            await new Promise((resolve) => setTimeout(resolve, 50));

            const call = findFetchCallWithMessage(mockFetchWithTimeout, 'TIMESTAMP_TEST_unique');

            expect(call).toBeDefined();
            const body = JSON.parse(call![1].body);
            expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        });
    });

    describe('all console levels', () => {
        beforeEach(async () => {
            process.env.EXPO_PUBLIC_DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING = '1';

            vi.doMock('@/utils/fetchWithTimeout', () => ({
                fetchWithTimeout: mockFetchWithTimeout,
            }));
            vi.doMock('@/config', () => ({
                config: { serverUrl: 'http://localhost:3000' },
            }));
        });

        it.each(['log', 'info', 'warn', 'error', 'debug'] as const)(
            'sends %s level logs to remote server',
            async (level) => {
                const {
                    monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds,
                } = await import('../remoteLogger');

                monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds();
                mockFetchWithTimeout.mockClear();

                const uniqueMessage = `LEVEL_${level.toUpperCase()}_TEST_${Date.now()}`;
                console[level](uniqueMessage);

                // Wait for async sendLog to complete
                await new Promise((resolve) => setTimeout(resolve, 50));

                const call = findFetchCallWithMessage(mockFetchWithTimeout, uniqueMessage);

                expect(call).toBeDefined();
                const body = JSON.parse(call![1].body);
                expect(body.level).toBe(level);
            }
        );
    });
});
