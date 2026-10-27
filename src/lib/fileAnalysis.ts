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
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { decodeImageToPixels } from './imageDecode'; // 你之前解 JPG/PNG 的代码
import rawSvcData from '@/assets/models/svc_weights.json'; 

async function toDataUri(uri: string): Promise<string> {
  if (uri.startsWith('data:')) return uri;
  if (uri.startsWith('ph://') || uri.startsWith('assets-library://')) return uri;
  if (uri.startsWith('file://') || uri.startsWith('/')) {
    const filePath = uri.startsWith('file://') ? uri.slice(7) : uri;
    const file = new File(filePath);
    const base64 = await file.base64();
    const ext = uri.toLowerCase().split('.').pop();
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
    return `data:${mime};base64,${base64}`;
  }
  return uri;
}

// 将 JSON 断言为 any，避免 TS 类型推断报错
const svcData = rawSvcData as any;

// ─── 纯 JS HOG 提取器 ────────────────────────────────────────────────────────
/**
 * 从 64x64 的灰度图中提取 HOG 特征 (1764 维)
 * 对齐 Python 的 skimage.hog 默认参数：
 * orientations=9, pixels_per_cell=8x8, cells_per_block=2x2
 */
export function extractHOG(grayPixels: number[]): number[] {
  const width = 64;
  const height = 64;
  
  // 1. 计算梯度大小和方向
  const mag = new Float32Array(width * height);
  const angle = new Float32Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      // Sobel 算子计算梯度
      const gx = 
        -1 * grayPixels[(y - 1) * width + (x - 1)] + 1 * grayPixels[(y - 1) * width + (x + 1)] +
        -2 * grayPixels[y * width + (x - 1)] + 2 * grayPixels[y * width + (x + 1)] +
        -1 * grayPixels[(y + 1) * width + (x - 1)] + 1 * grayPixels[(y + 1) * width + (x + 1)];
      const gy = 
        -1 * grayPixels[(y - 1) * width + (x - 1)] - 2 * grayPixels[(y - 1) * width + x] - 1 * grayPixels[(y - 1) * width + (x + 1)] +
         1 * grayPixels[(y + 1) * width + (x - 1)] + 2 * grayPixels[(y + 1) * width + x] + 1 * grayPixels[(y + 1) * width + (x + 1)];

      mag[idx] = Math.sqrt(gx * gx + gy * gy);
      let ang = Math.atan2(gy, gx) * (180 / Math.PI);
      if (ang < 0) ang += 180; // 限制在 0-180 度
      angle[idx] = ang;
    }
  }

  // 2. 划分 Cell (8x8) 并统计方向直方图
  const cellSize = 8;
  const cellsX = width / cellSize; // 8
  const cellsY = height / cellSize; // 8
  const bins = 9;
  const cellHist = new Float32Array(cellsX * cellsY * bins);

  for (let cy = 0; cy < cellsY; cy++) {
    for (let cx = 0; cx < cellsX; cx++) {
      const histOffset = (cy * cellsX + cx) * bins;
      for (let y = 0; y < cellSize; y++) {
        for (let x = 0; x < cellSize; x++) {
          const px = cx * cellSize + x;
          const py = cy * cellSize + y;
          const idx = py * width + px;
          
          const m = mag[idx];
          const a = angle[idx];
          const binIdx = Math.floor(a / 20) % bins; // 180 / 9 = 20度一个 bin
          cellHist[histOffset + binIdx] += m;
        }
      }
    }
  }

  // 3. Block 归一化 (2x2 cells 为一个 block)
  const blockSize = 2;
  const blocksX = cellsX - blockSize + 1; // 7
  const blocksY = cellsY - blockSize + 1; // 7
  const hogFeatures: number[] = [];

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const blockHist: number[] = [];
      // 收集 2x2 的 cell 直方图
      for (let y = 0; y < blockSize; y++) {
        for (let x = 0; x < blockSize; x++) {
          const cx = bx + x;
          const cy = by + y;
          const offset = (cy * cellsX + cx) * bins;
          for (let i = 0; i < bins; i++) {
            blockHist.push(cellHist[offset + i]);
          }
        }
      }
      
      // L2-Hys 归一化 (简化版 L2 归一化)
      let sumSq = 0;
      for (const val of blockHist) sumSq += val * val;
      const normFactor = Math.sqrt(sumSq + 1e-6);
      
      for (const val of blockHist) {
        hogFeatures.push(val / normFactor);
      }
    }
  }

  // 结果应该是 7 * 7 * 2 * 2 * 9 = 1764 维
  return hogFeatures;
}


