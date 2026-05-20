/**
 * 机器学习模型比对工具库（纯 TypeScript/JS，无重型框架）
 *
 * 算法：
 *   1. 颜色直方图特征（RGB 三通道各 256 级）
 *   2. 统计矩特征（均值/方差/偏度/峰度 × 3 通道）
 *   3. LBP 纹理特征（Local Binary Pattern 直方图 256 级）
 *   4. 空间网格特征（4×4 子块均值+方差，3 通道）
 *
 * 比对：
 *   - 直方图交叉相似度 (Histogram Intersection)
 *   - 余弦相似度 (Cosine Similarity)
 *   - 综合评分 = histWeight * hist + cosWeight * cos → [0,100]
 *
 * 差异图：
 *   - 像素级 |A - B| 差值（亮度通道）→ 铁红伪彩色热图
 *
 * 异常块检测：
 *   - 4×4 子块均值差异 > 阈值（%）即标记为异常
 */

import type { ReferenceModel, ComparisonResult } from './types';
import { COMPARISON_GRID } from './types';
import { genId } from './bleService';
import { rgbaToBmpDataUri } from './fileAnalysis';

// ─── 特征提取 ─────────────────────────────────────────────────────────────────

/** 计算 RGB 三通道各 256 级直方图，返回长度 768 的归一化向量 */
function buildColorHistogram(rgba: Uint8Array, pixelCount: number): number[] {
  const hist = new Array<number>(768).fill(0);
  for (let i = 0; i < pixelCount; i++) {
    hist[rgba[i * 4]]           += 1; // R: 0-255
    hist[256 + rgba[i * 4 + 1]] += 1; // G: 256-511
    hist[512 + rgba[i * 4 + 2]] += 1; // B: 512-767
  }
  // 归一化 [0,1]
  for (let c = 0; c < 3; c++) {
    const base = c * 256;
    let sum = 0;
    for (let k = 0; k < 256; k++) sum += hist[base + k];
    if (sum > 0) for (let k = 0; k < 256; k++) hist[base + k] /= sum;
  }
  return hist;
}

/** 计算单通道统计矩（均值/方差/偏度/峰度）*/
function channelMoments(values: number[]): [number, number, number, number] {
  const n = values.length;
  if (n === 0) return [0, 0, 0, 0];

  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / n;

  let m2 = 0, m3 = 0, m4 = 0;
  for (const v of values) {
    const d = v - mean;
    m2 += d * d;
    m3 += d * d * d;
    m4 += d * d * d * d;
  }
  m2 /= n; m3 /= n; m4 /= n;
  const std = Math.sqrt(m2) || 1;
  const skew = m3 / (std ** 3);
  const kurt = m4 / (std ** 4) - 3;
  return [mean / 255, Math.sqrt(m2) / 255, skew, kurt];
}

/** 提取 RGB 三通道统计矩，返回长度 12 的向量 */
function buildStatisticalMoments(rgba: Uint8Array, pixelCount: number): number[] {
  const r: number[] = [], g: number[] = [], b: number[] = [];
  for (let i = 0; i < pixelCount; i++) {
    r.push(rgba[i * 4]);
    g.push(rgba[i * 4 + 1]);
    b.push(rgba[i * 4 + 2]);
  }
  return [...channelMoments(r), ...channelMoments(g), ...channelMoments(b)];
}

/** 计算 LBP（Local Binary Pattern）纹理直方图（256 级，归一化） */
function buildLbpHistogram(
  rgba: Uint8Array,
  width: number,
  height: number
): number[] {
  const hist = new Array<number>(256).fill(0);
  // 将 RGBA 转为灰度
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    gray[i] = Math.round(
      0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]
    );
  }

  // 8邻域 LBP（跳过边缘1像素）
  const dx = [-1, -1, 0, 1, 1, 1, 0, -1];
  const dy = [0, -1, -1, -1, 0, 1, 1, 1];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const center = gray[y * width + x];
      let code = 0;
      for (let k = 0; k < 8; k++) {
        const ny = y + dy[k];
        const nx = x + dx[k];
        if (gray[ny * width + nx] >= center) code |= (1 << k);
      }
      hist[code]++;
    }
  }

  // 归一化
  const total = hist.reduce((a, b) => a + b, 0) || 1;
  return hist.map(v => v / total);
}

