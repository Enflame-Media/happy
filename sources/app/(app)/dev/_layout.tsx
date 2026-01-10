/**
 * Dev Routes Layout - HAP-843
 *
 * This layout guards all dev routes to ensure they are only accessible in development mode.
 * In production builds:
 * - Users cannot navigate to /dev/* routes
 * - If they try to access via direct URL, they are redirected to home
 *
 * The __DEV__ constant is evaluated at build time by Metro bundler:
 * - In development: __DEV__ === true, routes render normally
 * - In production: __DEV__ === false, redirect occurs
 */
import { Redirect, Stack } from 'expo-router';
import * as React from 'react';
import { Typography } from '@/constants/Typography';
import { createHeader } from '@/components/navigation/Header';
import { Platform } from 'react-native';
import { isRunningOnMac } from '@/utils/platform';
import { useUnistyles } from 'react-native-unistyles';

export default function DevLayout() {
    // Guard: Only allow dev routes in development mode
    // In production, redirect to home screen
    if (!__DEV__) {
        return <Redirect href="/" />;
    }

    // Use custom header on Android and Mac Catalyst, native header on iOS (non-Catalyst)
    const shouldUseCustomHeader = Platform.OS === 'android' || isRunningOnMac() || Platform.OS === 'web';
    const { theme } = useUnistyles();

    return (
        <Stack
            screenOptions={{
                header: shouldUseCustomHeader ? createHeader : undefined,
                headerShadowVisible: false,
                contentStyle: {
                    backgroundColor: theme.colors.surface,
                },
                headerStyle: {
                    backgroundColor: theme.colors.header.background,
                },
                headerTintColor: theme.colors.header.tint,
                headerTitleStyle: {
                    color: theme.colors.header.tint,
                    ...Typography.default('semiBold'),
                },
            }}
        >
            <Stack.Screen
                name="index"
                options={{
                    headerTitle: 'Developer Tools',
                }}
            />
            <Stack.Screen
                name="list-demo"
                options={{
                    headerTitle: 'List Components Demo',
                }}
            />
            <Stack.Screen
                name="typography"
                options={{
                    headerTitle: 'Typography',
                }}
            />
            <Stack.Screen
                name="colors"
                options={{
                    headerTitle: 'Colors',
                }}
            />
            <Stack.Screen
                name="tools2"
                options={{
                    headerTitle: 'Tool Views Demo',
                }}
            />
            <Stack.Screen
                name="masked-progress"
                options={{
                    headerTitle: 'Masked Progress',
                }}
            />
            <Stack.Screen
                name="shimmer-demo"
                options={{
                    headerTitle: 'Shimmer View Demo',
                }}
            />
            <Stack.Screen
                name="multi-text-input"
                options={{
                    headerTitle: 'Multi Text Input',
                }}
            />
            <Stack.Screen
                name="device-info"
                options={{
                    headerTitle: 'Device Info',
                }}
            />
            <Stack.Screen
                name="messages-demo"
                options={{
                    headerTitle: 'Message Demos',
                }}
            />
            <Stack.Screen
                name="inverted-list"
                options={{
                    headerTitle: 'Inverted List Test',
                }}
            />
            <Stack.Screen
                name="modal-demo"
                options={{
                    headerTitle: 'Modal System',
                }}
            />
            <Stack.Screen
                name="tests"
                options={{
                    headerTitle: 'Unit Tests',
                }}
            />
            <Stack.Screen
                name="unistyles-demo"
                options={{
                    headerTitle: 'Unistyles Demo',
                }}
            />
            <Stack.Screen
                name="qr-test"
                options={{
                    headerTitle: 'QR Code Test',
                }}
            />
            <Stack.Screen
                name="todo-demo"
                options={{
                    headerTitle: 'Todo Demo',
                }}
            />
            <Stack.Screen
                name="logs"
                options={{
                    headerTitle: 'Logs',
                }}
            />
            <Stack.Screen
                name="purchases"
                options={{
                    headerTitle: 'Purchases',
                }}
            />
            <Stack.Screen
                name="expo-constants"
                options={{
                    headerTitle: 'Expo Constants',
                }}
            />
            <Stack.Screen
                name="input-styles"
                options={{
                    headerTitle: 'Input Styles',
                }}
            />
        </Stack>
    );
}
