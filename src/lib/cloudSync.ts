/**
 * 云端数据同步工具（Supabase）
 * 将本地 BLE 监测数据批量上传至云端
 */
import { supabase } from '@/client/supabase';
import type { AlertEntry, DataLogEntry } from './types';

export interface CloudSyncStats {
  devices: number;
  logs: number;
  alerts: number;
  recordings: number;
  lastSyncAt: number | null;
}

export interface SyncPayload {
  deviceId: string;
  deviceName: string;
  deviceAddress: string;
  colorLabel?: string;
  logs: DataLogEntry[];
  alerts: AlertEntry[];
}

// ─── 上传 ─────────────────────────────────────────────────────────────────────

/** 批量同步设备数据到云端 */
export async function syncToCloud(payloads: SyncPayload[]): Promise<{ ok: boolean; error?: string }> {
  try {
    // 1. 上传设备信息
    const devices = payloads.map(p => ({
      id: p.deviceId,
      name: p.deviceName,
      address: p.deviceAddress,
      color_label: p.colorLabel ?? null,
    }));
    const { error: devErr } = await supabase
      .from('devices')
      .upsert(devices, { onConflict: 'id' });
    if (devErr) return { ok: false, error: devErr.message };

    // 2. 上传数据日志（批量，最多 500 条/设备）
    const allLogs = payloads.flatMap(p =>
      p.logs.slice(0, 500).map(l => ({
        id: l.id,
        device_id: p.deviceId,
        direction: l.direction,
        raw_hex: l.rawData.map(b => b.toString(16).padStart(2, '0')).join(' '),
        timestamp: l.timestamp,
      }))
    );
    if (allLogs.length > 0) {
      const { error: logErr } = await supabase
        .from('data_logs')
        .upsert(allLogs, { onConflict: 'id' });
      if (logErr) return { ok: false, error: logErr.message };
    }

    // 3. 上传预警记录
    const allAlerts = payloads.flatMap(p =>
      p.alerts.map(a => ({
        id: a.id,
        device_id: p.deviceId,
        device_name: a.deviceName ?? p.deviceName,
        type: a.type,
        detail: a.detail,
        timestamp: a.timestamp,
      }))
    );
    if (allAlerts.length > 0) {
      const { error: alertErr } = await supabase
        .from('alerts')
        .upsert(allAlerts, { onConflict: 'id' });
      if (alertErr) return { ok: false, error: alertErr.message };
    }

    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : '同步失败' };
  }
}

/** 上传热相录制元数据（不含帧数据，帧数据太大） */
export async function syncRecordingMeta(rec: {
  id: string;
  deviceId: string;
  deviceName: string;
  name: string;
  frameCount: number;
  durationMs: number;
  createdAt: number;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase.from('thermal_recordings').upsert([{
      id: rec.id,
      device_id: rec.deviceId,
      device_name: rec.deviceName,
      name: rec.name,
      frame_count: rec.frameCount,
      duration_ms: rec.durationMs,
      created_at: rec.createdAt,
    }], { onConflict: 'id' });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : '上传失败' };
  }
}

// ─── 统计查询 ─────────────────────────────────────────────────────────────────

/** 获取云端已同步数量统计 */
export async function fetchCloudStats(): Promise<CloudSyncStats> {
  const [d, l, a, r] = await Promise.all([
    supabase.from('devices').select('id', { count: 'exact', head: true }),
    supabase.from('data_logs').select('id', { count: 'exact', head: true }),
    supabase.from('alerts').select('id', { count: 'exact', head: true }),
    supabase.from('thermal_recordings').select('id', { count: 'exact', head: true }),
  ]);
  return {
    devices: d.count ?? 0,
    logs: l.count ?? 0,
    alerts: a.count ?? 0,
    recordings: r.count ?? 0,
    lastSyncAt: null,
  };
}

/** 测试 Supabase 连接是否正常 */
export async function testCloudConnection(): Promise<boolean> {
  try {
    const { error } = await supabase.from('devices').select('id').limit(1);
    return !error;
  } catch { return false; }
}
