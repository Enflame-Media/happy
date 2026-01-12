import 'react-native-quick-base64';
import '../theme.css';
import * as React from 'react';
import * as SplashScreen from 'expo-splash-screen';
import * as Fonts from 'expo-font';
import { markAppStart, markFirstRender, useResourceMonitoring } from '@/utils/performance';
import { logger } from '@/utils/logger';

// Mark app start as early as possible in module load
markAppStart();
import { NotificationResponseHandler } from '@/components/NotificationResponseHandler';
// Icon fonts are loaded on-demand by @expo/vector-icons v15+
// Use direct imports (e.g., '@expo/vector-icons/Ionicons') throughout codebase for tree-shaking
import { AuthCredentials, TokenStorage } from '@/auth/tokenStorage';
import { AuthProvider } from '@/auth/AuthContext';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { initialWindowMetrics, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SidebarNavigator } from '@/components/SidebarNavigator';
import sodium from '@/encryption/libsodium.lib';
import { View, Platform, Text } from 'react-native';
import { ModalProvider } from '@/modal';
import { ToastProvider } from '@/toast';
import { PostHogProvider } from 'posthog-react-native';
import { tracking } from '@/track/tracking';
import { syncRestore } from '@/sync/sync';
import { setAnalyticsCredentials } from '@/sync/apiAnalytics';
import { startValidationMetricsReporting } from '@/sync/typesRaw';
import { useTrackScreens } from '@/track/useTrackScreens';
import { RealtimeProvider } from '@/realtime/RealtimeProvider';
import { FaviconPermissionIndicator } from '@/components/web/FaviconPermissionIndicator';
import { CommandPaletteProvider } from '@/components/CommandPalette/CommandPaletteProvider';
import { StatusBarProvider } from '@/components/StatusBarProvider';
// import * as SystemUI from 'expo-system-ui';
import { monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds } from '@/utils/remoteLogger';
import { useUnistyles } from 'react-native-unistyles';
import { AsyncLock } from '@/utils/lock';
import { initializeCertificatePinning } from '@/utils/certificatePinning';
import * as Notifications from 'expo-notifications';

// Configure notification handler for foreground notifications
// This allows notifications to be shown even when the app is in the foreground
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
    }),
});

// Setup Android notification channel (required for Android 8.0+)
// Must be called before any notifications are shown on Android
if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
    });
}

export {
    // Catch any errors thrown by the Layout component.
    ErrorBoundary,
} from 'expo-router';

// Configure splash screen
SplashScreen.setOptions({
    fade: true,
    duration: 300,
})
SplashScreen.preventAutoHideAsync();

// Set window background color - now handled by Unistyles
// SystemUI.setBackgroundColorAsync('white');

// Remote logging for local AI debugging - guarded by HAP-836 production guardrails
// The function enforces: __DEV__ must be true AND server URL must be local/dev only
if (process.env.EXPO_PUBLIC_DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING) {
    monkeyPatchConsoleForRemoteLoggingForFasterAiAutoDebuggingOnlyInLocalBuilds()
}

// Component to apply horizontal safe area padding
function HorizontalSafeAreaWrapper({ children }: { children: React.ReactNode }) {
    const insets = useSafeAreaInsets();
    return (
        <View style={{
            flex: 1,
            paddingLeft: insets.left,
            paddingRight: insets.right
        }}>
            {children}
        </View>
    );
}

