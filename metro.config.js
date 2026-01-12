const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// HAP-850: Exclude test fixtures from production bundles
// This prevents __testdata__ directories from being bundled into the app,
// reducing bundle size and avoiding leaking internal test artifacts.
// HAP-844: Also exclude sources/trash which contains dev-only demo data
config.resolver.blockList = [
    /__testdata__\//,
    /sources\/trash\//,
];


// Monorepo root directory (apps/web/react -> apps/web -> apps -> root)
const workspaceRoot = path.resolve(__dirname, "../../..");

// Watch the shared @happy packages for changes
config.watchFolders = [
    path.resolve(workspaceRoot, "packages/schema/protocol"),
    path.resolve(workspaceRoot, "packages/schema/errors"),
];

// Ensure Metro can resolve modules from the monorepo root
config.resolver.nodeModulesPaths = [
    path.resolve(__dirname, "node_modules"),
    path.resolve(workspaceRoot, "node_modules"),
];

// Ensure Expo-specific module resolution still works
config.resolver.disableHierarchicalLookup = false;

// Fix libsodium-wrappers ESM resolution issue on web
// The ESM distribution imports ./libsodium.mjs which doesn't exist in libsodium v0.7.15
// Force the CommonJS version by intercepting all libsodium-wrappers resolutions
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
    // Intercept libsodium-wrappers on web platform and redirect to CommonJS
    if (platform === 'web' && moduleName === 'libsodium-wrappers') {
        // Return the CommonJS version path directly
        const cjsPath = require.resolve('libsodium-wrappers', {
            paths: [context.originModulePath || __dirname],
        });
        // The require.resolve uses package.json "main" field which points to CJS
        // But we need to ensure Metro doesn't then try to resolve its internal imports as ESM
        return context.resolveRequest(context, cjsPath, platform);
    }
    // Use original resolver for everything else
    if (originalResolveRequest) {
        return originalResolveRequest(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
