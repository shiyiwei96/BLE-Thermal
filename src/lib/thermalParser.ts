import type { ThermalFrame, ThermalColormap } from './types';
import { renderThermalPixels, pixelsToDataUri } from './thermalAnalysis';

export const THERMAL_W = 32;
export const THERMAL_H = 24;
export const THERMAL_POINTS = THERMAL_W * THERMAL_H;       // 768
export const THERMAL_INT16_BYTES = THERMAL_POINTS * 2;     // 1536
export const THERMAL_FLOAT32_BYTES = THERMAL_POINTS  * 4;   // 3072
/**
 * 解析 int16 小端温度矩阵为 ThermalFrame
 * 支持带帧头和无帧头两种模式（只解析数据部分）
 */
export function parseInt16Matrix(tempBytes: number[],offset: number = 0): ThermalFrame | null {
  if (tempBytes.length < THERMAL_INT16_BYTES) return null;

  const view = new DataView(new Uint8Array(tempBytes.slice(0, THERMAL_INT16_BYTES)).buffer);
  const tempData: number[] = new Array(THERMAL_W * THERMAL_H);

  // 先读原始值
  const raw: number[] = new Array(THERMAL_W * THERMAL_H);
  for (let i = 0; i < THERMAL_W * THERMAL_H; i++) {
    raw[i] = view.getInt16(i * 2, true) / 100 + offset; // 摄氏度

  }

  // 3×3 中值滤波去坏点
  for (let y = 0; y < THERMAL_H; y++) {
    for (let x = 0; x < THERMAL_W; x++) {
      const neighbors: number[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = y + dy, nx = x + dx;
          if (ny >= 0 && ny < THERMAL_H && nx >= 0 && nx < THERMAL_W) {
            neighbors.push(raw[ny * THERMAL_W + nx]);
          }
        }
      }
      neighbors.sort((a, b) => a - b);
      tempData[y * THERMAL_W + x] = neighbors[Math.floor(neighbors.length / 2)];
    }
  }

  let maxC = -Infinity, minC = Infinity, sum = 0;
  let maxIdx = 0, minIdx = 0;
  for (let i = 0; i < tempData.length; i++) {
    const v = tempData[i];
    if (v > maxC) { maxC = v; maxIdx = i; }
    if (v < minC) { minC = v; minIdx = i; }
    sum += v;
  }

  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    receivedAt: Date.now(),
    width: THERMAL_W,
    height: THERMAL_H,
    tempData,
    maxTemp: maxC,
    minTemp: minC,
    avgTemp: sum / tempData.length,
    maxPos: { x: maxIdx % THERMAL_W, y: Math.floor(maxIdx / THERMAL_W) },
    minPos: { x: minIdx % THERMAL_W, y: Math.floor(minIdx / THERMAL_W) },
  };
}