/** 提取空间网格特征：4×4 子块，每块 3 通道均值+方差，共 96 维 */
function buildGridFeatures(
  rgba: Uint8Array,
  width: number,
  height: number,
  grid: number = COMPARISON_GRID
): number[] {
  const features: number[] = [];
  const bw = Math.floor(width / grid);
  const bh = Math.floor(height / grid);
  if (bw === 0 || bh === 0) return new Array(grid * grid * 6).fill(0);

  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const r: number[] = [], g: number[] = [], b: number[] = [];
      for (let y = gy * bh; y < (gy + 1) * bh && y < height; y++) {
        for (let x = gx * bw; x < (gx + 1) * bw && x < width; x++) {
          const i = y * width + x;
          r.push(rgba[i * 4]);
          g.push(rgba[i * 4 + 1]);
          b.push(rgba[i * 4 + 2]);
        }
      }
      for (const ch of [r, g, b]) {
        const mean = ch.reduce((a, v) => a + v, 0) / (ch.length || 1);
        const variance = ch.reduce((a, v) => a + (v - mean) ** 2, 0) / (ch.length || 1);
        features.push(mean / 255, Math.sqrt(variance) / 255);
      }
    }
  }
  return features;
}

/** 构建参考模型（完整特征提取） */
export function buildReferenceModel(
  rgba: Uint8Array,
  width: number,
  height: number,
  fileName: string,
  thumbUri: string
): ReferenceModel {
  const pixelCount = width * height;
  return {
    id: genId(),
    builtAt: Date.now(),
    fileName,
    thumbUri,
    width,
    height,
    colorHistogram: buildColorHistogram(rgba, pixelCount),
    statisticalMoments: buildStatisticalMoments(rgba, pixelCount),
    lbpHistogram: buildLbpHistogram(rgba, width, height),
    gridFeatures: buildGridFeatures(rgba, width, height),
    rgba: Array.from(rgba),
  };
}

// ─── 比对算法 ─────────────────────────────────────────────────────────────────

/** 直方图交叉相似度 [0,1]（两归一化直方图的最小值之和） */
function histogramIntersection(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < len; i++) s += Math.min(a[i], b[i]);
  return s;
}

/** 余弦相似度 [−1,1] */
function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  return (Math.sqrt(na) * Math.sqrt(nb)) === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 拼接特征向量（直方图 + 矩 + LBP + 网格） */
function concatFeatures(model: ReferenceModel): number[] {
  return [
    ...model.colorHistogram,
    ...model.statisticalMoments,
    ...model.lbpHistogram,
    ...model.gridFeatures,
  ];
}

// ─── 差值热图 ─────────────────────────────────────────────────────────────────

/** 铁红色阶（同 thermalAnalysis.ts，不引入依赖）*/
function ironColor(t: number): [number, number, number] {
  const stops: Array<[number, [number, number, number]]> = [
    [0.00, [0, 0, 0]],
    [0.20, [60, 0, 100]],
    [0.40, [140, 0, 140]],
    [0.55, [200, 30, 30]],
    [0.70, [240, 100, 0]],
    [0.85, [255, 200, 0]],
    [1.00, [255, 255, 220]],
  ];
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
      ];
    }
  }
  return stops[stops.length - 1][1];
}

/**
 * 生成像素级差值热图（双线性缩放测试图到参考图尺寸）
 * 返回 BMP dataURI
 */
function buildDiffMap(
  refRgba: Uint8Array,
  testRgba: Uint8Array,
  refW: number, refH: number,
  testW: number, testH: number
): string {
  const out = new Uint8Array(refW * refH * 4);
  for (let y = 0; y < refH; y++) {
    for (let x = 0; x < refW; x++) {
      // 双线性采样测试图
      const tx = (x / refW) * testW;
      const ty = (y / refH) * testH;
      const tx0 = Math.floor(tx);
      const ty0 = Math.floor(ty);
      const tx1 = Math.min(tx0 + 1, testW - 1);
      const ty1 = Math.min(ty0 + 1, testH - 1);
      const fx = tx - tx0;
      const fy = ty - ty0;

      const sample = (ch: number): number => {
        const v00 = testRgba[(ty0 * testW + tx0) * 4 + ch];
        const v10 = testRgba[(ty0 * testW + tx1) * 4 + ch];
        const v01 = testRgba[(ty1 * testW + tx0) * 4 + ch];
        const v11 = testRgba[(ty1 * testW + tx1) * 4 + ch];
        return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) +
               v01 * (1 - fx) * fy       + v11 * fx * fy;
      };

      const ri = (y * refW + x);
      const dr = Math.abs(refRgba[ri * 4]     - sample(0));
      const dg = Math.abs(refRgba[ri * 4 + 1] - sample(1));
      const db = Math.abs(refRgba[ri * 4 + 2] - sample(2));
      // 亮度差
      const luma = (0.299 * dr + 0.587 * dg + 0.114 * db) / 255;
      const [r, g, b] = ironColor(luma);
      out[ri * 4]     = r;
      out[ri * 4 + 1] = g;
      out[ri * 4 + 2] = b;
      out[ri * 4 + 3] = 255;
    }
  }
  return rgbaToBmpDataUri(out, refW, refH);
}

// ─── 异常块检测 ───────────────────────────────────────────────────────────────

