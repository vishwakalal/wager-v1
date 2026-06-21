// Metro config for using Expo inside an npm-workspaces monorepo.
// Without this, Metro only looks in frontend/node_modules and can't see
// dependencies hoisted to the repo root, nor watch packages/shared for changes.
// Reference: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

// 1. Watch all files in the monorepo (so edits to @wager/shared hot-reload here).
config.watchFolders = [workspaceRoot];

// 2. Resolve modules from this app first, then from the hoisted root node_modules.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

module.exports = config;
