const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// Monorepo root directory
const workspaceRoot = path.resolve(__dirname, "..");

// Watch the shared @happy packages for changes
config.watchFolders = [
    path.resolve(workspaceRoot, "packages/@happy/protocol"),
    path.resolve(workspaceRoot, "packages/@happy/errors"),
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
