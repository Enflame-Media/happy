import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { AuthCredentials } from '@/auth/tokenStorage';
import { getServerUrl } from '@/sync/serverConfig';
import { authenticatedFetch } from '@/sync/apiHelper';
import { AppError, ErrorCodes } from '@/utils/errors';

/**
 * Represents a single usage limit category (e.g., session limit, weekly model limit)
 */
export interface UsageLimit {
    /** Unique identifier for this limit */
    id: string;
    /** Display label (e.g., "Current session", "All models", "Sonnet only") */
    label: string;
    /** Percentage used (0-100) */
    percentageUsed: number;
    /** Unix timestamp when this limit resets */
    resetsAt: number;
    /** Type of reset display: 'countdown' shows "Resets in X hr Y min", 'datetime' shows "Resets Thu 1:59 AM" */
    resetDisplayType: 'countdown' | 'datetime';
    /** Optional description or info tooltip text */
    description?: string;
}

/**
 * Response structure from the plan limits API
 */
export interface PlanLimitsResponse {
    /** Current session usage limit */
    sessionLimit?: UsageLimit;
    /** Weekly usage limits (may include per-model breakdowns) */
    weeklyLimits: UsageLimit[];
    /** Unix timestamp when this data was last updated */
    lastUpdatedAt: number;
    /** Whether the provider exposes limit data (some may not) */
    limitsAvailable: boolean;
    /** Provider name for display (e.g., "Anthropic") */
    provider?: string;
}

/**
 * Hook state for plan limits data
 */
export interface PlanLimitsState {
    data: PlanLimitsResponse | null;
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
}

/**
 * Fetch plan usage limits from the server
 */
async function fetchPlanLimits(
    credentials: AuthCredentials
): Promise<PlanLimitsResponse> {
    const API_ENDPOINT = getServerUrl();

    const response = await authenticatedFetch(
        `${API_ENDPOINT}/v1/usage/limits`,
        credentials,
        {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
        },
        'fetching plan limits'
    );

    if (!response.ok) {
        if (response.status === 404) {
            // Endpoint not implemented yet - return empty state
            return {
                weeklyLimits: [],
                lastUpdatedAt: Date.now(),
                limitsAvailable: false,
            };
        }
        throw new AppError(
            ErrorCodes.FETCH_FAILED,
            `Failed to fetch plan limits: ${response.status}`,
            { canTryAgain: true }
        );
    }

    return await response.json() as PlanLimitsResponse;
}

/**
 * Hook to fetch and manage plan usage limits
 *
 * Usage:
 * ```tsx
 * const { data, loading, error, refresh } = usePlanLimits();
 * ```
 */
export function usePlanLimits(): PlanLimitsState {
    const auth = useAuth();
    const [data, setData] = useState<PlanLimitsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        if (!auth.credentials) {
            setError('Not authenticated');
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const response = await fetchPlanLimits(auth.credentials);
            setData(response);
        } catch (err) {
            console.error('Failed to fetch plan limits:', err);
            if (err instanceof AppError) {
                setError(err.message);
            } else {
                setError('Failed to load plan limits');
            }
        } finally {
            setLoading(false);
        }
    }, [auth.credentials]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    return { data, loading, error, refresh };
}

/**
 * Format a reset time as a countdown string (e.g., "4 hr 8 min")
 */
export function formatResetCountdown(resetsAt: number): string {
    const now = Date.now();
    const diffMs = resetsAt - now;

    if (diffMs <= 0) {
        return 'now';
    }

    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;

    if (hours > 0 && minutes > 0) {
        return `${hours} hr ${minutes} min`;
    } else if (hours > 0) {
        return `${hours} hr`;
    } else {
        return `${minutes} min`;
    }
}

/**
 * Format a reset time as a datetime string (e.g., "Thu 1:59 AM")
 */
export function formatResetDatetime(resetsAt: number): string {
    const date = new Date(resetsAt);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayName = days[date.getDay()];

    let hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // 0 should be 12

    const minuteStr = minutes < 10 ? `0${minutes}` : `${minutes}`;

    return `${dayName} ${hours}:${minuteStr} ${ampm}`;
}

/**
 * Format the "last updated" timestamp as a relative time string
 */
export function formatLastUpdated(timestamp: number): string {
    const now = Date.now();
    const diffMs = now - timestamp;
    const diffMinutes = Math.floor(diffMs / (1000 * 60));

    if (diffMinutes < 1) {
        return 'less than a minute ago';
    } else if (diffMinutes === 1) {
        return '1 minute ago';
    } else if (diffMinutes < 60) {
        return `${diffMinutes} minutes ago`;
    } else {
        const hours = Math.floor(diffMinutes / 60);
        return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
    }
}
