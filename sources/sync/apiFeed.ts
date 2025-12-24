import { AuthCredentials } from '@/auth/tokenStorage';
import { backoff } from '@/utils/time';
import { getServerUrl } from './serverConfig';
import { FeedResponseSchema, FeedItem } from './feedTypes';
import { log } from '@/log';
import { AppError, ErrorCodes } from '@/utils/errors';
import { authenticatedFetch } from './apiHelper';
import { parseCursorCounterOrDefault, isValidCursor } from './cursorUtils';

/**
 * Fetch user's feed with pagination
 */
export async function fetchFeed(
    credentials: AuthCredentials,
    options?: {
        limit?: number;
        before?: string;
        after?: string;
    }
): Promise<{ items: FeedItem[]; hasMore: boolean }> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const params = new URLSearchParams();
        if (options?.limit) params.set('limit', options.limit.toString());
        if (options?.before) params.set('before', options.before);
        if (options?.after) params.set('after', options.after);

        const url = `${API_ENDPOINT}/v1/feed${params.toString() ? `?${params}` : ''}`;
        log.log(`📰 Fetching feed: ${url}`);

        // HAP-519: Use authenticatedFetch for automatic 401 retry after token refresh
        const response = await authenticatedFetch(
            url,
            credentials,
            { method: 'GET', useDedupe: true },
            'fetching feed'
        );

        if (!response.ok) {
            throw new AppError(ErrorCodes.FETCH_FAILED, `Failed to fetch feed: ${response.status}`, { canTryAgain: true });
        }

        const data = await response.json();
        const parsed = FeedResponseSchema.safeParse(data);

        if (!parsed.success) {
            console.error('Failed to parse feed response:', parsed.error);
            throw new AppError(ErrorCodes.VALIDATION_FAILED, 'Invalid feed response format');
        }

        // Add counter field from cursor with validation
        // Invalid cursors fall back to counter 0 (first page behavior)
        const itemsWithCounter: FeedItem[] = parsed.data.items
            .filter(item => {
                if (!isValidCursor(item.cursor)) {
                    log.log(`⚠️ Skipping feed item ${item.id} with invalid cursor: ${item.cursor}`);
                    return false;
                }
                return true;
            })
            .map(item => ({
                ...item,
                counter: parseCursorCounterOrDefault(item.cursor)
            }));

        return {
            items: itemsWithCounter,
            hasMore: parsed.data.hasMore
        };
    });
}