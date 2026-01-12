import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
    // Define globals that React Native/Expo expect
    define: {
        __DEV__: 'true',
    },
    test: {
        globals: false,
        environment: 'node',
        include: ['sources/**/*.{spec,test}.ts'],
        setupFiles: ['./vitest.setup.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            exclude: [
                'node_modules/**',
                'dist/**',
                '**/*.d.ts',
                '**/*.config.*',
                '**/mockData/**',
                '**/__testdata__/**',
                '**/*.spec.ts',
                '**/*.test.ts',
            ],
            thresholds: {
                lines: 60,
                functions: 60,
                branches: 50,
            },
        },
    },
    resolve: {
        alias: {
            '@': resolve('./sources'),
            // Mock React Native and Expo modules that use Flow syntax
            // which Rollup cannot parse (e.g., `import typeof * as`)
            'react-native': resolve('./__mocks__/react-native.ts'),
            'expo-secure-store': resolve('./__mocks__/expo-secure-store.ts'),
            'expo-updates': resolve('./__mocks__/expo-updates.ts'),
            'expo-modules-core': resolve('./__mocks__/expo-modules-core.ts'),
            'expo-crypto': resolve('./__mocks__/expo-crypto.ts'),
        },
    },
})