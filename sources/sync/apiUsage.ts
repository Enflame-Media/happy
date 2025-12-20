import { AuthCredentials } from '@/auth/tokenStorage';
import { backoff } from '@/utils/time';
import { getServerUrl } from './serverConfig';
import { AppError, ErrorCodes } from '@/utils/errors';
import { fetchWithTimeout } from '@/utils/fetchWithTimeout';

export interface UsageDataPoint {
    timestamp: number;
    tokens: Record<string, number>;
    cost: Record<string, number>;
    reportCount: number;
}

export interface UsageQueryParams {
    sessionId?: string;
    startTime?: number; // Unix timestamp in seconds
    endTime?: number;   // Unix timestamp in seconds
    groupBy?: 'hour' | 'day';
}

export interface UsageResponse {
    usage: UsageDataPoint[];
}

/**
 * Query usage data from the server
 */
export async function queryUsage(
    credentials: AuthCredentials,
    params: UsageQueryParams = {}
): Promise<UsageResponse> {
    const API_ENDPOINT = getServerUrl();
    
    return await backoff(async () => {
        const response = await fetchWithTimeout(`${API_ENDPOINT}/v1/usage/query`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(params)
        });

        if (!response.ok) {
            if (response.status === 404 && params.sessionId) {
                throw new AppError(ErrorCodes.NOT_FOUND, 'Session not found');
            }
            throw new AppError(ErrorCodes.FETCH_FAILED, `Failed to query usage: ${response.status}`, { canTryAgain: true });
        }

        const data = await response.json() as UsageResponse;
        return data;
    });
}

/**
 * Helper function to get usage for a specific time period
 */
export async function getUsageForPeriod(
    credentials: AuthCredentials,
    period: 'today' | '7days' | '30days',
    sessionId?: string
): Promise<UsageResponse> {
    const now = Math.floor(Date.now() / 1000);
    const oneDaySeconds = 24 * 60 * 60;
    
    let startTime: number;
    let groupBy: 'hour' | 'day';
    
    switch (period) {
        case 'today':
            // Start of today (local timezone)
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            startTime = Math.floor(today.getTime() / 1000);
            groupBy = 'hour';
            break;
        case '7days':
            startTime = now - (7 * oneDaySeconds);
            groupBy = 'day';
            break;
        case '30days':
            startTime = now - (30 * oneDaySeconds);
            groupBy = 'day';
            break;
    }
    
    return queryUsage(credentials, {
        sessionId,
        startTime,
        endTime: now,
        groupBy
    });
}

/**
 * Token type keys used in cost and token breakdowns.
 * These match the keys sent by the CLI in usage-report events.
 */
export const TOKEN_TYPE_KEYS = ['input', 'output', 'cache_creation', 'cache_read'] as const;
export type TokenType = typeof TOKEN_TYPE_KEYS[number];

/**
 * Check if a key is a token type key (input, output, cache_creation, cache_read)
 * rather than a model name or 'total'.
 */
function isTokenTypeKey(key: string): key is TokenType {
    return TOKEN_TYPE_KEYS.includes(key as TokenType);
}

/**
 * Cost breakdown by token type.
 * Values are in USD.
 */
export interface CostByTokenType {
    input: number;
    output: number;
    cache_creation: number;
    cache_read: number;
}

/**
 * Calculate total tokens and cost from usage data.
 *
 * The usage data contains costs keyed by token type (input, output, cache_creation, cache_read)
 * plus a 'total' key. This function extracts and aggregates both the raw data and
 * structured token-type breakdown.
 */
export function calculateTotals(usage: UsageDataPoint[]): {
    totalTokens: number;
    totalCost: number;
    tokensByModel: Record<string, number>;
    /** @deprecated Use costByTokenType instead - this contains token type keys, not model names */
    costByModel: Record<string, number>;
    /** Cost breakdown by token type (input, output, cache_creation, cache_read) */
    costByTokenType: CostByTokenType;
} {
    const result = {
        totalTokens: 0,
        totalCost: 0,
        tokensByModel: {} as Record<string, number>,
        costByModel: {} as Record<string, number>,
        costByTokenType: {
            input: 0,
            output: 0,
            cache_creation: 0,
            cache_read: 0
        } as CostByTokenType
    };

    for (const dataPoint of usage) {
        // Sum tokens
        for (const [key, tokens] of Object.entries(dataPoint.tokens)) {
            if (typeof tokens === 'number') {
                result.totalTokens += tokens;
                result.tokensByModel[key] = (result.tokensByModel[key] || 0) + tokens;
            }
        }

        // Sum costs
        for (const [key, cost] of Object.entries(dataPoint.cost)) {
            if (typeof cost === 'number') {
                result.totalCost += cost;
                result.costByModel[key] = (result.costByModel[key] || 0) + cost;

                // Also populate structured costByTokenType if this is a token type key
                if (isTokenTypeKey(key)) {
                    result.costByTokenType[key] += cost;
                }
            }
        }
    }

    return result;
}