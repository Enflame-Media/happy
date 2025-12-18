/**
 * useMultiSelect - Generic multi-select state management hook
 *
 * Provides a reusable pattern for managing multi-select mode in lists.
 * Can be used for any list that needs select-all, select-none, toggle functionality.
 *
 * Features:
 * - Enter/exit multi-select mode
 * - Toggle individual item selection
 * - Select all / deselect all
 * - Count of selected items
 * - Haptic feedback on selection changes
 *
 * @example
 * const { isSelectMode, selectedIds, toggleSelectMode, toggleItem, selectAll, deselectAll } = useMultiSelect();
 */
import * as React from 'react';
import { hapticsLight } from '@/components/haptics';

interface UseMultiSelectOptions<T extends string = string> {
    /** Initial selection state (default: empty set) */
    initialSelection?: T[];
    /** Callback when selection changes */
    onSelectionChange?: (selectedIds: T[]) => void;
    /** Enable haptic feedback (default: true) */
    hapticFeedback?: boolean;
}

interface UseMultiSelectReturn<T extends string = string> {
    /** Whether multi-select mode is active */
    isSelectMode: boolean;
    /** Set of selected item IDs */
    selectedIds: Set<T>;
    /** Array of selected item IDs (for convenience) */
    selectedIdsArray: T[];
    /** Count of selected items */
    selectedCount: number;
    /** Enter multi-select mode */
    enterSelectMode: () => void;
    /** Exit multi-select mode and clear selection */
    exitSelectMode: () => void;
    /** Toggle multi-select mode */
    toggleSelectMode: () => void;
    /** Toggle selection of a single item */
    toggleItem: (id: T) => void;
    /** Check if an item is selected */
    isSelected: (id: T) => boolean;
    /** Select all items from a given list */
    selectAll: (ids: T[]) => void;
    /** Deselect all items */
    deselectAll: () => void;
    /** Select specific items (replace current selection) */
    setSelection: (ids: T[]) => void;
}

export function useMultiSelect<T extends string = string>(
    options: UseMultiSelectOptions<T> = {}
): UseMultiSelectReturn<T> {
    const {
        initialSelection = [],
        onSelectionChange,
        hapticFeedback = true
    } = options;

    const [isSelectMode, setIsSelectMode] = React.useState(false);
    const [selectedIds, setSelectedIds] = React.useState<Set<T>>(
        () => new Set(initialSelection)
    );

    // Convert Set to Array for convenience
    const selectedIdsArray = React.useMemo(
        () => Array.from(selectedIds),
        [selectedIds]
    );

    const selectedCount = selectedIds.size;

    // Notify on selection change
    React.useEffect(() => {
        onSelectionChange?.(selectedIdsArray);
    }, [selectedIdsArray, onSelectionChange]);

    const enterSelectMode = React.useCallback(() => {
        if (hapticFeedback) hapticsLight();
        setIsSelectMode(true);
    }, [hapticFeedback]);

    const exitSelectMode = React.useCallback(() => {
        if (hapticFeedback) hapticsLight();
        setIsSelectMode(false);
        setSelectedIds(new Set());
    }, [hapticFeedback]);

    const toggleSelectMode = React.useCallback(() => {
        if (isSelectMode) {
            exitSelectMode();
        } else {
            enterSelectMode();
        }
    }, [isSelectMode, enterSelectMode, exitSelectMode]);

    const toggleItem = React.useCallback((id: T) => {
        if (hapticFeedback) hapticsLight();
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, [hapticFeedback]);

    const isSelected = React.useCallback((id: T) => {
        return selectedIds.has(id);
    }, [selectedIds]);

    const selectAll = React.useCallback((ids: T[]) => {
        if (hapticFeedback) hapticsLight();
        setSelectedIds(new Set(ids));
    }, [hapticFeedback]);

    const deselectAll = React.useCallback(() => {
        if (hapticFeedback) hapticsLight();
        setSelectedIds(new Set());
    }, [hapticFeedback]);

    const setSelection = React.useCallback((ids: T[]) => {
        setSelectedIds(new Set(ids));
    }, []);

    return {
        isSelectMode,
        selectedIds,
        selectedIdsArray,
        selectedCount,
        enterSelectMode,
        exitSelectMode,
        toggleSelectMode,
        toggleItem,
        isSelected,
        selectAll,
        deselectAll,
        setSelection,
    };
}
