/**
 * MultiSelectContext - Context for sharing multi-select state across session list components
 *
 * This context allows the SessionsList and its child components to access
 * multi-select state without prop drilling.
 */
import * as React from 'react';
import { Session } from '@/sync/storageTypes';

interface MultiSelectContextValue {
    /** Whether multi-select mode is active */
    isSelectMode: boolean;
    /** Set of selected session IDs */
    selectedIds: Set<string>;
    /** Toggle selection of a session */
    toggleItem: (id: string) => void;
    /** Check if a session is selected */
    isSelected: (id: string) => boolean;
    /** Enter multi-select mode */
    enterSelectMode: () => void;
    /** Exit multi-select mode */
    exitSelectMode: () => void;
    /** Select all eligible sessions */
    selectAll: (sessions: Session[]) => void;
    /** Deselect all */
    deselectAll: () => void;
    /** Count of selected items */
    selectedCount: number;
}

const MultiSelectContext = React.createContext<MultiSelectContextValue | null>(null);

export function useMultiSelectContext() {
    const context = React.useContext(MultiSelectContext);
    if (!context) {
        // Return a default "disabled" state for components outside the provider
        return {
            isSelectMode: false,
            selectedIds: new Set<string>(),
            toggleItem: () => {},
            isSelected: () => false,
            enterSelectMode: () => {},
            exitSelectMode: () => {},
            selectAll: () => {},
            deselectAll: () => {},
            selectedCount: 0,
        };
    }
    return context;
}

interface MultiSelectProviderProps {
    children: React.ReactNode;
    value: MultiSelectContextValue;
}

export function MultiSelectProvider({ children, value }: MultiSelectProviderProps) {
    return (
        <MultiSelectContext.Provider value={value}>
            {children}
        </MultiSelectContext.Provider>
    );
}
