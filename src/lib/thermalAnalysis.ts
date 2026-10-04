/**
 * 热成像数据解析与伪彩色映射工具
 *
 * 温度矩阵数据包格式：
 *   Byte 0-1: 宽度 (big-endian uint16)
 *   Byte 2-3: 高度 (big-endian uint16)
 *   Byte 4+:  温度值数组，每个值 2 字节 big-endian int16，单位 0.1℃
 *
 * 伪彩色方案 RGBA 映射：将温度归一化到 [0,1] 后映射到颜色
 */
import type { ThermalColormap, ThermalFrame, ThermalRegionStats } from './types';
import { genId } from './bleService';
import { ThermalAnalysis } from './thermalParser';

// ============ 数据解析 ============
import { THERMAL_WIDTH, THERMAL_HEIGHT, THERMAL_POINT_COUNT } from './types';

export function parseThermalFrame(bytes: number[]): ThermalFrame | null {
  if (bytes.length < 5) return null;
  const width  = (bytes[0] << 8) | bytes[1];
  const height = (bytes[2] << 8) | bytes[3];
  const expectedLen = 4 + width * height * 2;
  if (bytes.length < expectedLen || width === 0 || height === 0) return null;

  const tempData: number[] = [];
  for (let i = 0; i < width * height; i++) {
    const lo = bytes[4 + i * 2];
    const hi = bytes[4 + i * 2 + 1];
    // big-endian int16
    let raw = (lo << 8) | hi;
    if (raw > 0x7FFF) raw -= 0x10000; // 有符号
    tempData.push(raw); // 单位 0.1℃
  }

  // 单位转换为 ℃ (×0.1)
  const celsiusData = tempData.map(v => v / 10);

  let maxTemp = -Infinity;
  let minTemp = Infinity;
  let sumTemp = 0;
  let maxPos = { x: 0, y: 0 };
  let minPos = { x: 0, y: 0 };

  for (let i = 0; i < celsiusData.length; i++) {
    const v = celsiusData[i];
    sumTemp += v;
    if (v > maxTemp) {
      maxTemp = v;
      maxPos = { x: i % width, y: Math.floor(i / width) };
    }
    if (v < minTemp) {
      minTemp = v;
      minPos = { x: i % width, y: Math.floor(i / width) };
    }
  }
  const avgTemp = sumTemp / celsiusData.length;

  return {
    id: genId(),
    receivedAt: Date.now(),
    width,
    height,
    tempData: celsiusData,
    maxTemp: Math.round(maxTemp * 10) / 10,
    minTemp: Math.round(minTemp * 10) / 10,
    avgTemp: Math.round(avgTemp * 10) / 10,
    maxPos,
    minPos,
  };
}

// ============ 伪彩色映射 ============

type RGBA = [number, number, number, number];

/** 将归一化值 t∈[0,1] 映射为 RGBA */
function ironColor(t: number): RGBA {
  // 铁红色阶：黑->蓝->紫->红->橙->黄->白
  const stops: Array<[number, RGBA]> = [
    [0.00, [0,   0,   0,   255]],
    [0.20, [60,  0,   100, 255]],
    [0.40, [140, 0,   140, 255]],
    [0.55, [200, 30,  30,  255]],
    [0.70, [240, 100, 0,   255]],
    [0.85, [255, 200, 0,   255]],
    [1.00, [255, 255, 220, 255]],
  ];
  return interpolateColormap(stops, t);
}

function rainbowColor(t: number): RGBA {
  const stops: Array<[number, RGBA]> = [
    [0.00, [0,   0,   128, 255]],
    [0.15, [0,   0,   255, 255]],
    [0.35, [0,   255, 255, 255]],
    [0.50, [0,   255, 0,   255]],
    [0.65, [255, 255, 0,   255]],
    [0.85, [255, 100, 0,   255]],
    [1.00, [255, 0,   0,   255]],
  ];
  return interpolateColormap(stops, t);
}

function grayscaleColor(t: number): RGBA {
  const v = Math.round(t * 255);
  return [v, v, v, 255];
}

function plasmaColor(t: number): RGBA {
  const stops: Array<[number, RGBA]> = [
    [0.00, [13,  8,   135, 255]],
    [0.25, [126, 3,   168, 255]],
    [0.50, [204, 71,  120, 255]],
    [0.75, [248, 149, 64,  255]],
    [1.00, [240, 249, 33,  255]],
  ];
  return interpolateColormap(stops, t);
}

function interpolateColormap(stops: Array<[number, RGBA]>, t: number): RGBA {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    const [t0, c0] = stops[i - 1];
    const [t1, c1] = stops[i];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
        255,
      ];
    }
  }
  return stops[stops.length - 1][1];
}

