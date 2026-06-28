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

// 3. Force a SINGLE copy of React/React-DOM. @clerk/clerk-expo's dependency tree
// hoists a newer react (19.2.x) at the repo root, while the frontend pins the
// Expo SDK 54 version (19.1.0). Root-hoisted packages would otherwise resolve
// `react` relative to themselves and load the duplicate, producing two React
// instances and a "Cannot read property 'useState' of null" crash on device.
// Pin every react / react-dom import to the app's copy.
const singletons = ["react", "react-dom"];
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isSingleton = singletons.some(
    (name) => moduleName === name || moduleName.startsWith(`${name}/`),
  );
  if (isSingleton) {
    return {
      type: "sourceFile",
      filePath: require.resolve(moduleName, { paths: [projectRoot] }),
    };
  }
  return (defaultResolveRequest ?? context.resolveRequest)(
    context,
    moduleName,
    platform,
  );
};

module.exports = config;
