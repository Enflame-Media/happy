import { AuthCredentials } from '@/auth/tokenStorage';
import { backoff } from '@/utils/time';
import { getServerUrl } from './serverConfig';
import { AppError, ErrorCodes } from '@/utils/errors';
import { deduplicatedFetch } from './apiHelper';
import { fetchWithTimeout } from '@/utils/fetchWithTimeout';

export interface GitHubOAuthParams {
    url: string;
}

export interface GitHubProfile {
    id: number;
    login: string;
    name: string;
    avatar_url: string;
    email?: string;
}

export interface AccountProfile {
    id: string;
    timestamp: number;
    github: GitHubProfile | null;
}

/**
 * Get GitHub OAuth parameters from the server
 */
export async function getGitHubOAuthParams(credentials: AuthCredentials): Promise<GitHubOAuthParams> {
    const API_ENDPOINT = getServerUrl();
    
    return await backoff(async () => {
        const response = await deduplicatedFetch(`${API_ENDPOINT}/v1/connect/github/params`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            if (response.status === 400) {
                const error = await response.json();
                throw new AppError(ErrorCodes.NOT_CONFIGURED, error.error || 'GitHub OAuth not configured');
            }
            throw new AppError(ErrorCodes.FETCH_FAILED, `Failed to get GitHub OAuth params: ${response.status}`, { canTryAgain: true });
        }

        const data = await response.json() as GitHubOAuthParams;
        return data;
    });
}

/**
 * Get account profile including GitHub connection status
 */
export async function getAccountProfile(credentials: AuthCredentials): Promise<AccountProfile> {
    const API_ENDPOINT = getServerUrl();
    
    return await backoff(async () => {
        const response = await deduplicatedFetch(`${API_ENDPOINT}/v1/account/profile`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new AppError(ErrorCodes.FETCH_FAILED, `Failed to get account profile: ${response.status}`, { canTryAgain: true });
        }

        const data = await response.json() as AccountProfile;
        return data;
    });
}

/**
 * Disconnect GitHub account from the user's profile
 */
export async function disconnectGitHub(credentials: AuthCredentials): Promise<void> {
    const API_ENDPOINT = getServerUrl();
    
    return await backoff(async () => {
        const response = await fetchWithTimeout(`${API_ENDPOINT}/v1/connect/github`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${credentials.token}`
            }
        });

        if (!response.ok) {
            if (response.status === 404) {
                const error = await response.json();
                throw new AppError(ErrorCodes.SERVICE_NOT_CONNECTED, error.error || 'GitHub account not connected');
            }
            throw new AppError(ErrorCodes.SERVICE_ERROR, `Failed to disconnect GitHub: ${response.status}`);
        }

        const data = await response.json() as { success: true };
        if (!data.success) {
            throw new AppError(ErrorCodes.SERVICE_ERROR, 'Failed to disconnect GitHub account');
        }
    });
}