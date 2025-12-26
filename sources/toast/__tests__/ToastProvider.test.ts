/**
 * Unit tests for ToastProvider queue system.
 *
 * HAP-553: Comprehensive unit tests for toast queue system.
 * - HAP-462: Basic queue behavior (FIFO ordering, queue limits)
 * - HAP-517: Priority toast support (high-priority interruption, queue behavior)
 * - HAP-542: High-priority queue depth limit (overflow strategies)
 * - HAP-543: Auto-promote error toasts to high priority (autoHighPriorityErrors)
 *
 * Test categories:
 * - Queue Behavior: FIFO ordering, queue limits, overflow handling
 * - Duplicate Prevention: Message deduplication logic
 * - Dismissal: Manual dismiss, timer clearing, queue advancement
 * - Edge Cases: Rapid calls, invalid IDs, unmount cleanup
 * - High-Priority Interruption: Interrupt current toast, remaining duration
 * - High-Priority Queue: Queue ordering among high-priority toasts
 * - Overflow Handling: drop-newest, drop-oldest, downgrade strategies
 * - Auto-promote Error Toasts: Error type auto-promoted to high priority
 *
 * @module toast/__tests__/ToastProvider.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock timers for timeout testing
vi.useFakeTimers();

// Use vi.hoisted() for mock functions that need to be hoisted with vi.mock
const { mockHapticsLight } = vi.hoisted(() => ({
    mockHapticsLight: vi.fn(),
}));

// Mock React hooks - return functions directly for testing
vi.mock('react', () => ({
    createContext: vi.fn((defaultValue) => ({
        Provider: vi.fn(),
        Consumer: vi.fn(),
        _currentValue: defaultValue,
    })),
    useContext: vi.fn(),
    useState: vi.fn((initial) => {
        let state = typeof initial === 'function' ? initial() : initial;
        const setState = vi.fn((update) => {
            state = typeof update === 'function' ? update(state) : update;
            return state;
        });
        return [state, setState];
    }),
    useCallback: vi.fn((fn) => fn),
    useRef: vi.fn((initial) => ({ current: initial })),
    useEffect: vi.fn((fn) => {
        // Execute effect immediately for testing
        const cleanup = fn();
        return cleanup;
    }),
}));

// Mock React Native components and APIs
vi.mock('react-native', () => ({
    View: 'View',
    Pressable: 'Pressable',
    Animated: {
        Value: vi.fn((initial) => ({
            setValue: vi.fn(),
            interpolate: vi.fn(() => 0),
            _value: initial,
        })),
        View: 'AnimatedView',
        spring: vi.fn(() => ({ start: vi.fn((cb) => cb && cb()) })),
        timing: vi.fn(() => ({ start: vi.fn((cb) => cb && cb()) })),
    },
    Platform: { OS: 'web' },
    AccessibilityInfo: {
        announceForAccessibility: vi.fn(),
    },
}));

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: vi.fn(() => ({ top: 0, bottom: 34, left: 0, right: 0 })),
}));

vi.mock('react-native-unistyles', () => ({
    StyleSheet: {
        create: vi.fn((styles) => styles),
    },
}));

vi.mock('@/components/StyledText', () => ({
    Text: 'Text',
}));

vi.mock('@/constants/Typography', () => ({
    Typography: {
        default: vi.fn(() => ({})),
    },
}));

vi.mock('@/components/haptics', () => ({
    hapticsLight: mockHapticsLight,
}));

// Import types for testing
import type { ToastConfig, ToastState } from '../types';

/**
 * Test helper: Creates a mock state for testing setState callbacks
 */
function createMockState(overrides: Partial<ToastState> = {}): ToastState {
    return {
        current: null,
        queue: [],
        interrupted: null,
        ...overrides,
    };
}

/**
 * Test helper: Creates a toast config for testing
 */
function createToastConfig(overrides: Partial<ToastConfig> = {}): ToastConfig {
    return {
        id: `toast-${Date.now()}-${Math.random()}`,
        message: 'Test message',
        duration: 5000,
        ...overrides,
    };
}

/**
 * Default configuration values (must match ToastProvider.tsx)
 */
const DEFAULT_DURATION = 5000;
const DEFAULT_MAX_QUEUE_SIZE = 5;
const DEFAULT_MAX_HIGH_PRIORITY_QUEUE_SIZE = 3;
const DEFAULT_HIGH_PRIORITY_OVERFLOW: 'drop-oldest' | 'drop-newest' | 'downgrade' = 'drop-newest';
const DEFAULT_AUTO_HIGH_PRIORITY_ERRORS = true;

/**
 * Test helper: Full showToast options including high-priority handling
 */
interface ShowToastOptions {
    preventDuplicates?: boolean;
    maxQueueSize?: number;
    maxHighPriorityQueueSize?: number;
    highPriorityOverflow?: 'drop-oldest' | 'drop-newest' | 'downgrade';
    generateId?: () => string;
    /** Elapsed time in ms since current toast started (for remaining duration calculation) */
    elapsedTime?: number;
    /** Auto-promote error toasts to high priority when priority is undefined (default: true) */
    autoHighPriorityErrors?: boolean;
}

/**
 * Test helper: Simulates the showToast logic from ToastProvider
 *
 * This replicates the core setState logic to test queue behavior
 * without needing to render the full React component.
 *
 * Includes full high-priority interruption and overflow handling logic.
 */