let lock = new AsyncLock();
let loaded = false;
async function loadFonts() {
    await lock.inLock(async () => {
        if (loaded) {
            return;
        }
        loaded = true;
        // Check if running in Tauri
        const isTauri = Platform.OS === 'web' &&
            typeof window !== 'undefined' &&
            (window as any).__TAURI_INTERNALS__ !== undefined;

        if (!isTauri) {
            // Normal font loading for non-Tauri environments (native and regular web)
            await Fonts.loadAsync({
                // Keep existing font
                SpaceMono: require('@/assets/fonts/SpaceMono-Regular.ttf'),

                // IBM Plex Sans family
                'IBMPlexSans-Regular': require('@/assets/fonts/IBMPlexSans-Regular.ttf'),
                'IBMPlexSans-Italic': require('@/assets/fonts/IBMPlexSans-Italic.ttf'),
                'IBMPlexSans-SemiBold': require('@/assets/fonts/IBMPlexSans-SemiBold.ttf'),

                // IBM Plex Mono family  
                'IBMPlexMono-Regular': require('@/assets/fonts/IBMPlexMono-Regular.ttf'),
                'IBMPlexMono-Italic': require('@/assets/fonts/IBMPlexMono-Italic.ttf'),
                'IBMPlexMono-SemiBold': require('@/assets/fonts/IBMPlexMono-SemiBold.ttf'),

                // Bricolage Grotesque
                'BricolageGrotesque-Bold': require('@/assets/fonts/BricolageGrotesque-Bold.ttf'),
            });
        } else {
            // For Tauri, skip Font Face Observer as fonts are loaded via CSS
            logger.debug('[_layout] Do not wait for fonts to load');
            (async () => {
                try {
                    await Fonts.loadAsync({
                        // Keep existing font
                        SpaceMono: require('@/assets/fonts/SpaceMono-Regular.ttf'),

                        // IBM Plex Sans family
                        'IBMPlexSans-Regular': require('@/assets/fonts/IBMPlexSans-Regular.ttf'),
                        'IBMPlexSans-Italic': require('@/assets/fonts/IBMPlexSans-Italic.ttf'),
                        'IBMPlexSans-SemiBold': require('@/assets/fonts/IBMPlexSans-SemiBold.ttf'),

                        // IBM Plex Mono family  
                        'IBMPlexMono-Regular': require('@/assets/fonts/IBMPlexMono-Regular.ttf'),
                        'IBMPlexMono-Italic': require('@/assets/fonts/IBMPlexMono-Italic.ttf'),
                        'IBMPlexMono-SemiBold': require('@/assets/fonts/IBMPlexMono-SemiBold.ttf'),

                        // Bricolage Grotesque
                        'BricolageGrotesque-Bold': require('@/assets/fonts/BricolageGrotesque-Bold.ttf'),
                    });
                } catch {
                    // Ignore
                }
            })();
        }
    });
}