// ─── 纯 JS SVC 推理引擎 (带 RBF 核支持) ───────────────────────────────────────
function predictSVC(inputFeatures: number[]): { label: string, confidence: number } {
    const { scaler_mean, scaler_scale, svc_support_vectors, svc_dual_coef, svc_intercept, classes } = svcData;

    // 1. 数据标准化 (StandardScaler)
    const scaledInput = inputFeatures.map((v, i) => (v - scaler_mean[i]) / scaler_scale[i]);

    // 2. 计算核函数 (假设是用 RBF 核训练，如果是线性核请把下面的 RBF 循环替换为直接点积)
    // 注意：sklearn 的 RBF 默认 gamma = 1 / (n_features * X.var())，如果导出时没保存 gamma，
    // 通常默认值是 1 / 1764 ≈ 0.000566。如果你的准确率极低，可以尝试调整这个值。
    const gamma = 1 / 1764; 
    
    const numClasses = classes.length;
    const decisionValues = new Array(numClasses).fill(0);

    for (let i = 0; i < svc_support_vectors.length; i++) {
        const sv = svc_support_vectors[i];
        
        // 计算欧式距离平方
        let distSq = 0;
        for (let j = 0; j < scaledInput.length; j++) {
            distSq += Math.pow(scaledInput[j] - sv[j], 2);
        }
        // RBF 核函数
        const kValue = Math.exp(-gamma * distSq);

        // 累加权重
        for (let c = 0; c < numClasses; c++) {
            // sklearn 对于二分类和多分类的 dual_coef 结构不同
            // 如果是二分类：dual_coef 只有 1 行
            const coef = numClasses === 2 ? (c === 1 ? svc_dual_coef[0][i] : -svc_dual_coef[0][i]) : svc_dual_coef[c][i];
            decisionValues[c] += coef * kValue;
        }
    }

    // 加偏置
    for (let c = 0; c < numClasses; c++) {
        decisionValues[c] += svc_intercept[c] || 0;
    }

    // 3. 找最大值 (简化版，如果是二分类，直接看 decisionValues[0] 的正负即可)
    let maxIdx = 0;
    if (numClasses === 2) {
        maxIdx = decisionValues[0] > 0 ? classes[1] : classes[0];
        // 用 sigmoid 粗略模拟置信度
        const conf = 1 / (1 + Math.exp(-Math.abs(decisionValues[0])));
        return { label: String(maxIdx), confidence: conf };
    } else {
        let maxVal = -Infinity;
        for (let i = 0; i < numClasses; i++) {
            if (decisionValues[i] > maxVal) {
                maxVal = decisionValues[i];
                maxIdx = i;
            }
        }
        // 多分类时用 softmax 模拟概率
        const expVals = decisionValues.map(v => Math.exp(v - maxVal));
        const sumExp = expVals.reduce((a, b) => a + b, 0);
        const conf = expVals[maxIdx] / sumExp;
        return { label: String(classes[maxIdx]), confidence: conf };
    }
}

// ─── 离线推理入口 (整合了预处理与推理) ─────────────────────────────────────────
export async function runOfflineAIAnalysis(imageUri: string): Promise<{ label: string, confidence: number } | null> {
    try {
        // 1. 绕过 SDK 55 原生 Bug：先把 file:// 转成 data:
        const safeUri = await toDataUri(imageUri);

        // 2. 使用新版链式 API，缩放并直接获取 base64
        const context = ImageManipulator.manipulate(safeUri);
        context.resize({ width: 64, height: 64 });
        
        const imageRef = await context.renderAsync();
        const manipulated = await imageRef.saveAsync({
            format: SaveFormat.PNG,
            base64: true, // 直接在这里拿到 base64
        });

        if (!manipulated.base64) return null;

        // 3. 解码为像素数组 
        // 💡 优化：既然你已经有 base64 了，可以直接传给专门解码 base64 的函数，
        // 避免 decodeImageToPixels 内部再次读取文件。
        // 如果你不想改 decodeImageToPixels 的签名，可以直接把上面的 base64 组合成 data URI 传进去：
        const dataUriForDecode = `data:image/png;base64,${manipulated.base64}`;
        const { pixels } = await decodeImageToPixels(dataUriForDecode, 64);
        
        // 4. 转灰度
        const grayPixels: number[] = [];
        for (let i = 0; i < 64 * 64; i++) {
            const r = pixels[i * 4];
            const g = pixels[i * 4 + 1];
            const b = pixels[i * 4 + 2];
            const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
            grayPixels.push(gray);
        }

        // 5. 提取 HOG 特征 (1764 维)
        const hogFeatures = extractHOG(grayPixels);

        // 6. 纯 JS 跑 SVC 推理
        const result = predictSVC(hogFeatures);
        
        return result;

    } catch (error) {
        console.error('离线 AI (JSON) 分析失败:', error);
        return null;
    }
}
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
