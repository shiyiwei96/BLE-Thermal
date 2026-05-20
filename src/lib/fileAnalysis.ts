/**
 * 文件分析工具函数
 * - RGB/RAW 原始文件解析 → RGBA 像素数组
 * - JPG/PNG 图像文件读取
 * - 通道统计、亮度分析、对比度、质量评分
 * - 通道分离伪彩色渲染
 * - 像素值查询
 * - 像素数组 → PNG data URI（纯 JS BMP 编码）
 */

import type {
  ChannelStats,
  ChannelView,
  ImageAnalysisResult,
  ImportedFileType,
  RgbFileParams,
} from './types';
import { genId } from './bleService';

// ─── 导出辅助 ────────────────────────────────────────────────────────────────

export { genId };

// ─── 文件类型检测 ─────────────────────────────────────────────────────────────

export function detectFileType(fileName: string): ImportedFileType | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, ImportedFileType> = {
    rgb: 'rgb', raw: 'raw', jpg: 'jpg', jpeg: 'jpeg', png: 'png',
  };
  return map[ext] ?? null;
}

export function isRawType(t: ImportedFileType) {
  return t === 'rgb' || t === 'raw';
}

// ─── RGB/RAW 解析 → RGBA Uint8Array ──────────────────────────────────────────

/**
 * 将 ArrayBuffer 按 RgbFileParams 解析为 RGBA 平铺像素数组
 * 返回 [r0,g0,b0,a0, r1,g1,b1,a1, ...] 长度 = width*height*4
 */
export function parseRgbBuffer(
  buf: ArrayBuffer,
  params: RgbFileParams
): Uint8Array | null {
  const { width, height, channels, depth } = params;
  if (width <= 0 || height <= 0) return null;

  const bytesPerSample = depth === 'uint16' ? 2 : 1;
  const expectedBytes = width * height * channels * bytesPerSample;
  if (buf.byteLength < expectedBytes) return null;

  const view = new DataView(buf);
  const pixelCount = width * height;
  const rgba = new Uint8Array(pixelCount * 4);

  for (let i = 0; i < pixelCount; i++) {
    const base = i * channels * bytesPerSample;

    const readSample = (offset: number): number => {
      if (depth === 'uint16') {
        // big-endian uint16 → normalize to [0,255]
        const raw = view.getUint16(base + offset * 2, false);
        return Math.round(raw / 65535 * 255);
      }
      return view.getUint8(base + offset);
    };

    let r = 0, g = 0, b = 0, a = 255;
    if (channels === 1) {
      r = g = b = readSample(0);
    } else if (channels === 3) {
      r = readSample(0);
      g = readSample(1);
      b = readSample(2);
    } else if (channels === 4) {
      r = readSample(0);
      g = readSample(1);
      b = readSample(2);
      a = readSample(3);
    }

    rgba[i * 4]     = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = a;
  }
  return rgba;
}

// ─── 通道分离伪彩色 ───────────────────────────────────────────────────────────

/**
 * 从 RGBA 数组提取单通道伪彩色 RGBA 数组
 * ch=0 → 红色强度图; ch=1 → 绿色强度图; ch=2 → 蓝色强度图
 */