export default function RootLayout() {
    const { theme } = useUnistyles();
    const navigationTheme = React.useMemo(() => {
        if (theme.dark) {
            return {
                ...DarkTheme,
                colors: {
                    ...DarkTheme.colors,
                    background: theme.colors.groupped.background,
                }
            }
        }
        return {
            ...DefaultTheme,
            colors: {
                ...DefaultTheme.colors,
                background: theme.colors.groupped.background,
            }
        };
    }, [theme.dark, theme.colors.groupped.background]);

    //
    // Init sequence
    //
    const [initState, setInitState] = React.useState<{ credentials: AuthCredentials | null } | null>(null);
    const [debugInfo, setDebugInfo] = React.useState<string>('Starting...');
    React.useEffect(() => {
        // HAP-835: Debug markers gated to dev builds only
        if (__DEV__) {
            // UNMISSABLE DEBUG MARKER - if you don't see this, the build is stale!
            console.warn('🚀🚀🚀 HAPPY APP INIT v2 - ' + new Date().toISOString() + ' 🚀🚀🚀');
            // Also try alert for absolute certainty
            if (Platform.OS === 'web' && typeof window !== 'undefined') {
                (window as any).__HAPPY_DEBUG__ = (window as any).__HAPPY_DEBUG__ || [];
                (window as any).__HAPPY_DEBUG__.push('Init started: ' + new Date().toISOString());
            }
        }
        (async () => {
            logger.debug('[_layout] Init sequence starting...');
            setDebugInfo('Init starting...');
            try {
                logger.debug('[_layout] Loading fonts...');
                setDebugInfo('Loading fonts...');
                await loadFonts();
                logger.debug('[_layout] Fonts loaded, initializing certificate pinning...');
                setDebugInfo('Fonts loaded, initializing security...');
                // HAP-624: Initialize certificate pinning before any API calls
                // This protects against MITM attacks on all subsequent network requests
                await initializeCertificatePinning();
                logger.debug('[_layout] Certificate pinning initialized, waiting for sodium...');
                setDebugInfo('Security initialized, waiting for sodium...');
                await sodium.ready;
                logger.debug('[_layout] Sodium ready, getting credentials...');
                setDebugInfo('Sodium ready, getting credentials...');
                const credentials = await TokenStorage.getCredentials();
                logger.debug('[_layout] Credentials:', credentials ? 'found' : 'not found');
                setDebugInfo('Credentials: ' + (credentials ? 'found' : 'not found'));
                if (credentials) {
                    logger.debug('[_layout] Calling syncRestore...');
                    setDebugInfo('Calling syncRestore...');
                    // Add timeout to prevent infinite hang - sync will continue in background
                    const INIT_TIMEOUT_MS = 15000;
                    try {
                        await Promise.race([
                            syncRestore(credentials),
                            new Promise<void>((_, reject) =>
                                setTimeout(() => reject(new Error('syncRestore timed out')), INIT_TIMEOUT_MS)
                            ),
                        ]);
                        logger.debug('[_layout] syncRestore completed');
                        setDebugInfo('syncRestore completed');
                    } catch (syncError) {
                        console.warn('[_layout] syncRestore failed/timed out:', syncError);
                        setDebugInfo('syncRestore failed: ' + String(syncError));

                        // If token is invalid, clear credentials and start fresh
                        const errorMessage = String(syncError);
                        if (errorMessage.includes('Invalid token') || errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
                            console.warn('[_layout] Invalid token detected, clearing credentials...');
                            setDebugInfo('Invalid token - clearing credentials...');
                            await TokenStorage.removeCredentials();
                            // Set credentials to null to show login screen
                            setInitState({ credentials: null });
                            return; // Exit early, don't continue with invalid credentials
                        }
                        // For other errors, continue with credentials (sync will retry in background)
                    }

                    // Initialize validation metrics reporting (HAP-583)
                    // Set credentials for fire-and-forget analytics reporting
                    setAnalyticsCredentials(credentials);
                    // Start periodic 5-minute batch reporting of validation failures
                    startValidationMetricsReporting();
                }

                logger.debug('[_layout] Setting init state...');
                setDebugInfo('Setting init state...');
                setInitState({ credentials });
                logger.debug('[_layout] Init complete!');
                setDebugInfo('Init complete!');
            } catch (error) {
                logger.error('[_layout] Error initializing:', error);
                setDebugInfo('ERROR: ' + String(error));
                // Still try to show the app even if init fails
                logger.debug('[_layout] Attempting to show app despite error...');
                setInitState({ credentials: null });
            }
        })();
    }, []);

    React.useEffect(() => {
        if (initState) {
            // Mark first meaningful render for performance tracking
            markFirstRender();
            setTimeout(() => {
                SplashScreen.hideAsync();
            }, 100);
        }
    }, [initState]);


    // Track the screens
    useTrackScreens()

    // Monitor JS thread blocking and memory usage (HAP-381)
    useResourceMonitoring();

    //
    // Not inited - show loading state (debug info only in dev builds)
    // HAP-835: Debug UI gated to dev builds only
    //

    if (!initState) {
        // In production, show a minimal loading state that matches the app theme
        // In dev, show detailed debug info for troubleshooting
        if (__DEV__) {
            return (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a2e', padding: 20 }}>
                    <Text style={{ color: '#00ff00', fontSize: 18, fontFamily: 'monospace', textAlign: 'center' }}>
                        DEBUG MODE
                    </Text>
                    <Text style={{ color: '#ffffff', fontSize: 14, fontFamily: 'monospace', marginTop: 20, textAlign: 'center' }}>
                        {debugInfo}
                    </Text>
                    <Text style={{ color: '#888888', fontSize: 12, fontFamily: 'monospace', marginTop: 20, textAlign: 'center' }}>
                        If stuck here, check browser console (F12)
                    </Text>
                </View>
            );
        }
        // Production: minimal loading state - splash screen handles the visual
        return null;
    }

    //
    // Boot
    //

    let providers = (
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
            <KeyboardProvider>
                <GestureHandlerRootView style={{ flex: 1 }}>
                    <AuthProvider initialCredentials={initState.credentials}>
                        <ThemeProvider value={navigationTheme}>
                            <StatusBarProvider />
                            <ModalProvider>
                                <ToastProvider>
                                    <CommandPaletteProvider>
                                        <RealtimeProvider>
                                            <HorizontalSafeAreaWrapper>
                                                <SidebarNavigator />
                                            </HorizontalSafeAreaWrapper>
                                        </RealtimeProvider>
                                    </CommandPaletteProvider>
                                </ToastProvider>
                            </ModalProvider>
                        </ThemeProvider>
                    </AuthProvider>
                </GestureHandlerRootView>
            </KeyboardProvider>
        </SafeAreaProvider>
    );
    if (tracking) {
        providers = (
            <PostHogProvider client={tracking}>
                {providers}
            </PostHogProvider>
        );
    }

    return (
        <>
            <FaviconPermissionIndicator />
            {/* Notification tap handler - only on native (hook uses native methods unavailable on web) */}
            {Platform.OS !== 'web' && <NotificationResponseHandler isInitialized={!!initState} />}
            {providers}
        </>
    );
}
