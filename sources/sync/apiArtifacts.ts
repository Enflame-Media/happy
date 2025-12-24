import { AuthCredentials } from '@/auth/tokenStorage';
import { backoff } from '@/utils/time';
import { getServerUrl } from './serverConfig';
import { Artifact, ArtifactCreateRequest, ArtifactUpdateRequest, ArtifactUpdateResponse } from './artifactTypes';
import { AppError, ErrorCodes } from '@/utils/errors';
import { checkAuthError, deduplicatedFetch } from './apiHelper';
import { fetchWithTimeout } from '@/utils/fetchWithTimeout';

/**
 * Response from fetch artifacts endpoint
 * HAP-492: Now includes maxSeq for incremental sync tracking
 */
export interface FetchArtifactsResponse {
    artifacts: Artifact[];
    maxSeq: number;
}

/**
 * Fetch artifacts for the account
 * HAP-492: Supports incremental sync via optional sinceSeq parameter
 * @param credentials - Auth credentials
 * @param sinceSeq - Optional sequence number to fetch only newer artifacts
 * @returns Response with artifacts and maxSeq for tracking
 */
export async function fetchArtifacts(credentials: AuthCredentials, sinceSeq?: number): Promise<FetchArtifactsResponse> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        // Build URL with optional sinceSeq query parameter
        const url = new URL(`${API_ENDPOINT}/v1/artifacts`);
        if (sinceSeq !== undefined && sinceSeq > 0) {
            url.searchParams.set('sinceSeq', sinceSeq.toString());
        }

        const response = await deduplicatedFetch(url.toString(), {
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
                'Content-Type': 'application/json'
            }
        });

        checkAuthError(response, 'fetching artifacts');
        if (!response.ok) {
            throw new AppError(ErrorCodes.FETCH_FAILED, `Failed to fetch artifacts: ${response.status}`, { canTryAgain: true });
        }

        const data = await response.json() as FetchArtifactsResponse;
        return {
            artifacts: data.artifacts ?? [],
            maxSeq: data.maxSeq ?? 0
        };
    });
}

/**
 * Fetch a single artifact with full body
 */
export async function fetchArtifact(credentials: AuthCredentials, artifactId: string): Promise<Artifact> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await deduplicatedFetch(`${API_ENDPOINT}/v1/artifacts/${artifactId}`, {
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