export function getColormapFn(scheme: ThermalColormap): (t: number) => RGBA {
  switch (scheme) {
    case 'iron':      return ironColor;
    case 'rainbow':   return rainbowColor;
    case 'grayscale': return grayscaleColor;
    case 'plasma':    return plasmaColor;
  }
}

/** 将温度矩阵渲染为 RGBA 像素数组（Uint8ClampedArray 兼容格式） */
export function renderThermalPixels(
  frame: ThermalFrame,
  colormap: ThermalColormap
): Uint8Array {
  const { tempData, minTemp, maxTemp } = frame;
  const range = maxTemp - minTemp || 1;
  const colorFn = getColormapFn(colormap);
  const pixels = new Uint8Array(tempData.length * 4);
  for (let i = 0; i < tempData.length; i++) {
    const t = (tempData[i] - minTemp) / range;
    const [r, g, b, a] = colorFn(t);
    pixels[i * 4]     = r;
    pixels[i * 4 + 1] = g;
    pixels[i * 4 + 2] = b;
    pixels[i * 4 + 3] = a;
  }
  return pixels;
}

/** 将伪彩色图像 RGBA 数组编码为 Base64 BMP 格式（纯 JS，无需 Canvas） */
export function pixelsToDataUri(
  pixels: Uint8Array,
  width: number,
  height: number
): string {
  // 生成最小 BMP（24bpp，无压缩）
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const dataSize = rowSize * height;
  const fileSize = 54 + dataSize;
  const buf = new Uint8Array(fileSize);

  // BMP 文件头
  buf[0] = 0x42; buf[1] = 0x4D; // 'BM'
  writeUint32LE(buf, 2, fileSize);
  writeUint32LE(buf, 10, 54);     // 数据偏移

  // DIB 头 (BITMAPINFOHEADER)
  writeUint32LE(buf, 14, 40);     // 头大小
  writeInt32LE(buf, 18, width);
  writeInt32LE(buf, 22, -height); // 负值=从上到下
  buf[26] = 1; buf[27] = 0;       // 色平面
  buf[28] = 24; buf[29] = 0;      // 每像素位数
  writeUint32LE(buf, 34, dataSize);
  writeInt32LE(buf, 38, 2835);    // X像素/米
  writeInt32LE(buf, 42, 2835);

  // 像素数据（BGR 格式）
  let offset = 54;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      buf[offset++] = pixels[idx + 2]; // B
      buf[offset++] = pixels[idx + 1]; // G
      buf[offset++] = pixels[idx];     // R
    }
    // 行填充
    for (let p = 0; p < rowSize - width * 3; p++) buf[offset++] = 0;
  }

  return 'data:image/bmp;base64,' + uint8ArrayToBase64(buf);
}

/**
 * 在渲染后的像素图上画热点框和温度文字
 * 用一个简单方案：在热点中心画 3×3 的红框，旁边显示温度
 */
export function drawHotspotMarkers(
  pixels: Uint8Array,
  width: number,
  height: number,
  analysis: ThermalAnalysis,
  scale: number = 1
): Uint8Array {
  const out = new Uint8Array(pixels);
  
  const drawPixel = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const i = (y * width + x) * 4;
    out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255;
  };

  // 把原始坐标缩放
  const scaleCoord = (v: number) => Math.round(v * scale);

  // 画热点框（红色）
  for (const h of analysis.hotspots) {
    const x = scaleCoord(h.bbox.x);
    const y = scaleCoord(h.bbox.y);
    const w = scaleCoord(h.bbox.w);
    const hh = scaleCoord(h.bbox.h);
    // 上下边
    for (let i = x; i < x + w; i++) {
      drawPixel(i, y, 255, 0, 0);
      drawPixel(i, y + hh - 1, 255, 0, 0);
    }
    // 左右边
    for (let j = y; j < y + hh; j++) {
      drawPixel(x, j, 255, 0, 0);
      drawPixel(x + w - 1, j, 255, 0, 0);
    }
  }

  // 画冷点框（蓝色）
  for (const c of analysis.coldspots) {
    const x = scaleCoord(c.bbox.x);
    const y = scaleCoord(c.bbox.y);
    const w = scaleCoord(c.bbox.w);
    const hh = scaleCoord(c.bbox.h);
    for (let i = x; i < x + w; i++) {
      drawPixel(i, y, 0, 100, 255);
      drawPixel(i, y + hh - 1, 0, 100, 255);
    }
    for (let j = y; j < y + hh; j++) {
      drawPixel(x, j, 0, 100, 255);
      drawPixel(x + w - 1, j, 0, 100, 255);
    }
  }

  return out;
}


