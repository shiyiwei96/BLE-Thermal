const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// 加 tflite 到 assetExts（Expo 新版 assetExts 是 Set）
if (config.resolver.assetExts instanceof Set) {
  config.resolver.assetExts.add('tflite');
} else {
  config.resolver.assetExts.push('tflite');
}

module.exports = config;