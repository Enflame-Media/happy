import { AuthCredentials } from '@/auth/tokenStorage';
import { backoff } from '@/utils/time';
import { getServerUrl } from './serverConfig';
import { AppError, ErrorCodes } from '@/utils/errors';
import { fetchWithTimeout } from '@/utils/fetchWithTimeout';

export async function registerPushToken(credentials: AuthCredentials, token: string): Promise<void> {
    const API_ENDPOINT = getServerUrl();
    await backoff(async () => {
        const response = await fetchWithTimeout(`${API_ENDPOINT}/v1/push-tokens`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ token })
        });

        if (!response.ok) {
            throw new AppError(ErrorCodes.API_ERROR, `Failed to register push token: ${response.status}`);
        }

        const data = await response.json();
        if (!data.success) {
            throw new AppError(ErrorCodes.API_ERROR, 'Failed to register push token');
        }
    });
}