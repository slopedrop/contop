// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Exclude test files from the bundle so Expo Router's require.context
// does not pick up *.test.tsx / *.test.ts files inside app/ as routes.
config.resolver.blockList = [
  ...(config.resolver.blockList ? [config.resolver.blockList].flat() : []),
  /.*\.test\.[jt]sx?$/,
  /.*__tests__\/.*/,
  /.*__mocks__\/.*/,
];

// Disable package exports resolution to fix react-native-webrtc's
// event-target-shim import (imports "./index" which isn't in "exports" map).
config.resolver.unstable_enablePackageExports = false;

// Fix anthropic-react-native broken "main" field (points to dist/src/index.js
// but actual entry is dist/index.js).
const path = require("path");
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "anthropic-react-native") {
    return {
      filePath: path.resolve(
        __dirname,
        "node_modules/anthropic-react-native/dist/index.js"
      ),
      type: "sourceFile",
    };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: "./global.css" });
