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

      // ============ 1. 下载并解压 NDK r14b ============
      const ndkVersion = 'android-ndk-r14b';
      const ndkBaseDir = path.join(projectRoot, 'ndk');
      const ndkDir = path.join(ndkBaseDir, ndkVersion);
      const ndkZip = path.join(ndkBaseDir, `${ndkVersion}.zip`);

      if (!fs.existsSync(ndkDir)) {
        fs.mkdirSync(ndkBaseDir, { recursive: true });

        // 国内镜像优先，失败则回退到官方
        const mirrors = [
          'http://mirrors.flysnow.org/android/ndk/android-ndk-r14b-linux-x86_64.zip',
          'http://mirrors.neusoft.edu.cn/android/repository/android-ndk-r14b-linux-x86_64.zip',
          'https://dl.google.com/android/repository/android-ndk-r14b-linux-x86_64.zip',
        ];

        let downloaded = false;
        for (const url of mirrors) {
          try {
            console.log(`[withUvcCamera] 尝试下载 NDK: ${url}`);
            execSync(`curl -L --connect-timeout 30 --max-time 600 -o "${ndkZip}" "${url}"`, {
              stdio: 'inherit',
            });
            downloaded = true;
            break;
          } catch (e) {
            console.warn(`[withUvcCamera] 下载失败，尝试下一个镜像: ${e.message}`);
          }
        }

        if (!downloaded) {
          throw new Error('[withUvcCamera] 所有镜像下载 NDK r14b 均失败');
        }

        console.log('[withUvcCamera] 正在解压 NDK r14b...');
        execSync(`unzip -q "${ndkZip}" -d "${ndkBaseDir}"`, { stdio: 'inherit' });
        fs.unlinkSync(ndkZip);
        console.log(`[withUvcCamera] NDK 解压完成: ${ndkDir}`);
      } else {
        console.log(`[withUvcCamera] NDK 已存在，跳过下载: ${ndkDir}`);
      }

      // ============ 2. 写 local.properties ============
      const localPropertiesPath = path.join(projectRoot, 'local.properties');
      const contents = `sdk.dir=/opt/android/sdk
ndk.dir=${ndkDir}
uvccamera.ndk.dir=${ndkDir}
`;
      fs.writeFileSync(localPropertiesPath, contents);
      console.log(`[withUvcCamera] 已生成 local.properties: ndk.dir=${ndkDir}`);

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
  return config;
};