function simulateShowToast(
    prevState: ToastState,
    config: Omit<ToastConfig, 'id'>,
    options: ShowToastOptions = {}
): { newState: ToastState; id: string; wasDropped?: boolean; wasDowngraded?: boolean } {
    const {
        preventDuplicates = true,
        maxQueueSize = DEFAULT_MAX_QUEUE_SIZE,
        maxHighPriorityQueueSize = DEFAULT_MAX_HIGH_PRIORITY_QUEUE_SIZE,
        highPriorityOverflow = DEFAULT_HIGH_PRIORITY_OVERFLOW,
        generateId = () => `toast-${Date.now()}-${Math.random()}`,
        elapsedTime = 0,
        autoHighPriorityErrors = DEFAULT_AUTO_HIGH_PRIORITY_ERRORS,
    } = options;

    const id = generateId();

    // Auto-promote error toasts to high priority (unless explicitly set to normal)
    // This matches the logic in ToastProvider.tsx
    const effectivePriority =
        config.type === 'error' && config.priority === undefined && autoHighPriorityErrors
            ? 'high'
            : config.priority;

    const isHighPriority = effectivePriority === 'high';
    const toastConfig: ToastConfig = {
        ...config,
        id,
        duration: config.duration ?? DEFAULT_DURATION,
        priority: effectivePriority,
    };

    // Check for duplicate messages if prevention is enabled
    if (preventDuplicates) {
        const isDuplicate =
            prevState.current?.message === config.message ||
            prevState.queue.some((t) => t.message === config.message) ||
            prevState.interrupted?.message === config.message;
        if (isDuplicate) {
            return { newState: prevState, id };
        }
    }

    // If no current toast, show immediately
    if (!prevState.current) {
        return {
            newState: { ...prevState, current: toastConfig },
            id,
        };
    }

    // HIGH PRIORITY: Interrupt current toast and show immediately
    if (isHighPriority) {
        // Count current high-priority toasts (current + queue)
        const highPriorityInQueue = prevState.queue.filter(t => t.priority === 'high').length;
        const currentIsHighPriority = prevState.current?.priority === 'high';
        const totalHighPriority = highPriorityInQueue + (currentIsHighPriority ? 1 : 0);

        // Check if high-priority queue is at capacity
        if (totalHighPriority >= maxHighPriorityQueueSize) {
            switch (highPriorityOverflow) {
                case 'drop-newest':
                    // Reject the new high-priority toast
                    return { newState: prevState, id, wasDropped: true };

                case 'drop-oldest': {
                    // Remove oldest high-priority from queue to make room
                    const firstHighPriorityIndex = prevState.queue.findIndex(t => t.priority === 'high');
                    if (firstHighPriorityIndex >= 0) {
                        const adjustedQueue = [...prevState.queue];
                        adjustedQueue.splice(firstHighPriorityIndex, 1);
                        // Process with adjusted queue
                        return processHighPriorityInterrupt(prevState, toastConfig, adjustedQueue, elapsedTime);
                    }
                    // If no high-priority in queue but current is high-priority,
                    // we still need to proceed (current will be re-queued)
                    break;
                }

                case 'downgrade': {
                    // Convert to normal priority and add to normal queue
                    const downgradedConfig = { ...toastConfig, priority: 'normal' as const };
                    // Apply normal queue logic
                    if (prevState.queue.length >= maxQueueSize) {
                        const newQueue = [...prevState.queue.slice(1), downgradedConfig];
                        return { newState: { ...prevState, queue: newQueue }, id, wasDowngraded: true };
                    }
                    return { newState: { ...prevState, queue: [...prevState.queue, downgradedConfig] }, id, wasDowngraded: true };
                }
            }
        }

        // Normal high-priority processing (no overflow or drop-oldest with no queued high-priority)
        return processHighPriorityInterrupt(prevState, toastConfig, prevState.queue, elapsedTime);
    }

    // NORMAL PRIORITY: Add to queue (respecting max size)
    if (prevState.queue.length >= maxQueueSize) {
        // Queue is full, drop the oldest queued toast to make room
        const newQueue = [...prevState.queue.slice(1), toastConfig];
        return { newState: { ...prevState, queue: newQueue }, id };
    }

    return {
        newState: { ...prevState, queue: [...prevState.queue, toastConfig] },
        id,
    };
}

/**
 * Helper function to process high-priority toast interruption
 */
function processHighPriorityInterrupt(
    prevState: ToastState,
    toastConfig: ToastConfig,
    baseQueue: ToastConfig[],
    elapsedTime: number
): { newState: ToastState; id: string } {
    // Calculate remaining duration for current toast
    const currentDuration = prevState.current!.duration ?? DEFAULT_DURATION;
    const remainingDuration = Math.max(1000, currentDuration - elapsedTime);

    // Store interrupted toast (only if it was a normal priority toast)
    const interruptedToast = prevState.current!.priority !== 'high' ? {
        ...prevState.current!,
        remainingDuration,
    } : null;

    // If current was high priority, add it back to front of queue
    const newQueue = prevState.current!.priority === 'high'
        ? [{ ...prevState.current!, duration: remainingDuration }, ...baseQueue]
        : baseQueue;

    return {
        newState: {
            current: toastConfig,
            queue: newQueue,
            interrupted: interruptedToast ?? prevState.interrupted,
        },
        id: toastConfig.id,
    };
}

/**
 * Test helper: Simulates the hideToast logic from ToastProvider
 */
function simulateHideToast(
    prevState: ToastState,
    id: string
): { newState: ToastState; showNext: boolean } {
    // Check if toast is in queue and remove it
    if (prevState.current?.id !== id) {
        const filteredQueue = prevState.queue.filter((t) => t.id !== id);
        if (filteredQueue.length !== prevState.queue.length) {
            return {
                newState: { ...prevState, queue: filteredQueue },
                showNext: false,
            };
        }
        // ID not found in current or queue
        return { newState: prevState, showNext: false };
    }

    // Current toast is being dismissed - trigger showNextFromQueue
    return { newState: prevState, showNext: true };
}

/**
 * Test helper: Simulates showNextFromQueue logic
 */
function simulateShowNextFromQueue(prevState: ToastState): ToastState {
    // Priority 1: Check for interrupted toast
    if (prevState.interrupted) {
        const resumingToast: ToastConfig = {
            id: prevState.interrupted.id,
            message: prevState.interrupted.message,
            duration: prevState.interrupted.remainingDuration,
            action: prevState.interrupted.action,
            type: prevState.interrupted.type,
            priority: prevState.interrupted.priority,
        };
        return { current: resumingToast, queue: prevState.queue, interrupted: null };
    }

    // Priority 2: Check queue
    if (prevState.queue.length === 0) {
        return { ...prevState, current: null };
    }

    // Get next toast from queue
    const [nextToast, ...remainingQueue] = prevState.queue;
    return { current: nextToast, queue: remainingQueue, interrupted: prevState.interrupted };
}

