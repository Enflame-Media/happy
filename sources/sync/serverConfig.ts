import { createMMKV } from 'react-native-mmkv';

// Separate MMKV instance for server config that persists across logouts
const serverConfigStorage = createMMKV({ id: 'server-config' });

/**
 * Response from the server's root endpoint (/)
 * Used to validate if a URL points to a valid Happy Server
 */
export interface ServerInfoResponse {
    /** Server welcome message, e.g., "Welcome to Happy Server on Cloudflare Workers!" */
    message: string;
    /** Server version in semver format, e.g., "1.0.0" or "0.0.0" for development */
    version: string;
    /** Server environment, e.g., "production", "development" */
    environment: string;
    /** ISO 8601 timestamp of when the response was generated */
    timestamp: string;
}

/**
 * Types of server validation errors
 */
export type ServerValidationErrorType =
    | 'invalidJson'
    | 'missingFields'
    | 'incompatibleVersion'
    | 'networkError'
    | 'httpError'
    | 'emptyResponse';

/**
 * Result of server validation
 */
export interface ServerValidationResult {
    valid: boolean;
    errorType?: ServerValidationErrorType;
    /** Additional context for the error (e.g., missing field names, version info) */
    errorContext?: {
        missingFields?: string[];
        serverVersion?: string;
        requiredVersion?: string;
        httpStatus?: number;
    };
}

const SERVER_KEY = 'custom-server-url';
const DEFAULT_SERVER_URL = 'https://happy-api.enflamemedia.com';

export function getServerUrl(): string {
    return serverConfigStorage.getString(SERVER_KEY) || 
           process.env.EXPO_PUBLIC_HAPPY_SERVER_URL || 
           DEFAULT_SERVER_URL;
}

export function setServerUrl(url: string | null): void {
    if (url && url.trim()) {
        serverConfigStorage.set(SERVER_KEY, url.trim());
    } else {
        serverConfigStorage.remove(SERVER_KEY);
    }
}

export function isUsingCustomServer(): boolean {
    return getServerUrl() !== DEFAULT_SERVER_URL;
}

export function getServerInfo(): { hostname: string; port?: number; isCustom: boolean } {
    const url = getServerUrl();
    const isCustom = isUsingCustomServer();
    
    try {
        const parsed = new URL(url);
        const port = parsed.port ? parseInt(parsed.port) : undefined;
        return {
            hostname: parsed.hostname,
            port,
            isCustom
        };
    } catch {
        // Fallback if URL parsing fails
        return {
            hostname: url,
            port: undefined,
            isCustom
        };
    }
}

export function validateServerUrl(url: string): { valid: boolean; error?: string } {
    if (!url || !url.trim()) {
        return { valid: false, error: 'Server URL cannot be empty' };
    }
    
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { valid: false, error: 'Server URL must use HTTP or HTTPS protocol' };
        }
        return { valid: true };
    } catch {
        return { valid: false, error: 'Invalid URL format' };
    }
}