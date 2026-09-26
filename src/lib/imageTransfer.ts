/**
 * 蓝牙图传工具函数
 * 设备实际发送：裸 JPEG 字节流（FF D8 ... FF D9）
 * 无自定义包头，按 JPEG 边界切分
 */
import type { ImageTransferProgress, ImageTransferRecord } from './types';

/** 保留兼容：不再使用，接收逻辑已改为 FF D9 边界切分 */
export function parseImageChunk(bytes: number[]): {
  index: number;
  total: number;
  payload: Uint8Array;
} | null {
  if (bytes.length < 5) return null;
  const index = (bytes[0] << 8) | bytes[1];
  const total = (bytes[2] << 8) | bytes[3];
  if (total === 0 || index >= total) return null;
  return { index, total, payload: new Uint8Array(bytes.slice(4)) };
}

/** 保留兼容 */
export function mergeChunks(progress: ImageTransferProgress): string | null {
  const { totalChunks, chunks } = progress;
  for (let i = 0; i < totalChunks; i++) {
    if (!chunks[i]) return null;
  }
  const parts: Uint8Array[] = [];
  let totalLen = 0;
  for (let i = 0; i < totalChunks; i++) {
    parts.push(chunks[i]);
    totalLen += chunks[i].length;
  }
  const merged = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  const b64 = uint8ArrayToBase64(merged);
  const isJpeg = merged[0] === 0xFF && merged[1] === 0xD8;
  const mime = isJpeg ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${b64}`;
}

/** Uint8Array → base64 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** 创建新的进度记录 */
export function createProgress(total: number): ImageTransferProgress {
  return { totalChunks: total, receivedChunks: 0, chunks: {} };
}

/** 生成图传历史记录条目 */
export function createImageRecord(
  id: string,
  dataUri: string,
  progress: ImageTransferProgress
): ImageTransferRecord {
  return {
    id,
    receivedAt: Date.now(),
    totalChunks: progress.totalChunks,
    receivedChunks: progress.receivedChunks,
    dataUri,
    isComplete: true,
  };
}

/** 新增：从裸 JPEG 字节生成 dataUri */
export function jpegBytesToDataUri(bytes: number[]): string {
  const b64 = uint8ArrayToBase64(new Uint8Array(bytes));
  return `data:image/jpeg;base64,${b64}`;
}

/** 新增：生成单帧记录（流模式/单帧模式都用） */
export function createFrameRecord(bytes: number[]): ImageTransferRecord {
  const dataUri = jpegBytesToDataUri(bytes);
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    receivedAt: Date.now(),
    totalChunks: 1,
    receivedChunks: 1,
    dataUri,
    isComplete: true,
  };
}

export const MAX_IMAGE_HISTORY = 50;
