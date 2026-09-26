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


// ---- 5. 创建 local.properties（含 NDK r14b 自动下载）----
function withLocalProperties(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.platformProjectRoot;
      const sdkNdkDir = '/opt/android/sdk/ndk';
      const targetNdkDir = path.join(sdkNdkDir, '14.1.3816874');

      // ---- 下载并解压 NDK r14b 到 SDK 的 ndk 目录 ----
      if (!fs.existsSync(targetNdkDir)) {
        fs.mkdirSync(sdkNdkDir, { recursive: true });
        const zipPath = path.join(projectRoot, 'ndk-r14b.zip');
        const mirrors = [
          'http://mirrors.flysnow.org/android/ndk/android-ndk-r14b-linux-x86_64.zip',
          'http://mirrors.neusoft.edu.cn/android/repository/android-ndk-r14b-linux-x86_64.zip',
        ];
        let ok = false;
        for (const url of mirrors) {
          try {
            execSync(`curl -L --connect-timeout 30 --max-time 600 -o "${zipPath}" "${url}"`, { stdio: 'inherit' });
            ok = true; break;
          } catch (e) { console.warn(`下载失败: ${e.message}`); }
        }
        if (!ok) throw new Error('NDK r14b 下载失败');
        execSync(`unzip -q "${zipPath}" -d "${sdkNdkDir}"`, { stdio: 'inherit' });
        fs.renameSync(path.join(sdkNdkDir, 'android-ndk-r14b'), targetNdkDir);
        fs.unlinkSync(zipPath);
      }

      // ---- 写 local.properties（只写 sdk.dir）----
      fs.writeFileSync(
        path.join(projectRoot, 'local.properties'),
        `sdk.dir=/opt/android/sdk\n`
      );
      console.log('[withUvcCamera] NDK 已就位，local.properties 已生成');

      return config;
    },
  ]);
}



// ---- 6. 为 libuvccamera 单独指定 NDK 版本 ----
function withLibuvccameraNdkVersion(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const gradlePath = path.join(
        config.modRequest.projectRoot,
        'node_modules/react-native-uvc-camera/libuvccamera/build.gradle'
      );

      // 文件不存在就跳过（可能未安装该库）
      if (!fs.existsSync(gradlePath)) {
        console.log('[withUvcCamera] 未找到 libuvccamera/build.gradle，跳过');
        return config;
      }

      let contents = fs.readFileSync(gradlePath, 'utf-8');

      // 已设置过就不重复插入
      if (contents.includes('ndkVersion')) {
        console.log('[withUvcCamera] libuvccamera 已设置 ndkVersion，跳过');
        return config;
      }

      // 在第一个 android { 块内插入 ndkVersion
      const ndkVersion = '14.1.3816874'; // NDK r14b 的版本号
      const insertRegex = /(android\s*\{)/;
      if (insertRegex.test(contents)) {
        contents = contents.replace(
          insertRegex,
          `$1\n    ndkVersion "${ndkVersion}"\n`
        );
        fs.writeFileSync(gradlePath, contents);
        console.log(`[withUvcCamera] 已为 libuvccamera 设置 ndkVersion ${ndkVersion}`);
      } else {
        console.warn('[withUvcCamera] 未在 build.gradle 中找到 android { 块');
      }

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
