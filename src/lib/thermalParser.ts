import type { ThermalFrame, ThermalColormap } from './types';
import { renderThermalPixels, pixelsToDataUri } from './thermalAnalysis';

export const THERMAL_W = 32;
export const THERMAL_H = 24;
export const THERMAL_DATA_BYTES = THERMAL_W * THERMAL_H * 2; // 1536

/**
 * 解析 int16 小端温度矩阵为 ThermalFrame
 * 支持带帧头和无帧头两种模式（只解析数据部分）
 */
export function parseThermalBytes(tempBytes: number[],offset: number = 0): ThermalFrame | null {
  if (tempBytes.length < THERMAL_DATA_BYTES) return null;

  const view = new DataView(new Uint8Array(tempBytes.slice(0, THERMAL_DATA_BYTES)).buffer);
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

/** 把 ThermalFrame 渲染成 dataUri */
export function renderThermalFrame(frame: ThermalFrame, colormap: ThermalColormap): string {
  const pixels = renderThermalPixels(frame, colormap);
  return pixelsToDataUri(pixels, frame.width, frame.height);
}