/** 解析 float32 温度矩阵 */
export function parseFloat32Matrix(bytes: number[], offset = 0): ThermalFrame | null {
  //console.log('[float32] 收到前32字节:', bytes.slice(0, 32).map(b => b.toString(16).padStart(2, '0')).join(' '));
  if (bytes.length < THERMAL_FLOAT32_BYTES) return null;

  const W = THERMAL_W;
  const H = THERMAL_H;
  const view = new DataView(new Uint8Array(bytes.slice(0, THERMAL_FLOAT32_BYTES)).buffer);
  const raw: number[] = new Array(W * H);

  // ============ 1. 读原始值 + 过滤 NaN/异常 ============
  for (let i = 0; i < W * H; i++) {
    let v = view.getFloat32(i * 4, true);
    if (!isFinite(v) || v < -50 || v > 200) {
      raw[i] = NaN;   // 标记为坏点
    } else {
      raw[i] = v + offset;
    }
  }

  // ============ 2. 坏点用邻域中值替换 ============
  const tempData: number[] = new Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (!isNaN(raw[idx])) {
        tempData[idx] = raw[idx];
        continue;
      }
      // 3×3 邻域
      const neighbors: number[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const ny = y + dy, nx = x + dx;
          if (ny < 0 || ny >= H || nx < 0 || nx >= W) continue;
          const nv = raw[ny * W + nx];
          if (!isNaN(nv)) neighbors.push(nv);
        }
      }
      if (neighbors.length > 0) {
        neighbors.sort((a, b) => a - b);
        tempData[idx] = neighbors[Math.floor(neighbors.length / 2)];
      } else {
        tempData[idx] = 25.0;
      }
    }
  }

  // ============ 3. 3×3 中值滤波（去局部坏点）============
  // 只对已经过 NaN 处理的 tempData 再滤一次，去掉孤立的亮点/暗点
  const filtered: number[] = new Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const neighbors: number[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = y + dy, nx = x + dx;
          if (ny < 0 || ny >= H || nx < 0 || nx >= W) continue;
          neighbors.push(tempData[ny * W + nx]);
        }
      }
      neighbors.sort((a, b) => a - b);
      filtered[y * W + x] = neighbors[Math.floor(neighbors.length / 2)];
    }
  }

  // ============ 4. 统计 ============
  let maxC = -Infinity, minC = Infinity, sum = 0;
  let maxIdx = 0, minIdx = 0;
  for (let i = 0; i < filtered.length; i++) {
    const v = filtered[i];
    if (v > maxC) { maxC = v; maxIdx = i; }
    if (v < minC) { minC = v; minIdx = i; }
    sum += v;
  }

  let zeroCnt = 0;
const zeroPos: string[] = [];
for (let i = 0; i < filtered.length; i++) {
  if (Math.abs(filtered[i]) < 0.5) {
    zeroCnt++;
    if (zeroPos.length < 30) zeroPos.push(`(${i % 32},${Math.floor(i / 32)})`);
  }
}
  return buildFrame(filtered, maxC, minC, sum / filtered.length, maxIdx, minIdx);
}


function buildFrame(
  tempData: number[], maxC: number, minC: number, avgC: number,
  maxIdx: number, minIdx: number
): ThermalFrame {
  const frame: ThermalFrame ={ 
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    receivedAt: Date.now(),
    width: THERMAL_W,
    height: THERMAL_H,
    tempData,
    maxTemp: maxC,
    minTemp: minC,
    avgTemp: avgC,
    maxPos: { x: maxIdx % THERMAL_W, y: Math.floor(maxIdx / THERMAL_W) },
    minPos: { x: minIdx % THERMAL_W, y: Math.floor(minIdx / THERMAL_W) },};
    frame.analysis = analyzeThermal(frame);   // 自动分析
    return frame;
  
}


export interface Hotspot {
  /** 区域中心（像素坐标） */
  centerX: number;
  centerY: number;
  /** 区域内像素个数 */
  pixelCount: number;
  /** 区域最高温 / 最低温 / 平均温 */
  maxTemp: number;
  minTemp: number;
  avgTemp: number;
  /** 区域外接矩形（用于画框） */
  bbox: { x: number; y: number; w: number; h: number };
}

export interface ThermalAnalysis {
  /** 全局 */
  globalMax: number;
  globalMin: number;
  globalAvg: number;
  /** 温差 */
  deltaT: number;           // max - min
  /** 热点列表（按 maxTemp 降序） */
  hotspots: Hotspot[];
  /** 冷点列表 */
  coldspots: Hotspot[];
  /** 有没有明显热点（ΔT > 阈值） */
  hasSignificantHotspot: boolean;
}


/**
 * 温度矩阵分析
 * @param frame 热相帧
 * @param hotspotRatio 热点阈值比例（默认 0.8，即 min + (max-min)*0.8 以上算热点）
 * @param minDeltaT 最小有效温差（默认 3℃，低于此不判定为热点）
 */
