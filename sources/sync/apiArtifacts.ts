import { AuthCredentials } from '@/auth/tokenStorage';
import { backoff } from '@/utils/time';
import { getServerUrl } from './serverConfig';
import { Artifact, ArtifactCreateRequest, ArtifactUpdateRequest, ArtifactUpdateResponse } from './artifactTypes';
import { AppError, ErrorCodes } from '@/utils/errors';
import { checkAuthError } from './apiHelper';
import { fetchWithTimeout } from '@/utils/fetchWithTimeout';

/**
 * Fetch all artifacts for the account
 */
export async function fetchArtifacts(credentials: AuthCredentials): Promise<Artifact[]> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetchWithTimeout(`${API_ENDPOINT}/v1/artifacts`, {
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
                'Content-Type': 'application/json'
            }
        });

        checkAuthError(response, 'fetching artifacts');
        if (!response.ok) {
            throw new AppError(ErrorCodes.FETCH_FAILED, `Failed to fetch artifacts: ${response.status}`, { canTryAgain: true });
        }

        const data = await response.json() as { artifacts: Artifact[] };
        return data.artifacts ?? [];
    });
}

/**
 * Fetch a single artifact with full body
 */
export async function fetchArtifact(credentials: AuthCredentials, artifactId: string): Promise<Artifact> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetchWithTimeout(`${API_ENDPOINT}/v1/artifacts/${artifactId}`, {
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
                'Content-Type': 'application/json'
            }
        });

        checkAuthError(response, 'fetching artifact');
        if (!response.ok) {
            if (response.status === 404) {
                throw new AppError(ErrorCodes.NOT_FOUND, 'Artifact not found');
            }
            throw new AppError(ErrorCodes.FETCH_FAILED, `Failed to fetch artifact: ${response.status}`, { canTryAgain: true });
        }

        const data = await response.json() as Artifact;
        return data;
    });
}

/**
 * Create a new artifact
 */
export async function createArtifact(
    credentials: AuthCredentials,
    request: ArtifactCreateRequest
): Promise<Artifact> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetchWithTimeout(`${API_ENDPOINT}/v1/artifacts`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(request)
        });

        checkAuthError(response, 'creating artifact');
        if (!response.ok) {
            if (response.status === 409) {
                throw new AppError(ErrorCodes.ALREADY_EXISTS, 'Artifact ID already exists');
            }
            throw new AppError(ErrorCodes.API_ERROR, `Failed to create artifact: ${response.status}`);
        }

        const data = await response.json() as Artifact;
        return data;
    });
}

/**
 * Update an existing artifact
 */
export async function updateArtifact(
    credentials: AuthCredentials,
    artifactId: string,
    request: ArtifactUpdateRequest
): Promise<ArtifactUpdateResponse> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetchWithTimeout(`${API_ENDPOINT}/v1/artifacts/${artifactId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(request)
        });

        checkAuthError(response, 'updating artifact');
        if (!response.ok) {
            if (response.status === 404) {
                throw new AppError(ErrorCodes.NOT_FOUND, 'Artifact not found');
            }
            throw new AppError(ErrorCodes.API_ERROR, `Failed to update artifact: ${response.status}`);
        }

        const data = await response.json() as ArtifactUpdateResponse;
        return data;
    });
}

/**
 * Delete an artifact
 */
export async function deleteArtifact(
    credentials: AuthCredentials,
    artifactId: string
): Promise<void> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetchWithTimeout(`${API_ENDPOINT}/v1/artifacts/${artifactId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${credentials.token}`
            }
        });

        checkAuthError(response, 'deleting artifact');
        if (!response.ok) {
            if (response.status === 404) {
                throw new AppError(ErrorCodes.NOT_FOUND, 'Artifact not found');
            }
            throw new AppError(ErrorCodes.API_ERROR, `Failed to delete artifact: ${response.status}`);
        }
    });
}