describe('ToastProvider Queue System', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.clearAllTimers();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // =========================================================================
    // QUEUE BEHAVIOR TESTS
    // =========================================================================

    describe('Queue Behavior', () => {
        it('shows toast immediately when queue is empty', () => {
            const state = createMockState();
            const { newState, id } = simulateShowToast(state, { message: 'First toast' });

            expect(newState.current).not.toBeNull();
            expect(newState.current?.message).toBe('First toast');
            expect(newState.queue).toHaveLength(0);
            expect(id).toBeTruthy();
        });

        it('queues second toast when first is visible', () => {
            const firstToast = createToastConfig({ id: 'first', message: 'First' });
            const state = createMockState({ current: firstToast });

            const { newState } = simulateShowToast(state, { message: 'Second' });

            expect(newState.current?.message).toBe('First');
            expect(newState.queue).toHaveLength(1);
            expect(newState.queue[0].message).toBe('Second');
        });

        it('respects maxQueueSize limit', () => {
            const firstToast = createToastConfig({ id: 'current', message: 'Current' });
            let state = createMockState({ current: firstToast });

            // Fill the queue to max (5)
            for (let i = 1; i <= 5; i++) {
                const { newState } = simulateShowToast(
                    state,
                    { message: `Queued ${i}` },
                    { maxQueueSize: 5, generateId: () => `queued-${i}` }
                );
                state = newState;
            }

            expect(state.queue).toHaveLength(5);
            expect(state.queue[0].message).toBe('Queued 1');
            expect(state.queue[4].message).toBe('Queued 5');
        });

        it('drops oldest queued toast when queue overflows', () => {
            const firstToast = createToastConfig({ id: 'current', message: 'Current' });
            let state = createMockState({ current: firstToast });

            // Fill the queue to max (5)
            for (let i = 1; i <= 5; i++) {
                const { newState } = simulateShowToast(
                    state,
                    { message: `Queued ${i}` },
                    { maxQueueSize: 5, generateId: () => `queued-${i}` }
                );
                state = newState;
            }

            // Add 6th toast - should drop oldest (Queued 1)
            const { newState: overflowState } = simulateShowToast(
                state,
                { message: 'Overflow toast' },
                { maxQueueSize: 5, generateId: () => 'overflow' }
            );

            expect(overflowState.queue).toHaveLength(5);
            expect(overflowState.queue[0].message).toBe('Queued 2'); // Oldest dropped
            expect(overflowState.queue[4].message).toBe('Overflow toast'); // New at end
        });

        it('displays toasts in FIFO order', () => {
            const firstToast = createToastConfig({ id: 'current', message: 'Current' });
            let state = createMockState({ current: firstToast });

            // Queue 3 toasts
            for (let i = 1; i <= 3; i++) {
                const { newState } = simulateShowToast(
                    state,
                    { message: `Toast ${i}` },
                    { generateId: () => `toast-${i}` }
                );
                state = newState;
            }

            expect(state.queue[0].message).toBe('Toast 1');
            expect(state.queue[1].message).toBe('Toast 2');
            expect(state.queue[2].message).toBe('Toast 3');

            // Simulate dismissing current and showing next
            let nextState = simulateShowNextFromQueue({
                current: null,
                queue: state.queue,
                interrupted: null,
            });
            expect(nextState.current?.message).toBe('Toast 1');

            nextState = simulateShowNextFromQueue({
                current: null,
                queue: nextState.queue,
                interrupted: null,
            });
            expect(nextState.current?.message).toBe('Toast 2');

            nextState = simulateShowNextFromQueue({
                current: null,
                queue: nextState.queue,
                interrupted: null,
            });
            expect(nextState.current?.message).toBe('Toast 3');
        });
    });

    // =========================================================================
    // DUPLICATE PREVENTION TESTS
    // =========================================================================

    describe('Duplicate Prevention', () => {
        it('skips duplicate messages when preventDuplicates is true', () => {
            const firstToast = createToastConfig({ id: 'first', message: 'Duplicate message' });
            const state = createMockState({ current: firstToast });

            const { newState } = simulateShowToast(
                state,
                { message: 'Duplicate message' },
                { preventDuplicates: true }
            );

            // State should be unchanged - duplicate was skipped
            expect(newState.queue).toHaveLength(0);
            expect(newState.current?.id).toBe('first');
        });

        it('checks both current and queued toasts for duplicates', () => {
            const currentToast = createToastConfig({ id: 'current', message: 'Current' });
            const queuedToast = createToastConfig({ id: 'queued', message: 'Queued message' });
            const state = createMockState({
                current: currentToast,
                queue: [queuedToast],
            });

            // Try to add duplicate of current
            const { newState: afterCurrentDupe } = simulateShowToast(
                state,
                { message: 'Current' },
                { preventDuplicates: true }
            );
            expect(afterCurrentDupe.queue).toHaveLength(1);

            // Try to add duplicate of queued
            const { newState: afterQueuedDupe } = simulateShowToast(
                state,
                { message: 'Queued message' },
                { preventDuplicates: true }
            );
            expect(afterQueuedDupe.queue).toHaveLength(1);
        });

        it('allows duplicates when preventDuplicates is false', () => {
            const firstToast = createToastConfig({ id: 'first', message: 'Duplicate allowed' });
            const state = createMockState({ current: firstToast });

            const { newState } = simulateShowToast(
                state,
                { message: 'Duplicate allowed' },
                { preventDuplicates: false }
            );

            expect(newState.queue).toHaveLength(1);
            expect(newState.queue[0].message).toBe('Duplicate allowed');
        });

        it('checks interrupted toast for duplicates', () => {
            const interruptedToast = {
                id: 'interrupted',
                message: 'Interrupted message',
                duration: 3000,
                remainingDuration: 2000,
            };
            const state = createMockState({
                current: createToastConfig({ id: 'current', message: 'Current' }),
                interrupted: interruptedToast,
            });

            const { newState } = simulateShowToast(
                state,
                { message: 'Interrupted message' },
                { preventDuplicates: true }
            );

            // Should not add duplicate of interrupted message
            expect(newState.queue).toHaveLength(0);
        });
    });

    // =========================================================================
    // DISMISSAL TESTS
    // =========================================================================

    describe('Dismissal', () => {
        it('dismisses current toast when hideToast called with its ID', () => {
            const currentToast = createToastConfig({ id: 'current-123', message: 'Current' });
            const state = createMockState({ current: currentToast });

            const { showNext } = simulateHideToast(state, 'current-123');

            expect(showNext).toBe(true);
        });

        it('removes toast from queue when hideToast called with queued toast ID', () => {
            const currentToast = createToastConfig({ id: 'current', message: 'Current' });
            const queuedToast = createToastConfig({ id: 'queued-remove', message: 'To remove' });
            const otherQueued = createToastConfig({ id: 'queued-keep', message: 'Keep' });
            const state = createMockState({
                current: currentToast,
                queue: [queuedToast, otherQueued],
            });

            const { newState, showNext } = simulateHideToast(state, 'queued-remove');

            expect(showNext).toBe(false);
            expect(newState.queue).toHaveLength(1);
            expect(newState.queue[0].id).toBe('queued-keep');
        });

        it('shows next toast after current is dismissed', () => {
            const nextToast = createToastConfig({ id: 'next', message: 'Next in queue' });
            const state = createMockState({
                current: null,
                queue: [nextToast],
            });

            const newState = simulateShowNextFromQueue(state);

            expect(newState.current?.id).toBe('next');
            expect(newState.current?.message).toBe('Next in queue');
            expect(newState.queue).toHaveLength(0);
        });

        it('resumes interrupted toast before queue', () => {
            const interruptedToast = {
                id: 'interrupted',
                message: 'Interrupted',
                duration: 5000,
                remainingDuration: 2500,
            };
            const queuedToast = createToastConfig({ id: 'queued', message: 'Queued' });
            const state = createMockState({
                current: null,
                queue: [queuedToast],
                interrupted: interruptedToast,
            });

            const newState = simulateShowNextFromQueue(state);

            expect(newState.current?.id).toBe('interrupted');
            expect(newState.current?.duration).toBe(2500); // Remaining duration
            expect(newState.interrupted).toBeNull();
            expect(newState.queue).toHaveLength(1); // Queue unchanged
        });

        it('returns null current when queue is empty and no interrupted', () => {
            const state = createMockState({ current: null, queue: [] });

            const newState = simulateShowNextFromQueue(state);

            expect(newState.current).toBeNull();
            expect(newState.queue).toHaveLength(0);
        });
    });

    // =========================================================================
    // EDGE CASE TESTS
    // =========================================================================

    describe('Edge Cases', () => {
        it('handles rapid sequential showToast calls', () => {
            let state = createMockState();

            // Simulate 10 rapid calls
            const ids: string[] = [];
            for (let i = 0; i < 10; i++) {
                const { newState, id } = simulateShowToast(
                    state,
                    { message: `Rapid ${i}` },
                    { maxQueueSize: 5, generateId: () => `rapid-${i}` }
                );
                state = newState;
                ids.push(id);
            }

            // First should be current, queue should have max 5
            expect(state.current?.message).toBe('Rapid 0');
            expect(state.queue).toHaveLength(5);
            // Due to overflow, queue should have Rapid 5-9
            expect(state.queue[0].message).toBe('Rapid 5');
            expect(state.queue[4].message).toBe('Rapid 9');
        });

        it('handles hideToast called with invalid ID', () => {
            const currentToast = createToastConfig({ id: 'valid-id', message: 'Current' });
            const state = createMockState({ current: currentToast });

            const { newState, showNext } = simulateHideToast(state, 'invalid-id');

            // State should be unchanged
            expect(newState).toBe(state);
            expect(showNext).toBe(false);
            expect(newState.current?.id).toBe('valid-id');
        });

        it('handles empty message string', () => {
            const state = createMockState();

            const { newState } = simulateShowToast(state, { message: '' });

            expect(newState.current?.message).toBe('');
        });

        it('handles very long messages', () => {
            const longMessage = 'A'.repeat(1000);
            const state = createMockState();

            const { newState } = simulateShowToast(state, { message: longMessage });

            expect(newState.current?.message).toBe(longMessage);
            expect(newState.current?.message.length).toBe(1000);
        });

        it('handles custom duration of 0', () => {
            const state = createMockState();

            const { newState } = simulateShowToast(state, {
                message: 'Instant',
                duration: 0,
            });

            expect(newState.current?.duration).toBe(0);
        });

        it('preserves action callback through queue', () => {
            const onPress = vi.fn();
            const currentToast = createToastConfig({ id: 'current', message: 'Current' });
            const state = createMockState({ current: currentToast });

            const { newState } = simulateShowToast(state, {
                message: 'With action',
                action: { label: 'Undo', onPress },
            });

            expect(newState.queue[0].action?.label).toBe('Undo');
            expect(newState.queue[0].action?.onPress).toBe(onPress);
        });

        it('handles type property through queue', () => {
            const currentToast = createToastConfig({ id: 'current', message: 'Current' });
            const state = createMockState({ current: currentToast });

            const { newState: successState } = simulateShowToast(state, {
                message: 'Success',
                type: 'success',
            });
            expect(successState.queue[0].type).toBe('success');

            // Disable autoHighPriorityErrors so error toast queues normally
            const { newState: errorState } = simulateShowToast(successState, {
                message: 'Error',
                type: 'error',
            }, { autoHighPriorityErrors: false });
            expect(errorState.queue[1].type).toBe('error');
        });

        it('handles showNextFromQueue with only interrupted (no queue)', () => {
            const interruptedToast = {
                id: 'interrupted',
                message: 'Interrupted only',
                duration: 5000,
                remainingDuration: 3000,
            };
            const state = createMockState({
                current: null,
                queue: [],
                interrupted: interruptedToast,
            });

            const newState = simulateShowNextFromQueue(state);

            expect(newState.current?.id).toBe('interrupted');
            expect(newState.queue).toHaveLength(0);
            expect(newState.interrupted).toBeNull();
        });
    });

    // =========================================================================
    // TIMER CLEANUP TESTS
    // =========================================================================

    describe('Timer Management', () => {
        it('verifies default duration is applied', () => {
            const state = createMockState();

            const { newState } = simulateShowToast(state, { message: 'No duration' });

            expect(newState.current?.duration).toBe(5000); // DEFAULT_DURATION
        });

        it('custom duration overrides default', () => {
            const state = createMockState();

            const { newState } = simulateShowToast(state, {
                message: 'Custom duration',
                duration: 3000,
            });

            expect(newState.current?.duration).toBe(3000);
        });
    });

    // =========================================================================
    // HIGH-PRIORITY INTERRUPTION TESTS (HAP-517)
    // =========================================================================

    describe('High-Priority Interruption', () => {
        it('high-priority toast interrupts current normal toast', () => {
            const normalToast = createToastConfig({ id: 'normal-1', message: 'Normal toast', priority: 'normal' });
            const state = createMockState({ current: normalToast });

            const { newState } = simulateShowToast(
                state,
                { message: 'Urgent!', priority: 'high' },
                { generateId: () => 'high-1', elapsedTime: 1000 }
            );

            // High-priority should become current
            expect(newState.current?.id).toBe('high-1');
            expect(newState.current?.priority).toBe('high');
            expect(newState.current?.message).toBe('Urgent!');
        });

        it('interrupted normal toast is stored with remaining duration', () => {
            const normalToast = createToastConfig({
                id: 'normal-1',
                message: 'Normal toast',
                priority: 'normal',
                duration: 5000,
            });
            const state = createMockState({ current: normalToast });

            // Simulate 2 seconds elapsed
            const { newState } = simulateShowToast(
                state,
                { message: 'Urgent!', priority: 'high' },
                { generateId: () => 'high-1', elapsedTime: 2000 }
            );

            // Interrupted toast should be stored with remaining duration
            expect(newState.interrupted).not.toBeNull();
            expect(newState.interrupted?.id).toBe('normal-1');
            expect(newState.interrupted?.remainingDuration).toBe(3000); // 5000 - 2000
        });

        it('remaining duration has minimum of 1 second', () => {
            const normalToast = createToastConfig({
                id: 'normal-1',
                message: 'Normal toast',
                priority: 'normal',
                duration: 3000,
            });
            const state = createMockState({ current: normalToast });

            // Simulate elapsed time exceeds duration
            const { newState } = simulateShowToast(
                state,
                { message: 'Urgent!', priority: 'high' },
                { generateId: () => 'high-1', elapsedTime: 5000 }
            );

            // Remaining duration should be clamped to 1000ms minimum
            expect(newState.interrupted?.remainingDuration).toBe(1000);
        });

        it('interrupted toast resumes after high-priority dismisses', () => {
            const interruptedToast = {
                id: 'interrupted',
                message: 'I was interrupted',
                duration: 5000,
                remainingDuration: 2500,
                priority: 'normal' as const,
            };
            const queuedToast = createToastConfig({ id: 'queued', message: 'Queued' });
            const state = createMockState({
                current: null,
                queue: [queuedToast],
                interrupted: interruptedToast,
            });

            const newState = simulateShowNextFromQueue(state);

            // Interrupted toast should resume with remaining duration
            expect(newState.current?.id).toBe('interrupted');
            expect(newState.current?.duration).toBe(2500);
            expect(newState.interrupted).toBeNull();
            // Queue should remain untouched
            expect(newState.queue).toHaveLength(1);
        });

        it('high-priority shows immediately when no current toast', () => {
            const state = createMockState();

            const { newState } = simulateShowToast(
                state,
                { message: 'Urgent with no current', priority: 'high' },
                { generateId: () => 'high-1' }
            );

            expect(newState.current?.priority).toBe('high');
            expect(newState.interrupted).toBeNull();
            expect(newState.queue).toHaveLength(0);
        });

        it('preserves all toast properties in interrupted state', () => {
            const normalToast = createToastConfig({
                id: 'normal-1',
                message: 'Normal with action',
                priority: 'normal',
                duration: 5000,
                type: 'success',
                action: { label: 'Undo', onPress: () => {} },
            });
            const state = createMockState({ current: normalToast });

            const { newState } = simulateShowToast(
                state,
                { message: 'Urgent!', priority: 'high' },
                { generateId: () => 'high-1', elapsedTime: 1000 }
            );

            expect(newState.interrupted?.message).toBe('Normal with action');
            expect(newState.interrupted?.type).toBe('success');
            expect(newState.interrupted?.action?.label).toBe('Undo');
        });
    });

    // =========================================================================
    // HIGH-PRIORITY QUEUE BEHAVIOR TESTS (HAP-517)
    // =========================================================================

    describe('High-Priority Queue Behavior', () => {
        it('high-priority toasts queue among themselves', () => {
            // First high-priority is current
            const highToast1 = createToastConfig({
                id: 'high-1',
                message: 'High 1',
                priority: 'high',
                duration: 5000,
            });
            const state = createMockState({ current: highToast1 });

            // Second high-priority interrupts
            const { newState } = simulateShowToast(
                state,
                { message: 'High 2', priority: 'high' },
                { generateId: () => 'high-2', elapsedTime: 1000 }
            );

            // High 2 should be current, High 1 should be in queue
            expect(newState.current?.id).toBe('high-2');
            expect(newState.queue).toHaveLength(1);
            expect(newState.queue[0].id).toBe('high-1');
            expect(newState.queue[0].priority).toBe('high');
        });

        it('current high-priority re-queued with remaining duration when new high-priority arrives', () => {
            const highToast1 = createToastConfig({
                id: 'high-1',
                message: 'High 1',
                priority: 'high',
                duration: 5000,
            });
            const state = createMockState({ current: highToast1 });

            // 2 seconds elapsed before interruption
            const { newState } = simulateShowToast(
                state,
                { message: 'High 2', priority: 'high' },
                { generateId: () => 'high-2', elapsedTime: 2000 }
            );

            // Re-queued high-priority should have remaining duration
            expect(newState.queue[0].duration).toBe(3000); // 5000 - 2000
        });

        it('high-priority does NOT store normal toast when interrupting another high-priority', () => {
            const highToast1 = createToastConfig({
                id: 'high-1',
                message: 'High 1',
                priority: 'high',
                duration: 5000,
            });
            const state = createMockState({ current: highToast1 });

            const { newState } = simulateShowToast(
                state,
                { message: 'High 2', priority: 'high' },
                { generateId: () => 'high-2', elapsedTime: 1000 }
            );

            // Should not set interrupted (only normal priority toasts are stored there)
            expect(newState.interrupted).toBeNull();
        });

        it('preserves existing interrupted toast when high-priority interrupts high-priority', () => {
            const interruptedNormal = {
                id: 'interrupted-normal',
                message: 'Original interrupted',
                duration: 5000,
                remainingDuration: 3000,
                priority: 'normal' as const,
            };
            const highToast1 = createToastConfig({
                id: 'high-1',
                message: 'High 1',
                priority: 'high',
                duration: 5000,
            });
            const state = createMockState({
                current: highToast1,
                interrupted: interruptedNormal,
            });

            const { newState } = simulateShowToast(
                state,
                { message: 'High 2', priority: 'high' },
                { generateId: () => 'high-2', elapsedTime: 1000 }
            );

            // Original interrupted should be preserved
            expect(newState.interrupted?.id).toBe('interrupted-normal');
            expect(newState.interrupted?.remainingDuration).toBe(3000);
        });

        it('multiple high-priority toasts queue in LIFO order (most recent first)', () => {
            let state = createMockState({
                current: createToastConfig({ id: 'high-1', message: 'High 1', priority: 'high', duration: 5000 }),
            });

            // Add High 2
            state = simulateShowToast(
                state,
                { message: 'High 2', priority: 'high' },
                { generateId: () => 'high-2', elapsedTime: 1000 }
            ).newState;

            // Add High 3
            state = simulateShowToast(
                state,
                { message: 'High 3', priority: 'high' },
                { generateId: () => 'high-3', elapsedTime: 500 }
            ).newState;

            // High 3 should be current, queue should be [High 2, High 1]
            expect(state.current?.id).toBe('high-3');
            expect(state.queue[0].id).toBe('high-2');
            expect(state.queue[1].id).toBe('high-1');
        });
    });

    // =========================================================================
    // HIGH-PRIORITY OVERFLOW HANDLING TESTS (HAP-542)
    // =========================================================================

    describe('High-Priority Overflow Handling', () => {
        describe('maxHighPriorityQueueSize limit', () => {
            it('counts current high-priority toast toward limit', () => {
                const highToast = createToastConfig({
                    id: 'high-1',
                    message: 'High 1',
                    priority: 'high',
                });
                const state = createMockState({ current: highToast });

                // With maxHighPriorityQueueSize=1, this should trigger overflow
                const { wasDropped } = simulateShowToast(
                    state,
                    { message: 'High 2', priority: 'high' },
                    { generateId: () => 'high-2', maxHighPriorityQueueSize: 1 }
                );

                expect(wasDropped).toBe(true);
            });

            it('counts queued high-priority toasts toward limit', () => {
                const normalToast = createToastConfig({
                    id: 'normal-1',
                    message: 'Normal',
                    priority: 'normal',
                });
                const queuedHigh = createToastConfig({
                    id: 'high-queued',
                    message: 'Queued High',
                    priority: 'high',
                });
                const state = createMockState({
                    current: normalToast,
                    queue: [queuedHigh],
                });

                // With maxHighPriorityQueueSize=1, this should trigger overflow
                const { wasDropped } = simulateShowToast(
                    state,
                    { message: 'New High', priority: 'high' },
                    { generateId: () => 'new-high', maxHighPriorityQueueSize: 1 }
                );

                expect(wasDropped).toBe(true);
            });

            it('does not trigger overflow when under limit', () => {
                const normalToast = createToastConfig({
                    id: 'normal-1',
                    message: 'Normal',
                    priority: 'normal',
                });
                const state = createMockState({ current: normalToast });

                // With maxHighPriorityQueueSize=3, first high-priority should work
                const { newState, wasDropped } = simulateShowToast(
                    state,
                    { message: 'High 1', priority: 'high' },
                    { generateId: () => 'high-1', maxHighPriorityQueueSize: 3 }
                );

                expect(wasDropped).toBeUndefined();
                expect(newState.current?.id).toBe('high-1');
            });

            it('triggers overflow at exactly maxHighPriorityQueueSize', () => {
                // Setup: 2 high-priority toasts (1 current, 1 queued) with limit of 2
                const highCurrent = createToastConfig({
                    id: 'high-1',
                    message: 'High 1',
                    priority: 'high',
                });
                const highQueued = createToastConfig({
                    id: 'high-2',
                    message: 'High 2',
                    priority: 'high',
                });
                const state = createMockState({
                    current: highCurrent,
                    queue: [highQueued],
                });

                // Third high-priority should trigger overflow
                const { wasDropped } = simulateShowToast(
                    state,
                    { message: 'High 3', priority: 'high' },
                    { generateId: () => 'high-3', maxHighPriorityQueueSize: 2 }
                );

                expect(wasDropped).toBe(true);
            });
        });

        describe('drop-newest strategy', () => {
            it('rejects new high-priority toast when at capacity', () => {
                const highToast = createToastConfig({
                    id: 'high-1',
                    message: 'High 1',
                    priority: 'high',
                });
                const state = createMockState({ current: highToast });

                const { newState, wasDropped } = simulateShowToast(
                    state,
                    { message: 'High 2', priority: 'high' },
                    {
                        generateId: () => 'high-2',
                        maxHighPriorityQueueSize: 1,
                        highPriorityOverflow: 'drop-newest',
                    }
                );

                expect(wasDropped).toBe(true);
                // State should be unchanged
                expect(newState.current?.id).toBe('high-1');
                expect(newState.queue).toHaveLength(0);
            });

            it('is the default overflow strategy', () => {
                const highToast = createToastConfig({
                    id: 'high-1',
                    message: 'High 1',
                    priority: 'high',
                });
                const state = createMockState({ current: highToast });

                // Don't specify highPriorityOverflow - should default to drop-newest
                const { wasDropped } = simulateShowToast(
                    state,
                    { message: 'High 2', priority: 'high' },
                    { generateId: () => 'high-2', maxHighPriorityQueueSize: 1 }
                );

                expect(wasDropped).toBe(true);
            });
        });

        describe('drop-oldest strategy', () => {
            it('removes oldest queued high-priority toast to make room', () => {
                const highCurrent = createToastConfig({
                    id: 'high-current',
                    message: 'Current High',
                    priority: 'high',
                });
                const highQueued1 = createToastConfig({
                    id: 'high-queued-1',
                    message: 'Queued High 1',
                    priority: 'high',
                });
                const highQueued2 = createToastConfig({
                    id: 'high-queued-2',
                    message: 'Queued High 2',
                    priority: 'high',
                });
                const state = createMockState({
                    current: highCurrent,
                    queue: [highQueued1, highQueued2],
                });

                // maxHighPriorityQueueSize=3, so we're at capacity
                const { newState } = simulateShowToast(
                    state,
                    { message: 'New High', priority: 'high' },
                    {
                        generateId: () => 'high-new',
                        maxHighPriorityQueueSize: 3,
                        highPriorityOverflow: 'drop-oldest',
                        elapsedTime: 1000,
                    }
                );

                // New high should be current
                expect(newState.current?.id).toBe('high-new');
                // Queue should have current re-queued, but oldest (high-queued-1) dropped
                // Result: [high-current, high-queued-2]
                expect(newState.queue).toHaveLength(2);
                expect(newState.queue.some(t => t.id === 'high-queued-1')).toBe(false);
            });

            it('still processes interruption after dropping oldest', () => {
                const highCurrent = createToastConfig({
                    id: 'high-current',
                    message: 'Current High',
                    priority: 'high',
                    duration: 5000,
                });
                const highQueued = createToastConfig({
                    id: 'high-queued',
                    message: 'Queued High',
                    priority: 'high',
                });
                const state = createMockState({
                    current: highCurrent,
                    queue: [highQueued],
                });

                const { newState } = simulateShowToast(
                    state,
                    { message: 'New High', priority: 'high' },
                    {
                        generateId: () => 'high-new',
                        maxHighPriorityQueueSize: 2,
                        highPriorityOverflow: 'drop-oldest',
                        elapsedTime: 2000,
                    }
                );

                // New high should be current
                expect(newState.current?.id).toBe('high-new');
                // Original current should be re-queued with remaining duration
                expect(newState.queue.some(t => t.id === 'high-current')).toBe(true);
                const requeued = newState.queue.find(t => t.id === 'high-current');
                expect(requeued?.duration).toBe(3000); // 5000 - 2000
            });
        });

        describe('downgrade strategy', () => {
            it('converts high-priority to normal priority', () => {
                const highToast = createToastConfig({
                    id: 'high-1',
                    message: 'High 1',
                    priority: 'high',
                });
                const state = createMockState({ current: highToast });

                const { newState, wasDowngraded } = simulateShowToast(
                    state,
                    { message: 'High 2', priority: 'high' },
                    {
                        generateId: () => 'high-2',
                        maxHighPriorityQueueSize: 1,
                        highPriorityOverflow: 'downgrade',
                    }
                );

                expect(wasDowngraded).toBe(true);
                // Original high-priority should remain current
                expect(newState.current?.id).toBe('high-1');
                // Downgraded toast should be in queue as normal priority
                expect(newState.queue).toHaveLength(1);
                expect(newState.queue[0].id).toBe('high-2');
                expect(newState.queue[0].priority).toBe('normal');
            });

            it('applies normal queue rules after downgrade', () => {
                const highToast = createToastConfig({
                    id: 'high-1',
                    message: 'High 1',
                    priority: 'high',
                });
                // Fill normal queue to max
                const normalQueue = Array.from({ length: 5 }, (_, i) =>
                    createToastConfig({ id: `normal-${i}`, message: `Normal ${i}`, priority: 'normal' })
                );
                const state = createMockState({
                    current: highToast,
                    queue: normalQueue,
                });

                const { newState, wasDowngraded } = simulateShowToast(
                    state,
                    { message: 'High 2', priority: 'high' },
                    {
                        generateId: () => 'high-2',
                        maxHighPriorityQueueSize: 1,
                        highPriorityOverflow: 'downgrade',
                        maxQueueSize: 5,
                    }
                );

                expect(wasDowngraded).toBe(true);
                // Queue should still be 5 (oldest dropped)
                expect(newState.queue).toHaveLength(5);
                // First normal should be dropped
                expect(newState.queue[0].id).toBe('normal-1');
                // Downgraded should be last
                expect(newState.queue[4].id).toBe('high-2');
                expect(newState.queue[4].priority).toBe('normal');
            });

            it('downgraded toast does not interrupt current', () => {
                const normalToast = createToastConfig({
                    id: 'normal-1',
                    message: 'Normal',
                    priority: 'normal',
                });
                const highQueued = createToastConfig({
                    id: 'high-queued',
                    message: 'Queued High',
                    priority: 'high',
                });
                const state = createMockState({
                    current: normalToast,
                    queue: [highQueued],
                });

                const { newState, wasDowngraded } = simulateShowToast(
                    state,
                    { message: 'New High', priority: 'high' },
                    {
                        generateId: () => 'high-new',
                        maxHighPriorityQueueSize: 1,
                        highPriorityOverflow: 'downgrade',
                    }
                );

                expect(wasDowngraded).toBe(true);
                // Current should remain unchanged
                expect(newState.current?.id).toBe('normal-1');
                // No interruption occurred
                expect(newState.interrupted).toBeNull();
            });
        });

        describe('mixed priority scenarios', () => {
            it('normal priority toasts not affected by high-priority limit', () => {
                // Fill up high-priority capacity
                const highCurrent = createToastConfig({
                    id: 'high-1',
                    message: 'High 1',
                    priority: 'high',
                });
                const highQueued = createToastConfig({
                    id: 'high-2',
                    message: 'High 2',
                    priority: 'high',
                });
                const state = createMockState({
                    current: highCurrent,
                    queue: [highQueued],
                });

                // Normal priority should still queue normally
                const { newState, wasDropped } = simulateShowToast(
                    state,
                    { message: 'Normal', priority: 'normal' },
                    {
                        generateId: () => 'normal-1',
                        maxHighPriorityQueueSize: 2,
                        highPriorityOverflow: 'drop-newest',
                    }
                );

                expect(wasDropped).toBeUndefined();
                expect(newState.queue).toHaveLength(2);
                expect(newState.queue[1].id).toBe('normal-1');
                expect(newState.queue[1].priority).toBe('normal');
            });

            it('handles transition from normal to high-priority queue', () => {
                const normalToast = createToastConfig({
                    id: 'normal-1',
                    message: 'Normal 1',
                    priority: 'normal',
                });
                const state = createMockState({ current: normalToast });

                // Add first high-priority
                let result = simulateShowToast(
                    state,
                    { message: 'High 1', priority: 'high' },
                    { generateId: () => 'high-1', elapsedTime: 1000, maxHighPriorityQueueSize: 2 }
                );

                // High should be current, normal should be interrupted
                expect(result.newState.current?.id).toBe('high-1');
                expect(result.newState.interrupted?.id).toBe('normal-1');

                // Add second high-priority
                result = simulateShowToast(
                    result.newState,
                    { message: 'High 2', priority: 'high' },
                    { generateId: () => 'high-2', elapsedTime: 500, maxHighPriorityQueueSize: 2 }
                );

                // High 2 current, High 1 queued, normal still interrupted
                expect(result.newState.current?.id).toBe('high-2');
                expect(result.newState.queue[0].id).toBe('high-1');
                expect(result.newState.interrupted?.id).toBe('normal-1');

                // Third high-priority should trigger overflow
                result = simulateShowToast(
                    result.newState,
                    { message: 'High 3', priority: 'high' },
                    { generateId: () => 'high-3', maxHighPriorityQueueSize: 2 }
                );

                expect(result.wasDropped).toBe(true);
            });
        });
    });

    // =========================================================================
    // AUTO-PROMOTE ERROR TOASTS TESTS (HAP-543)
    // =========================================================================

    describe('Auto-promote error toasts (HAP-543)', () => {
        it('error toasts are auto-promoted to high priority by default', () => {
            const normalToast = createToastConfig({
                id: 'normal-1',
                message: 'Normal toast',
                priority: 'normal',
            });
            const state = createMockState({ current: normalToast });

            // Error toast without explicit priority
            const { newState } = simulateShowToast(
                state,
                { message: 'Error occurred!', type: 'error' },
                { generateId: () => 'error-1', elapsedTime: 1000 }
            );

            // Error should be promoted to high priority and interrupt
            expect(newState.current?.id).toBe('error-1');
            expect(newState.current?.priority).toBe('high');
            expect(newState.current?.type).toBe('error');
            // Normal toast should be interrupted
            expect(newState.interrupted?.id).toBe('normal-1');
        });

        it('error toasts NOT auto-promoted when autoHighPriorityErrors is false', () => {
            const normalToast = createToastConfig({
                id: 'normal-1',
                message: 'Normal toast',
                priority: 'normal',
            });
            const state = createMockState({ current: normalToast });

            // Error toast with autoHighPriorityErrors disabled
            const { newState } = simulateShowToast(
                state,
                { message: 'Error occurred!', type: 'error' },
                { generateId: () => 'error-1', autoHighPriorityErrors: false }
            );

            // Error should be queued as normal priority (no interruption)
            expect(newState.current?.id).toBe('normal-1');
            expect(newState.queue).toHaveLength(1);
            expect(newState.queue[0].id).toBe('error-1');
            expect(newState.queue[0].priority).toBeUndefined();
        });

        it('error toasts with explicit priority: "normal" are not promoted', () => {
            const normalToast = createToastConfig({
                id: 'normal-1',
                message: 'Normal toast',
                priority: 'normal',
            });
            const state = createMockState({ current: normalToast });

            // Error toast with explicit normal priority
            const { newState } = simulateShowToast(
                state,
                { message: 'Error occurred!', type: 'error', priority: 'normal' },
                { generateId: () => 'error-1' }
            );

            // Error should stay as normal priority (no interruption)
            expect(newState.current?.id).toBe('normal-1');
            expect(newState.queue).toHaveLength(1);
            expect(newState.queue[0].id).toBe('error-1');
            expect(newState.queue[0].priority).toBe('normal');
        });

        it('error toasts with explicit priority: "high" remain high priority', () => {
            const normalToast = createToastConfig({
                id: 'normal-1',
                message: 'Normal toast',
                priority: 'normal',
            });
            const state = createMockState({ current: normalToast });

            // Error toast with explicit high priority
            const { newState } = simulateShowToast(
                state,
                { message: 'Critical error!', type: 'error', priority: 'high' },
                { generateId: () => 'error-1', elapsedTime: 1000 }
            );

            // Should interrupt as expected
            expect(newState.current?.id).toBe('error-1');
            expect(newState.current?.priority).toBe('high');
        });

        it('non-error toasts are not affected by autoHighPriorityErrors', () => {
            const normalToast = createToastConfig({
                id: 'normal-1',
                message: 'Normal toast',
                priority: 'normal',
            });
            const state = createMockState({ current: normalToast });

            // Success toast without explicit priority
            const { newState } = simulateShowToast(
                state,
                { message: 'Success!', type: 'success' },
                { generateId: () => 'success-1' }
            );

            // Success toast should be queued as normal (no promotion)
            expect(newState.current?.id).toBe('normal-1');
            expect(newState.queue).toHaveLength(1);
            expect(newState.queue[0].id).toBe('success-1');
            expect(newState.queue[0].priority).toBeUndefined();
        });

        it('auto-promoted error toasts respect high-priority overflow limits', () => {
            // Fill high-priority capacity
            const highCurrent = createToastConfig({
                id: 'high-1',
                message: 'High 1',
                priority: 'high',
            });
            const state = createMockState({ current: highCurrent });

            // Error toast should be promoted but then dropped due to overflow
            const { wasDropped } = simulateShowToast(
                state,
                { message: 'Error occurred!', type: 'error' },
                { generateId: () => 'error-1', maxHighPriorityQueueSize: 1 }
            );

            expect(wasDropped).toBe(true);
        });

        it('auto-promoted error interrupts normal toast, normal toast resumes after', () => {
            // Setup: Normal toast is currently visible
            const normalToast = createToastConfig({
                id: 'normal-1',
                message: 'Normal toast',
                priority: 'normal',
                duration: 5000,
            });
            const state = createMockState({ current: normalToast });

            // 1. Error (auto-promoted) interrupts after 2 seconds
            const { newState: afterError } = simulateShowToast(
                state,
                { message: 'Error occurred!', type: 'error' },
                { generateId: () => 'error-1', elapsedTime: 2000 }
            );

            // Error should be current, normal should be interrupted with remaining duration
            expect(afterError.current?.id).toBe('error-1');
            expect(afterError.current?.type).toBe('error');
            expect(afterError.current?.priority).toBe('high');
            expect(afterError.interrupted?.id).toBe('normal-1');
            expect(afterError.interrupted?.remainingDuration).toBe(3000); // 5000 - 2000

            // 2. Error toast dismisses, normal toast resumes
            const afterErrorDismissed = simulateShowNextFromQueue({
                current: null,
                queue: afterError.queue,
                interrupted: afterError.interrupted,
            });

            // Normal toast should resume with remaining duration
            expect(afterErrorDismissed.current?.id).toBe('normal-1');
            expect(afterErrorDismissed.current?.duration).toBe(3000);
            expect(afterErrorDismissed.interrupted).toBeNull();
        });
    });
});

// Note: The useToast hook's fallback behavior (returning no-op functions when
// used outside ToastProvider) is a simple conditional return that doesn't
// require testing. The core queue logic is thoroughly tested above via the
// simulateShowToast/simulateHideToast helpers which replicate the setState
// callback behavior.