export function analyzeThermal(
  frame: ThermalFrame,
  hotspotRatio = 0.8,
  minDeltaT = 3.0
): ThermalAnalysis {
  const { tempData, width, height, maxTemp, minTemp, avgTemp } = frame;
  const deltaT = maxTemp - minTemp;

  // 温差太小，无有意义的热点
  if (deltaT < minDeltaT) {
    return {
      globalMax: maxTemp,
      globalMin: minTemp,
      globalAvg: avgTemp,
      deltaT,
      hotspots: [],
      coldspots: [],
      hasSignificantHotspot: false,
    };
  }

  // 阈值
  const hotThreshold = minTemp + deltaT * hotspotRatio;         // 高温阈值
  const coldThreshold = minTemp + deltaT * (1 - hotspotRatio);  // 低温阈值

  // 连通域分析（BFS）
  const visited = new Uint8Array(width * height);
  const hotspots: Hotspot[] = [];
  const coldspots: Hotspot[] = [];

  const neighborOffsets = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [-1, 1], [1, -1], [1, 1],   // 8 邻域
  ];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited[idx]) continue;
      const v = tempData[idx];
      const isHot = v >= hotThreshold;
      const isCold = v <= coldThreshold;
      if (!isHot && !isCold) { visited[idx] = 1; continue; }

      // BFS 找连通域
      const queue: number[] = [idx];
      visited[idx] = 1;
      const pixels: number[] = [idx];

      while (queue.length > 0) {
        const cur = queue.shift()!;
        const cy = Math.floor(cur / width);
        const cx = cur % width;

        for (const [dx, dy] of neighborOffsets) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (visited[nIdx]) continue;
          const nv = tempData[nIdx];
          if ((isHot && nv >= hotThreshold) || (isCold && nv <= coldThreshold)) {
            visited[nIdx] = 1;
            queue.push(nIdx);
            pixels.push(nIdx);
          } else {
            visited[nIdx] = 1;
          }
        }
      }

      // 过滤小区域（< 3 像素忽略）
      if (pixels.length < 3) continue;

      // 统计
      let regionMax = -Infinity, regionMin = Infinity, sum = 0;
      let minX = width, minY = height, maxX = -1, maxY = -1;
      let centerXSum = 0, centerYSum = 0;

      for (const p of pixels) {
        const px = p % width;
        const py = Math.floor(p / width);
        const pv = tempData[p];
        if (pv > regionMax) regionMax = pv;
        if (pv < regionMin) regionMin = pv;
        sum += pv;
        centerXSum += px;
        centerYSum += py;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }

      const region: Hotspot = {
        centerX: centerXSum / pixels.length,
        centerY: centerYSum / pixels.length,
        pixelCount: pixels.length,
        maxTemp: regionMax,
        minTemp: regionMin,
        avgTemp: sum / pixels.length,
        bbox: {
          x: minX,
          y: minY,
          w: maxX - minX + 1,
          h: maxY - minY + 1,
        },
      };

      if (isHot) hotspots.push(region);
      else coldspots.push(region);
    }
  }

  // 热点按最高温降序，冷点按最低温升序
  hotspots.sort((a, b) => b.maxTemp - a.maxTemp);
  coldspots.sort((a, b) => a.minTemp - b.minTemp);

  return {
    globalMax: maxTemp,
    globalMin: minTemp,
    globalAvg: avgTemp,
    deltaT,
    hotspots: hotspots.slice(0, 5),     // 最多 5 个热点
    coldspots: coldspots.slice(0, 5),   // 最多 5 个冷点
    hasSignificantHotspot: hotspots.length > 0,
  };
}


/** 把 ThermalFrame 渲染成 dataUri */
export function renderThermalFrame(frame: ThermalFrame, colormap: ThermalColormap): string {
  const pixels = renderThermalPixels(frame, colormap);
  return pixelsToDataUri(pixels, frame.width, frame.height);
}