function writeUint32LE(buf: Uint8Array, offset: number, value: number) {
  buf[offset]     = value & 0xFF;
  buf[offset + 1] = (value >> 8)  & 0xFF;
  buf[offset + 2] = (value >> 16) & 0xFF;
  buf[offset + 3] = (value >> 24) & 0xFF;
}

function writeInt32LE(buf: Uint8Array, offset: number, value: number) {
  writeUint32LE(buf, offset, value >>> 0);
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ============ 区域温度统计 ============

export function calcRegionStats(
  frame: ThermalFrame,
  region: { x: number; y: number; w: number; h: number }
): ThermalRegionStats | null {
  const { x, y, w, h, } = region;
  if (w <= 0 || h <= 0) return null;
  const temps: number[] = [];
  for (let row = y; row < y + h && row < frame.height; row++) {
    for (let col = x; col < x + w && col < frame.width; col++) {
      temps.push(frame.tempData[row * frame.width + col]);
    }
  }
  if (temps.length === 0) return null;
  const maxTemp = Math.max(...temps);
  const minTemp = Math.min(...temps);
  const avgTemp = temps.reduce((s, v) => s + v, 0) / temps.length;
  return {
    maxTemp: Math.round(maxTemp * 10) / 10,
    minTemp: Math.round(minTemp * 10) / 10,
    avgTemp: Math.round(avgTemp * 10) / 10,
  };
}

/** 摄氏度转华氏度 */
export function toFahrenheit(c: number): number {
  return Math.round((c * 9 / 5 + 32) * 10) / 10;
}

export const MAX_THERMAL_HISTORY = 20;

export const COLORMAP_LABELS: Record<ThermalColormap, string> = {
  iron:      '铁红',
  rainbow:   '彩虹',
  grayscale: '灰度',
  plasma:    '等离子',
};


/**
 * 双线性插值渲染：把 32×24 温度矩阵放大到 (width*scale) × (height*scale)
 * @param frame     温度帧
 * @param colormap  色图
 * @param scale     放大倍数（2/3/4/6/8）
 */
// 高斯模糊：在 renderThermalPixelsBilinear 之前，先对 frame.tempData 做一次 3×3 均值
export function smoothTempData(tempData: number[], W: number, H: number): number[] {
  const out = new Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0, cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = y + dy, nx = x + dx;
          if (ny < 0 || ny >= H || nx < 0 || nx >= W) continue;
          sum += tempData[ny * W + nx];
          cnt++;
        }
      }
      out[y * W + x] = sum / cnt;
    }
  }
  return out;
}

export function renderThermalPixelsBilinear(
  frame: ThermalFrame,
  colormap: ThermalColormap,
  scale: number = 4
): { pixels: Uint8Array; width: number; height: number } {
  const W = frame.width;
  const H = frame.height;
  const outW = W * scale;
  const outH = H * scale;

  const { tempData, minTemp, maxTemp } = frame;
  const range = maxTemp - minTemp || 1;
  const colorFn = getColormapFn(colormap);
  const pixels = new Uint8Array(outW * outH * 4);

  for (let y = 0; y < outH; y++) {
    // 源坐标（浮点）
    const fy = (y + 0.5) / scale - 0.5;
    const y0 = Math.max(0, Math.min(H - 1, Math.floor(fy)));
    const y1 = Math.max(0, Math.min(H - 1, y0 + 1));
    const dy = Math.max(0, Math.min(1, fy - y0));

    for (let x = 0; x < outW; x++) {
      const fx = (x + 0.5) / scale - 0.5;
      const x0 = Math.max(0, Math.min(W - 1, Math.floor(fx)));
      const x1 = Math.max(0, Math.min(W - 1, x0 + 1));
      const dx = Math.max(0, Math.min(1, fx - x0));

      // 四邻域
      const v00 = tempData[y0 * W + x0];
      const v10 = tempData[y0 * W + x1];
      const v01 = tempData[y1 * W + x0];
      const v11 = tempData[y1 * W + x1];

      // 双线性插值
      const v = v00 * (1 - dx) * (1 - dy)
              + v10 * dx * (1 - dy)
              + v01 * (1 - dx) * dy
              + v11 * dx * dy;

      // 归一化 → 颜色
      const t = (v - minTemp) / range;
      const [r, g, b, a] = colorFn(t);

      const i = (y * outW + x) * 4;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = a ?? 255;
    }
  }

  return { pixels, width: outW, height: outH };
}
