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

module.exports = config;