/**
 * 检测 4×4 子块中均值差异超过阈值的块
 * threshold: 差异阈值百分比 [0,100]
 * 返回异常块索引列表（row-major 0-based）
 */
function detectAnomalyBlocks(
  refRgba: Uint8Array,
  testRgba: Uint8Array,
  refW: number, refH: number,
  testW: number, testH: number,
  threshold: number,
  grid: number = COMPARISON_GRID
): number[] {
  const anomalies: number[] = [];
  const bw = Math.floor(refW / grid);
  const bh = Math.floor(refH / grid);
  if (bw === 0 || bh === 0) return [];

  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const blockIdx = gy * grid + gx;
      let sumRef = 0, sumTest = 0, count = 0;

      for (let y = gy * bh; y < (gy + 1) * bh && y < refH; y++) {
        for (let x = gx * bw; x < (gx + 1) * bw && x < refW; x++) {
          // 参考图采样
          const ri = y * refW + x;
          sumRef += 0.299 * refRgba[ri * 4] + 0.587 * refRgba[ri * 4 + 1] + 0.114 * refRgba[ri * 4 + 2];
          // 测试图双线性采样
          const tx = Math.min(Math.round((x / refW) * testW), testW - 1);
          const ty = Math.min(Math.round((y / refH) * testH), testH - 1);
          const ti = ty * testW + tx;
          sumTest += 0.299 * testRgba[ti * 4] + 0.587 * testRgba[ti * 4 + 1] + 0.114 * testRgba[ti * 4 + 2];
          count++;
        }
      }
      if (count === 0) continue;
      const diff = Math.abs(sumRef - sumTest) / count;
      const diffPct = (diff / 255) * 100;
      if (diffPct > threshold) anomalies.push(blockIdx);
    }
  }
  return anomalies;
}

// ─── 主比对函数 ───────────────────────────────────────────────────────────────

export interface CompareOptions {
  diffThreshold: number;   // 子块差异阈值 % [0,100]
  histWeight?: number;     // 直方图权重（默认 0.5）
  cosWeight?: number;      // 余弦权重（默认 0.5）
}

/**
 * 执行完整比对，返回 ComparisonResult
 * testRgba: 测试图 RGBA 像素数组（Uint8Array）
 * testThumbUri: 测试图缩略图 dataURI（用于历史记录）
 */
export function compareImages(
  ref: ReferenceModel,
  testRgba: Uint8Array,
  testW: number,
  testH: number,
  testThumbUri: string,
  options: CompareOptions
): ComparisonResult {
  const { diffThreshold, histWeight = 0.5, cosWeight = 0.5 } = options;
  const testPixels = testW * testH;

  // 1. 提取测试图特征
  const testModel: ReferenceModel = {
    id: '',
    builtAt: 0,
    fileName: '',
    thumbUri: '',
    width: testW,
    height: testH,
    colorHistogram: buildColorHistogram(testRgba, testPixels),
    statisticalMoments: buildStatisticalMoments(testRgba, testPixels),
    lbpHistogram: buildLbpHistogram(testRgba, testW, testH),
    gridFeatures: buildGridFeatures(testRgba, testW, testH),
    rgba: [],
  };

  // 2. 直方图交叉（仅颜色直方图部分，共 768 维）
  const histScore = histogramIntersection(ref.colorHistogram, testModel.colorHistogram);

  // 3. 余弦相似度（全特征向量）
  const refVec  = concatFeatures(ref);
  const testVec = concatFeatures(testModel);
  const cosRaw  = cosineSimilarity(refVec, testVec);
  const cosNorm = (cosRaw + 1) / 2; // 映射到 [0,1]

  // 4. 综合评分 [0,100]
  const tw = histWeight + cosWeight;
  const overall = Math.round(
    ((histWeight * histScore + cosWeight * cosNorm) / tw) * 100
  );

  // 5. 差值热图
  const refRgba = new Uint8Array(ref.rgba);
  const diffMapUri = buildDiffMap(
    refRgba, testRgba,
    ref.width, ref.height,
    testW, testH
  );

  // 6. 异常块检测
  const anomalyBlocks = detectAnomalyBlocks(
    refRgba, testRgba,
    ref.width, ref.height,
    testW, testH,
    diffThreshold
  );

  return {
    id: genId(),
    comparedAt: Date.now(),
    thumbUri: testThumbUri,
    histIntersection: Math.round(histScore * 1000) / 1000,
    cosineSimilarity: Math.round(cosNorm * 1000) / 1000,
    overallScore: overall,
    diffMapUri,
    anomalyBlocks,
    width: testW,
    height: testH,
  };
}

/** 计算相似度趋势统计 */
export function calcTrendStats(scores: number[]): {
  avg: number;
  min: number;
  max: number;
} {
  if (scores.length === 0) return { avg: 0, min: 0, max: 0 };
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  return { avg, min, max };
}
