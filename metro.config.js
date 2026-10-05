const { getDefaultConfig } = require('expo/metro-config');
const { withDevkit } = require('miaoda-expo-devkit/metro');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('tflite');

module.exports = withDevkit(config);
