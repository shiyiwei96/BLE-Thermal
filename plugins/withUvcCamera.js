const { withAndroidManifest, withProjectBuildGradle, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');


// ---- 1. 修改 AndroidManifest.xml ----
function withUvcManifest(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const application = manifest.manifest.application?.[0];
    if (!application) return config;

    // 添加 uses-feature
    const features = manifest.manifest['uses-feature'] || [];
    if (!features.some(f => f.$?.['android:name'] === 'android.hardware.usb.host')) {
      features.push({
        $: {
          'android:name': 'android.hardware.usb.host',
          'android:required': 'false',
        },
      });
      manifest.manifest['uses-feature'] = features;
    }

    // 找到 MainActivity
    const activity = application.activity?.find(
      a => a.$?.['android:name'] === '.MainActivity'
    );
    if (activity) {
      // 添加 USB intent-filter
      activity['intent-filter'] = activity['intent-filter'] || [];
      activity['intent-filter'].push({
        action: [{ $: { 'android:name': 'android.hardware.usb.action.USB_DEVICE_ATTACHED' } }],
      });
      // 添加 meta-data
      activity['meta-data'] = activity['meta-data'] || [];
      activity['meta-data'].push({
        $: {
          'android:name': 'android.hardware.usb.action.USB_DEVICE_ATTACHED',
          'android:resource': '@xml/device_filter',
        },
      });
    }

    return config;
  });
}

// ---- 2. 创建 device_filter.xml ----
function withDeviceFilter(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const xmlDir = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(xmlDir, { recursive: true });
      const filePath = path.join(xmlDir, 'device_filter.xml');
      fs.writeFileSync(filePath, `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <usb-device class="14" />
</resources>
`);
      return config;
    },
  ]);
}

// ---- 3. 修改 android/build.gradle（加 libcommon 仓库）----
function withLibcommonRepo(config) {
  return withProjectBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') return config;
    let contents = config.modResults.contents;

    if (!contents.includes('saki4510t/libcommon')) {
      // 在 allprojects.repositories 里插入 maven 仓库
      contents = contents.replace(
        /(allprojects\s*\{\s*repositories\s*\{)/,
        `$1
        maven { url 'https://raw.githubusercontent.com/saki4510t/libcommon/master/repository'; allowInsecureProtocol = true }`
      );
    }
    config.modResults.contents = contents;
    return config;
  });
}

// ---- 4. 修改 android/settings.gradle（include libuvccamera）----
function withUvcSettingsGradle(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const settingsPath = path.join(config.modRequest.platformProjectRoot, 'settings.gradle');
      let contents = fs.readFileSync(settingsPath, 'utf-8');

      if (!contents.includes(':libuvccamera')) {
        contents += `
include ':usbCameraCommon'
project(':usbCameraCommon').projectDir = new File(rootProject.projectDir, '../node_modules/react-native-uvc-camera/usbCameraCommon')

include ':libuvccamera'
project(':libuvccamera').projectDir = new File(rootProject.projectDir, '../node_modules/react-native-uvc-camera/libuvccamera')
`;
        fs.writeFileSync(settingsPath, contents);
      }
      return config;
    },
  ]);
}


// ---- 5. 下载 NDK r14b 到项目内 + 写 local.properties ----
function withLocalProperties(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.platformProjectRoot;
      const ndkBaseDir = path.join(projectRoot, 'ndk');
      const ndkDir = path.join(ndkBaseDir, 'android-ndk-r14b');
      const zipPath = path.join(ndkBaseDir, 'ndk-r14b.zip');

      if (!fs.existsSync(ndkDir)) {
        fs.mkdirSync(ndkBaseDir, { recursive: true });
        const mirrors = [
          'http://mirrors.flysnow.org/android/ndk/android-ndk-r14b-linux-x86_64.zip',
          'http://mirrors.neusoft.edu.cn/android/repository/android-ndk-r14b-linux-x86_64.zip',
          'https://dl.google.com/android/repository/android-ndk-r14b-linux-x86_64.zip',
        ];
        let ok = false;
        for (const url of mirrors) {
          try {
            execSync(`curl -L --connect-timeout 30 --max-time 600 -o "${zipPath}" "${url}"`, { stdio: 'inherit' });
            ok = true; break;
          } catch (e) { console.warn(`镜像失败: ${e.message}`); }
        }
        if (!ok) throw new Error('NDK r14b 下载失败');
        execSync(`unzip -q "${zipPath}" -d "${ndkBaseDir}"`, { stdio: 'inherit' });
        fs.unlinkSync(zipPath);
      }

      // 动态获取 SDK 路径（从环境变量）
      const sdkDir = process.env.ANDROID_HOME
        || process.env.ANDROID_SDK_ROOT
        || '/opt/android/sdk';

      fs.writeFileSync(
        path.join(projectRoot, 'local.properties'),
        `sdk.dir=${sdkDir}\n`
      );
      console.log(`[withUvcCamera] local.properties sdk.dir=${sdkDir}, ndk=${ndkDir}`);

      return config;
    },
  ]);
}



// ---- 6. 为 libuvccamera 指定 ndkPath ----
function withLibuvccameraNdkVersion(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const gradlePath = path.join(
        config.modRequest.projectRoot,
        'node_modules/react-native-uvc-camera/libuvccamera/build.gradle'
      );
      if (!fs.existsSync(gradlePath)) {
        console.log('[withUvcCamera] 未找到 libuvccamera/build.gradle');
        return config;
      }

      let contents = fs.readFileSync(gradlePath, 'utf-8');
      const ndkPath = '/home/expo/workingdir/build/android/ndk/android-ndk-r14b';

      // (1) 设置 ndkPath 属性
      if (!contents.includes('ndkPath')) {
        contents = contents.replace(
          /(android\s*\{)/,
          `$1\n    ndkPath "${ndkPath}"\n`
        );
      }

      // (2) 强制覆盖 ndkBuildingDir 的定义
      // 匹配：def ndkBuildingDir = ...（直到行尾）
      contents = contents.replace(
        /def\s+ndkBuildingDir\s*=\s*[^\n]+/g,
        `def ndkBuildingDir = "${ndkPath}"`
      );

      // (3) 兜底：任何引用 android.ndkDirectory 的地方
      contents = contents.replace(/project\.android\.ndkDirectory/g, `"${ndkPath}"`);
      contents = contents.replace(/android\.ndkDirectory/g, `"${ndkPath}"`);

      fs.writeFileSync(gradlePath, contents);
      console.log(`[withUvcCamera] 已修复 libuvccamera ndk-building 路径: ${ndkPath}`);
      return config;
    },
  ]);
}



module.exports = function withUvcCamera(config) {
  config = withUvcManifest(config);
  config = withDeviceFilter(config);
  config = withLibcommonRepo(config);
  config = withUvcSettingsGradle(config);
  config = withLocalProperties(config);
  config = withLibuvccameraNdkVersion(config);
  return config;
};
