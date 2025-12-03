import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Production-ready search hook with automatic debouncing, caching, and retry logic.
 * 
 * Features:
 * - Prevents parallel queries by skipping new requests while one is in progress
 * - Permanent in-memory cache for the lifetime of the component
 * - Automatic retry on errors with exponential backoff
 * - 300ms debounce to reduce API calls
 * - Returns cached results immediately if available
 * 
 * @param query - The search query string
 * @param searchFn - The async function to perform the search
 * @returns Object with results array and isSearching boolean
 */
export function useSearch<T>(
    query: string,
    searchFn: (query: string) => Promise<T[]>
): { results: T[]; isSearching: boolean } {
    const [results, setResults] = useState<T[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    
    // Permanent cache for search results
    const cacheRef = useRef<Map<string, T[]>>(new Map());
    
    // Ref to prevent parallel queries
    const isSearchingRef = useRef(false);
    
    // Timeout ref for debouncing
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    
    // Perform the search with retry logic and abort support
    const performSearch = useCallback(async (searchQuery: string, signal: AbortSignal) => {
        // Skip if already searching or aborted
        if (isSearchingRef.current || signal.aborted) {
            return;
        }

        // Check cache first
        const cached = cacheRef.current.get(searchQuery);
        if (cached) {
            setResults(cached);
            return;
        }

        // Mark as searching
        isSearchingRef.current = true;
        setIsSearching(true);

        // Retry logic with exponential backoff
        let retryDelay = 1000; // Start with 1 second

        try {
            while (true) {
                // Check if aborted before each iteration
                if (signal.aborted) {
                    return;
                }

                try {
                    const searchResults = await searchFn(searchQuery);

                    // Check if aborted before state updates
                    if (signal.aborted) {
                        return;
                    }

                    // Cache the results
                    cacheRef.current.set(searchQuery, searchResults);

                    // Update state
                    setResults(searchResults);
                    break; // Success, exit the retry loop

                } catch {
                    // Check if aborted before retry delay
                    if (signal.aborted) {
                        return;
                    }

                    // Search failed - retry with exponential backoff
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    retryDelay = Math.min(retryDelay * 2, 30000);
                }
            }
        } finally {
            // Always reset the searching ref (we're no longer searching)
            isSearchingRef.current = false;
            // Only update React state if not aborted (to avoid state updates on unmounted component)
            if (!signal.aborted) {
                setIsSearching(false);
            }
        }
    }, [searchFn]);
    
    // Effect to handle debounced search
    useEffect(() => {
        // Create abort controller for cleanup
        const abortController = new AbortController();

        // Clear previous timeout
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        // If query is empty, clear results immediately
        if (!query.trim()) {
            setResults([]);
            setIsSearching(false);
            return () => abortController.abort();
        }

        // Check cache immediately
        const cached = cacheRef.current.get(query);
        if (cached) {
            setResults(cached);
            setIsSearching(false);
            return () => abortController.abort();
        }

        // Set searching state immediately for better UX
        setIsSearching(true);

        // Debounce the actual search
        timeoutRef.current = setTimeout(() => {
            performSearch(query, abortController.signal);
        }, 300); // Hardcoded 300ms debounce

        // Cleanup: abort any in-progress search and clear timeout
        return () => {
            abortController.abort();
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, [query, performSearch]);
    
    return { results, isSearching };
}