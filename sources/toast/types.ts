/**
 * Toast system types
 *
 * Supports simple toasts and action toasts (with undo/action button).
 */

export interface ToastAction {
    /** Label for the action button */
    label: string;
    /** Callback when action is pressed */
    onPress: () => void;
}

export interface ToastConfig {
    /** Unique identifier for the toast */
    id: string;
    /** Message to display */
    message: string;
    /** Duration in milliseconds before auto-dismiss (default: 3000) */
    duration?: number;
    /** Optional action button (e.g., Undo) */
    action?: ToastAction;
    /** Type affects styling - 'default' | 'success' | 'error' */
    type?: 'default' | 'success' | 'error';
    /**
     * Priority level for queue ordering
     * - 'normal' (default): Added to end of queue
     * - 'high': Interrupts current toast and shows immediately
     */
    priority?: 'normal' | 'high';
}

export interface ToastQueueConfig {
    /** Maximum number of toasts to queue (default: 5) */
    maxQueueSize?: number;
    /** If true, duplicate messages (same message text) are ignored (default: true) */
    preventDuplicates?: boolean;
    /** Maximum high-priority toasts allowed before overflow handling (default: 3) */
    maxHighPriorityQueueSize?: number;
    /**
     * Behavior when high-priority queue is full:
     * - 'drop-oldest': Remove oldest high-priority from queue, add new one
     * - 'drop-newest': Reject new high-priority toast (default)
     * - 'downgrade': Convert new high-priority to normal priority
     */
    highPriorityOverflow?: 'drop-oldest' | 'drop-newest' | 'downgrade';
    /**
     * If true, type: 'error' toasts automatically use high priority (default: true).
     * This ensures error messages interrupt normal toasts and show immediately.
     * Set to false to disable auto-promotion, or explicitly set priority: 'normal' on individual toasts.
     */
    autoHighPriorityErrors?: boolean;
}

export interface ToastState {
    /** Currently displayed toast */
    current: ToastConfig | null;
    /** Queue of pending toasts (FIFO for normal, priority-aware ordering) */
    queue: ToastConfig[];
    /**
     * Toast that was interrupted by a high-priority toast.
     * When the high-priority toast dismisses, this will resume.
     * Stores remaining duration so the interrupted toast can continue where it left off.
     */
    interrupted: (ToastConfig & { remainingDuration: number }) | null;
}

export interface ToastContextValue {
    state: ToastState;
    showToast: (config: Omit<ToastConfig, 'id'>) => string;
    hideToast: (id: string) => void;
    /** Clear all toasts (current and queued). Optionally skip animation for instant clear. */
    clearAllToasts: (skipAnimation?: boolean) => void;
}
