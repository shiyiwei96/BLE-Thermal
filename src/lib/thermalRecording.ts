/**
 * 热相录制工具库
 * - 录制会话管理（开始/停止/追加帧）
 * - 导出：JSON / CSV / 图像序列（ZIP via 多文件写入）
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { ThermalFrame, ThermalRecording, ThermalRecordFrame } from './types';

const RECORDINGS_DIR = `${FileSystem.documentDirectory}thermal_recordings/`;

/** 确保录制目录存在 */
async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(RECORDINGS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(RECORDINGS_DIR, { intermediates: true });
  }
}

/** 创建新录制会话 */
export function createRecording(
  deviceId: string,
  deviceName: string,
  name?: string,
): ThermalRecording {
  const now = Date.now();
  return {
    id: `rec_${now}_${Math.random().toString(36).slice(2, 6)}`,
    name: name ?? `录制 ${new Date(now).toLocaleTimeString('zh-CN')}`,
    deviceId,
    deviceName,
    createdAt: now,
    frameCount: 0,
    durationMs: 0,
    frames: [],
  };
}

/** 将热相帧追加到录制会话（返回更新后的录制） */
export function appendFrame(
  recording: ThermalRecording,
  frame: ThermalFrame,
  imageUri?: string, // 伪彩色 dataURI（可选，用于图像序列导出）
): ThermalRecording {
  const recFrame: ThermalRecordFrame = {
    frameIndex: recording.frames.length,
    timestamp: frame.receivedAt,
    maxTemp: frame.maxTemp,
    minTemp: frame.minTemp,
    avgTemp: frame.avgTemp,
    imageUri,
  };
  const frames = [...recording.frames, recFrame];
  return {
    ...recording,
    frames,
    frameCount: frames.length,
    durationMs: frame.receivedAt - recording.createdAt,
  };
}

/** 停止录制，填写结束时间 */
export function stopRecording(recording: ThermalRecording): ThermalRecording {
  return { ...recording, stoppedAt: Date.now() };
}

// ─── 导出 ──────────────────────────────────────────────────────────────────

/** 导出为 JSON 文件并分享 */
export async function exportAsJson(recording: ThermalRecording): Promise<void> {
  await ensureDir();
  const path = `${RECORDINGS_DIR}${recording.id}.json`;
  const payload = {
    id: recording.id,
    name: recording.name,
    deviceId: recording.deviceId,
    deviceName: recording.deviceName,
    createdAt: recording.createdAt,
    stoppedAt: recording.stoppedAt,
    frameCount: recording.frameCount,
    durationMs: recording.durationMs,
    frames: recording.frames.map(f => ({
      frameIndex: f.frameIndex,
      timestamp: f.timestamp,
      maxTemp: f.maxTemp,
      minTemp: f.minTemp,
      avgTemp: f.avgTemp,
    })),
  };
  await FileSystem.writeAsStringAsync(path, JSON.stringify(payload, null, 2), {
    encoding: FileSystem.EncodingType.UTF8,
  });
  await Sharing.shareAsync(path, {
    mimeType: 'application/json',
    dialogTitle: `导出 ${recording.name}`,
  });
}

/** 导出为 CSV 文件并分享 */
export async function exportAsCsv(recording: ThermalRecording): Promise<void> {
  await ensureDir();
  const path = `${RECORDINGS_DIR}${recording.id}.csv`;
  const header = 'frameIndex,timestamp,maxTemp,minTemp,avgTemp\n';
  const rows = recording.frames.map(f =>
    `${f.frameIndex},${f.timestamp},${f.maxTemp.toFixed(2)},${f.minTemp.toFixed(2)},${f.avgTemp.toFixed(2)}`
  ).join('\n');
  await FileSystem.writeAsStringAsync(path, header + rows, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  await Sharing.shareAsync(path, {
    mimeType: 'text/csv',
    dialogTitle: `导出 ${recording.name}`,
  });
}

/** 导出图像序列：将每帧 dataURI 写成 PNG 文件并打包分享 */
export async function exportImageSequence(recording: ThermalRecording): Promise<void> {
  await ensureDir();
  const seqDir = `${RECORDINGS_DIR}${recording.id}_imgs/`;
  const seqDirInfo = await FileSystem.getInfoAsync(seqDir);
  if (!seqDirInfo.exists) {
    await FileSystem.makeDirectoryAsync(seqDir, { intermediates: true });
  }

  let exportedCount = 0;
  for (const frame of recording.frames) {
    if (!frame.imageUri?.startsWith('data:image/png;base64,')) continue;
    const base64 = frame.imageUri.slice('data:image/png;base64,'.length);
    const framePath = `${seqDir}frame_${String(frame.frameIndex).padStart(4, '0')}.png`;
    await FileSystem.writeAsStringAsync(framePath, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    exportedCount++;
  }

  if (exportedCount === 0) {
    throw new Error('无可导出的图像帧（请确保录制时生成了伪彩图）');
  }

  // 分享目录（某些平台支持，iOS 会打包为 zip）
  await Sharing.shareAsync(seqDir, {
    dialogTitle: `导出图像序列 ${recording.name}（${exportedCount} 帧）`,
  });
}

/** 删除本地录制文件 */
export async function deleteRecordingFile(recordingId: string): Promise<void> {
  await ensureDir();
  for (const ext of ['json', 'csv']) {
    const p = `${RECORDINGS_DIR}${recordingId}.${ext}`;
    const info = await FileSystem.getInfoAsync(p);
    if (info.exists) await FileSystem.deleteAsync(p, { idempotent: true });
  }
  const imgDir = `${RECORDINGS_DIR}${recordingId}_imgs/`;
  const imgInfo = await FileSystem.getInfoAsync(imgDir);
  if (imgInfo.exists) await FileSystem.deleteAsync(imgDir, { idempotent: true });
}

/** 格式化录制时长 */
export function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