export function extractChannelRgba(
  rgba: Uint8Array,
  pixelCount: number,
  ch: 0 | 1 | 2
): Uint8Array {
  const out = new Uint8Array(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    const v = rgba[i * 4 + ch];
    out[i * 4]     = ch === 0 ? v : 0;
    out[i * 4 + 1] = ch === 1 ? v : 0;
    out[i * 4 + 2] = ch === 2 ? v : 0;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** 根据 ChannelView 返回最终渲染用的 RGBA 数组 */
export function getRgbaForView(
  rgba: Uint8Array,
  pixelCount: number,
  channelView: ChannelView
): Uint8Array {
  if (channelView === null) return rgba;
  return extractChannelRgba(rgba, pixelCount, channelView);
}

// ─── RGBA → BMP data URI（纯 JS，无 Canvas）──────────────────────────────────

function writeUint32LE(buf: Uint8Array, offset: number, val: number) {
  buf[offset]     = val & 0xFF;
  buf[offset + 1] = (val >> 8) & 0xFF;
  buf[offset + 2] = (val >> 16) & 0xFF;
  buf[offset + 3] = (val >> 24) & 0xFF;
}

function writeUint16LE(buf: Uint8Array, offset: number, val: number) {
  buf[offset]     = val & 0xFF;
  buf[offset + 1] = (val >> 8) & 0xFF;
}

/**
 * 将 RGBA 像素数组编码为 24-bpp BMP data URI
 * BMP 行从底部开始，需翻转
 */
export function rgbaToBmpDataUri(
  rgba: Uint8Array,
  width: number,
  height: number
): string {
  const rowBytes = Math.ceil((width * 3) / 4) * 4; // 4-byte aligned
  const dataSize = rowBytes * height;
  const fileSize = 54 + dataSize;
  const buf = new Uint8Array(fileSize);

  // ---- 文件头 (14 bytes) ----
  buf[0] = 0x42; buf[1] = 0x4D;         // 'BM'
  writeUint32LE(buf, 2, fileSize);
  writeUint32LE(buf, 6, 0);             // reserved
  writeUint32LE(buf, 10, 54);           // pixel data offset

  // ---- 信息头 DIB (40 bytes) ----
  writeUint32LE(buf, 14, 40);           // header size
  writeUint32LE(buf, 18, width);
  writeUint32LE(buf, 22, height);
  writeUint16LE(buf, 26, 1);            // color planes
  writeUint16LE(buf, 28, 24);           // bits per pixel
  writeUint32LE(buf, 30, 0);            // no compression
  writeUint32LE(buf, 34, dataSize);
  writeUint32LE(buf, 38, 2835);         // 72 DPI
  writeUint32LE(buf, 42, 2835);
  writeUint32LE(buf, 46, 0);
  writeUint32LE(buf, 50, 0);

  // ---- 像素数据（BMP 行从底部开始，BGR 顺序）----
  const pixOffset = 54;
  for (let row = 0; row < height; row++) {
    const bmpRow = height - 1 - row; // 翻转
    const rowStart = pixOffset + bmpRow * rowBytes;
    for (let col = 0; col < width; col++) {
      const i = row * width + col;
      buf[rowStart + col * 3]     = rgba[i * 4 + 2]; // B
      buf[rowStart + col * 3 + 1] = rgba[i * 4 + 1]; // G
      buf[rowStart + col * 3 + 2] = rgba[i * 4];     // R
    }
  }

  // ---- base64 ----
  const b64 = uint8ToBase64(buf);
  return `data:image/bmp;base64,${b64}`;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// ─── 图像分析 ─────────────────────────────────────────────────────────────────

/** 计算单通道直方图 + 统计 */
function computeChannelStats(values: number[]): ChannelStats {
  const histogram = new Array<number>(256).fill(0);
  let sum = 0;
  let min = 255;
  let max = 0;

  for (const v of values) {
    const clamped = Math.max(0, Math.min(255, Math.round(v)));
    histogram[clamped]++;
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const mean = sum / values.length;
  let varSum = 0;
  for (const v of values) {
    varSum += (v - mean) ** 2;
  }
  const variance = varSum / values.length;

  return {
    mean: Math.round(mean * 100) / 100,
    variance: Math.round(variance * 100) / 100,
    min: Math.round(min),
    max: Math.round(max),
    histogram,
  };
}

/**
 * 从 RGBA 像素数组计算完整分析结果
 * channels: 实际颜色通道数（1=灰度, 3=RGB, 4=RGBA — Alpha 不计入颜色分析）
 */
export function analyzeImage(
  rgba: Uint8Array,
  width: number,
  height: number,
  channels: number
): ImageAnalysisResult {
  const pixelCount = width * height;
  const colorChannels = Math.min(channels, 3); // 最多分析 R/G/B

  // 提取各通道数值
  const channelValues: number[][] = Array.from({ length: colorChannels }, () => []);
  const brightnessValues: number[] = [];
  let overCount = 0;
  let underCount = 0;
  const brightnessHist = new Array<number>(256).fill(0);

  for (let i = 0; i < pixelCount; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];

    if (colorChannels >= 1) channelValues[0].push(r);
    if (colorChannels >= 2) channelValues[1].push(g);
    if (colorChannels >= 3) channelValues[2].push(b);

    // 亮度 (ITU-R BT.601)
    const luma = channels === 1
      ? r
      : 0.299 * r + 0.587 * g + 0.114 * b;
    brightnessValues.push(luma);
    const lumaIdx = Math.max(0, Math.min(255, Math.round(luma)));
    brightnessHist[lumaIdx]++;
    if (luma > 250) overCount++;
    if (luma < 5)   underCount++;
  }

  const channelStats = channelValues.map(v => computeChannelStats(v));

  // 亮度统计
  const lumaSum = brightnessValues.reduce((a, b) => a + b, 0);
  const lumaMean = lumaSum / pixelCount;

  // RMS 对比度（基于亮度标准差 / 255）
  let lumaVarSum = 0;
  for (const l of brightnessValues) lumaVarSum += (l - lumaMean) ** 2;
  const lumaStd = Math.sqrt(lumaVarSum / pixelCount);
  const rmsContrast = Math.round(lumaStd / 255 * 1000) / 1000;

  // 质量评分 [0,100]
  //  - 亮度居中得分（理想 lumaMean ≈ 128）
  const brightScore = 100 - Math.abs(lumaMean - 128) / 128 * 50;
  //  - 对比度得分（rmsContrast 0.1~0.4 为佳）
  const contrastScore = Math.min(100, (rmsContrast / 0.35) * 100);
  //  - 过曝/欠曝惩罚
  const overRatio = overCount / pixelCount;
  const underRatio = underCount / pixelCount;
  const exposurePenalty = (overRatio + underRatio) * 100;
  const qualityScore = Math.max(
    0,
    Math.min(100, Math.round(brightScore * 0.4 + contrastScore * 0.4 - exposurePenalty * 0.2))
  );

  return {
    width,
    height,
    channels: colorChannels,
    channelStats,
    brightnessStats: {
      mean: Math.round(lumaMean * 100) / 100,
      overexposedRatio: Math.round(overRatio * 10000) / 10000,
      underexposedRatio: Math.round(underRatio * 10000) / 10000,
      histogram: brightnessHist,
    },
    rmsContrast,
    qualityScore,
  };
}

// ─── 像素查询 ─────────────────────────────────────────────────────────────────

export interface PixelInfo {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

export function getPixel(
  rgba: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number
): PixelInfo | null {
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  const i = y * width + x;
  return {
    x, y,
    r: rgba[i * 4],
    g: rgba[i * 4 + 1],
    b: rgba[i * 4 + 2],
    a: rgba[i * 4 + 3],
  };
}

// ─── 文件大小格式化 ───────────────────────────────────────────────────────────

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// ─── 通道标签 ─────────────────────────────────────────────────────────────────

export const CHANNEL_LABELS: Record<number, string[]> = {
  1: ['灰度'],
  3: ['R 通道', 'G 通道', 'B 通道'],
  4: ['R 通道', 'G 通道', 'B 通道'],
};

export const CHANNEL_COLORS = ['#FF3366', '#00E676', '#00E5FF'];
