import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { TokenStorage, AuthCredentials } from '@/auth/tokenStorage';
import { syncCreate } from '@/sync/sync';
import * as Updates from 'expo-updates';
import { clearPersistence } from '@/sync/persistence';
import { Platform, AppState, AppStateStatus } from 'react-native';
import { trackLogout } from '@/track';
import { AppError, ErrorCodes } from '@/utils/errors';
import { authRefreshToken, shouldRefreshToken, TOKEN_REFRESH_CONSTANTS } from '@/auth/authRefreshToken';

interface AuthContextType {
    isAuthenticated: boolean;
    credentials: AuthCredentials | null;
    login: (token: string, secret: string, expiresAt?: number) => Promise<void>;
    logout: () => Promise<void>;
    /** Attempt to refresh the current token. Returns true if successful. */
    refreshToken: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children, initialCredentials }: { children: ReactNode; initialCredentials: AuthCredentials | null }) {
    const [isAuthenticated, setIsAuthenticated] = useState(!!initialCredentials);
    const [credentials, setCredentials] = useState<AuthCredentials | null>(initialCredentials);
    const refreshInProgressRef = useRef(false);

    /**
     * Attempts to refresh the current authentication token.
     * Called proactively when token is about to expire, or reactively on 401 errors.
     * Returns true if refresh was successful, false otherwise.
     */
    const refreshToken = useCallback(async (): Promise<boolean> => {
        // Prevent concurrent refresh attempts
        if (refreshInProgressRef.current) {
            console.log('[AuthContext.refreshToken] Refresh already in progress, skipping');
            return false;
        }

        if (!credentials) {
            console.log('[AuthContext.refreshToken] No credentials to refresh');
            return false;
        }

        refreshInProgressRef.current = true;

        try {
            console.log('[AuthContext.refreshToken] Attempting token refresh...');
            const result = await authRefreshToken(credentials.token);

            if (result) {
                const newCredentials: AuthCredentials = {
                    token: result.token,
                    secret: credentials.secret,
                    expiresAt: result.expiresAt,
                };

                const success = await TokenStorage.setCredentials(newCredentials);
                if (success) {
                    setCredentials(newCredentials);
                    console.log('[AuthContext.refreshToken] Token refreshed and stored successfully');
                    return true;
                }
                console.log('[AuthContext.refreshToken] Failed to store refreshed token');
            } else {
                console.log('[AuthContext.refreshToken] Server rejected token refresh');
            }

            return false;
        } finally {
            refreshInProgressRef.current = false;
        }
    }, [credentials]);

    /**
     * Check token expiration and refresh proactively on app startup and foreground.
     */
    const checkAndRefreshIfNeeded = useCallback(async () => {
        if (!credentials) return;

        if (shouldRefreshToken(credentials.expiresAt)) {
            console.log('[AuthContext] Token needs refresh, attempting proactive refresh...');
            await refreshToken();
        }
    }, [credentials, refreshToken]);

    // Check token on mount and when credentials change
    useEffect(() => {
        checkAndRefreshIfNeeded();
    }, [checkAndRefreshIfNeeded]);

    // Check token when app comes to foreground
    useEffect(() => {
        const handleAppStateChange = (nextAppState: AppStateStatus) => {
            if (nextAppState === 'active') {
                checkAndRefreshIfNeeded();
            }
        };

        const subscription = AppState.addEventListener('change', handleAppStateChange);
        return () => subscription.remove();
    }, [checkAndRefreshIfNeeded]);

    // Update global auth state when local state changes
    useEffect(() => {
        setCurrentAuth(credentials ? { isAuthenticated, credentials, login, logout, refreshToken } : null);
    }, [isAuthenticated, credentials, refreshToken]);

    const login = async (token: string, secret: string, expiresAt?: number) => {
        console.log('[AuthContext.login] Starting...');
        // If no expiresAt provided, calculate from default lifetime (30 days)
        const tokenExpiresAt = expiresAt ?? (Date.now() + TOKEN_REFRESH_CONSTANTS.DEFAULT_LIFETIME_MS);
        const newCredentials: AuthCredentials = { token, secret, expiresAt: tokenExpiresAt };
        console.log('[AuthContext.login] Storing credentials...');
        const success = await TokenStorage.setCredentials(newCredentials);
        console.log('[AuthContext.login] Credentials stored:', success);
        if (success) {
            console.log('[AuthContext.login] Calling syncCreate...');
            await syncCreate(newCredentials);
            console.log('[AuthContext.login] syncCreate completed, updating state...');
            setCredentials(newCredentials);
            setIsAuthenticated(true);
            console.log('[AuthContext.login] Done!');
        } else {
            console.log('[AuthContext.login] Failed to save credentials');
            throw new AppError(ErrorCodes.AUTH_FAILED, 'Failed to save credentials');
        }
    };

    const logout = async () => {
        trackLogout();
        clearPersistence();
        await TokenStorage.removeCredentials();

        // Update React state to ensure UI consistency
        setCredentials(null);
        setIsAuthenticated(false);

        if (Platform.OS === 'web') {
            window.location.reload();
        } else {
            try {
                await Updates.reloadAsync();
            } catch (error) {
                // In dev mode, reloadAsync will throw ERR_UPDATES_DISABLED
                console.log('Reload failed (expected in dev mode):', error);
            }
        }
    };

    return (
        <AuthContext.Provider
            value={{
                isAuthenticated,
                credentials,
                login,
                logout,
                refreshToken,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new AppError(ErrorCodes.INTERNAL_ERROR, 'useAuth must be used within an AuthProvider');
    }
    return context;
}

// Helper to get current auth state for non-React contexts
let currentAuthState: AuthContextType | null = null;

export function setCurrentAuth(auth: AuthContextType | null) {
    currentAuthState = auth;
}

export function getCurrentAuth(): AuthContextType | null {
    return currentAuthState;
}