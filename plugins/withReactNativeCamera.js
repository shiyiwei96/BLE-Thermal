const { withAppBuildGradle } = require('@expo/config-plugins');

module.exports = function withReactNativeCamera(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      let contents = config.modResults.contents;
      // 避免重复添加
      if (!contents.includes("missingDimensionStrategy 'react-native-camera'")) {
        contents = contents.replace(
          /defaultConfig\s*\{/,
          `defaultConfig {\n        missingDimensionStrategy 'react-native-camera', 'general'`
        );
        config.modResults.contents = contents;
      }
    }
    return config;
  });
};