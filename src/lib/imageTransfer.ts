/**
 * 蓝牙图传工具函数
 * 数据包格式（每包最大 512 字节）：
 *   Byte 0-1: 包序号 (0-based, big-endian uint16)
 *   Byte 2-3: 总包数 (big-endian uint16)
 *   Byte 4+:  图像数据内容
 */
import type { ImageTransferProgress, ImageTransferRecord } from './types';

export function parseImageChunk(bytes: number[]): {
  index: number;
  total: number;
  payload: Uint8Array;
} | null {
  if (bytes.length < 5) return null;
  const index = (bytes[0] << 8) | bytes[1];
  const total = (bytes[2] << 8) | bytes[3];
  if (total === 0 || index >= total) return null;
  const payload = new Uint8Array(bytes.slice(4));
  return { index, total, payload };
}

/** 将所有分包合并为 Base64 图像 dataURI */
export function mergeChunks(progress: ImageTransferProgress): string | null {
  const { totalChunks, chunks } = progress;
  // 检查所有包均已到达
  for (let i = 0; i < totalChunks; i++) {
    if (!chunks[i]) return null;
  }
  // 按序号拼接
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

  // 转 base64
  const b64 = uint8ArrayToBase64(merged);
  // 根据 JPEG 魔数判断格式，否则默认 jpeg
  const isJpeg = merged[0] === 0xFF && merged[1] === 0xD8;
  const mime = isJpeg ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${b64}`;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
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

/** 生成图传历史记录条目（传输完成后调用） */
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

export const MAX_IMAGE_HISTORY = 50;
