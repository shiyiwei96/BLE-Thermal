
// 用于解码 PNG 的库，需要在项目里安装：npm install upng-js
// @ts-ignore
import { decode } from 'upng-js';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';


async function toDataUri(uri:string): Promise<string> {
  if (uri.startsWith('data:')) return uri;
  if (uri.startsWith('ph://') || uri.startsWith('assets-library://')) return uri; // 相册 URI 可能走不同路径，可先保留

  if (uri.startsWith('file://') || uri.startsWith('/')) {
    const filePath = uri.startsWith('file://') ? uri.slice(7) : uri;
    const file = new File(filePath);
    const base64 = await file.base64();
    
    // 根据你的图片实际格式调整 mime，默认用 jpeg
    const ext = uri.toLowerCase().split('.').pop();
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
    return `data:${mime};base64,${base64}`;
  }
  return uri;
}

/**
 * 把图片文件解码成 RGBA 像素数组
 * @param uri 图片路径 (本地 file:// 或 data:image)
 * @param maxSize 缩放后的最大宽度
 */

export async function decodeImageToPixels(uri: string, maxSize = 128): Promise<{
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}> {
  
  // 1. 先把 file:// 转成 data:，避免 SDK 55 ImageLoader 报错
  const safeUri = await toDataUri(uri);

  // 2. 使用新版链式 API 进行缩放和转换
  const context = ImageManipulator.manipulate(safeUri);
  context.resize({ width: maxSize }); // 设置缩放

  const imageRef = await context.renderAsync();
  
  const result = await imageRef.saveAsync({
    format: SaveFormat.PNG, // 直接使用独立的 SaveFormat
    base64: true,           // 依然保留获取 base64 的需求
  });

  if (!result.base64) {
    throw new Error('图片转换失败，未获取到 base64');
  }

  // ---- 以下逻辑与你原来保持一致 ----

  // 3. 将 base64 转成 ArrayBuffer
  const binary = atob(result.base64);
  const len = binary.length;
  const buffer = new ArrayBuffer(len);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < len; i++) {
    view[i] = binary.charCodeAt(i);
  }

  // 4. 用 upng-js 把 PNG 解析成 RGBA 原始像素
  const decoded = decode(buffer);
  if (!decoded) throw new Error('PNG 像素解析失败');

  const rgbaPixels = new Uint8ClampedArray(decoded.data);

  return {
    pixels: rgbaPixels,
    width: decoded.width,
    height: decoded.height,
  };
}
