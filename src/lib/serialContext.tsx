/**
 * USB 串口全局状态管理 Context
 * 使用 react-native-usb-serialport-for-android 实现
 * 仅支持 Android - iOS 显示不支持提示
 */
import { parseThermalBytes, renderThermalFrame, THERMAL_DATA_BYTES } from './thermalParser';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';
import type {
  AlertEntry,
  AppSettings,
  DataLogEntry,
  DataStats,
  FieldHistoryPoint,
  ParsedFieldState,
  SerialConfig,
  SerialDevice,
  ThermalFrame,
  ThermalColormap, 
} from './types';
import { DEFAULT_SERIAL_CONFIG } from './types';
import {
  adaptSerialDevice,
  bytesToHexStr,
  createSerialAlert,
  createSerialLogEntry,
  hexDataToBytes,
  isSerialSupported,
  parseInputToBytes,
} from './serialService';
import {
  DEFAULT_ALERT_RULES,
  DEFAULT_FIELD_MAPPINGS,
  evaluateThreshold,
  genId,
} from './bleService';

const MAX_LOG_ENTRIES = 1000;
const MAX_RSSI_HISTORY = 60;
const MAX_FIELD_HISTORY = 60;

const DEFAULT_STATS: DataStats = {
  totalRxBytes: 0,
  totalTxBytes: 0,
  rxRate: 0,
  txRate: 0,
  rssiHistory: [],
};

// ============ Context 类型 ============
export interface SerialContextType {
  // 串口设备列表
  serialDevices: SerialDevice[];
  connectedSerial: SerialDevice | null;

  // 状态标志
  isDiscovering: boolean;    // 正在枚举 USB 设备
  isConnecting: boolean;     // 正在连接
  serialError: string | null;

  // 数据
  serialLogs: DataLogEntry[];
  serialAlerts: AlertEntry[];
  serialStats: DataStats;
  serialParsedFields: Record<string, ParsedFieldState>;

  latestThermalFrame: ThermalFrame | null;
  latestThermalDataUri: string | null;
  thermalFrames: ThermalFrame[];
  isConnected: boolean;   // 加一个方便热相页判断

  // 操作
  discoverDevices: () => Promise<void>;
  connectSerial: (device: SerialDevice, config: SerialConfig) => Promise<void>;
  disconnectSerial: () => Promise<void>;
  sendSerialData: (input: string) => Promise<void>;
  clearSerialLogs: () => void;
  clearSerialAlerts: () => void;
  updateSerialAlertRule: (id: string, patch: Partial<import('./types').DataAlertRule>) => void;
  deleteSerialAlertRule: (id: string) => void;
  addSerialAlertRule: (rule: Omit<import('./types').DataAlertRule, 'id'>) => void;
}

const SerialContext = createContext<SerialContextType | null>(null);

export function useSerial(): SerialContextType {
  const ctx = useContext(SerialContext);
  if (!ctx) throw new Error('useSerial must be used within SerialProvider');
  return ctx;
}

// ============ Provider ============
export function SerialProvider({ children, settings }: { children: React.ReactNode; settings: AppSettings }) {
  const [serialDevices, setSerialDevices] = useState<SerialDevice[]>([]);
  const [connectedSerial, setConnectedSerial] = useState<SerialDevice | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [serialError, setSerialError] = useState<string | null>(null);
  const [serialLogs, setSerialLogs] = useState<DataLogEntry[]>([]);
  const [serialAlerts, setSerialAlerts] = useState<AlertEntry[]>([]);
  const [serialStats, setSerialStats] = useState<DataStats>(DEFAULT_STATS);
  const [serialParsedFields, setSerialParsedFields] = useState<Record<string, ParsedFieldState>>({});
  const [alertRules, setAlertRules] = useState(settings.dataAlertRules ?? DEFAULT_ALERT_RULES);
  
  // ===== 热相数据 =====
const [latestThermalFrame, setLatestThermalFrame] = useState<ThermalFrame | null>(null);
const [latestThermalDataUri, setLatestThermalDataUri] = useState<string | null>(null);
const [thermalFrames, setThermalFrames] = useState<ThermalFrame[]>([]);

const thermalBufferRef = useRef<number[]>([]);
const thermalModeRef = useRef<'unknown' | 'withHeader' | 'noHeader' | 'data'>('unknown');
const thermalLastRenderRef = useRef(0);
const thermalPendingRef = useRef<ThermalFrame | null>(null);
const thermalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // refs
  const usbSerialRef = useRef<import('react-native-usb-serialport-for-android').UsbSerial | null>(null);
  const rxListenerRef = useRef<{ remove: () => void } | null>(null);
  const connectedDeviceRef = useRef<SerialDevice | null>(null);
  const settingsRef = useRef(settings);
  const rxBytesBuffer = useRef(0);
  const txBytesBuffer = useRef(0);
  const statsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dataTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ruleLastAlertRef = useRef<Record<string, number>>({});

  // 同步 settings 到 ref
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { setAlertRules(settings.dataAlertRules ?? DEFAULT_ALERT_RULES); }, [settings.dataAlertRules]);

  // ============ 停止所有任务 ============
  const stopAllTasks = useCallback(() => {
    if (statsTimerRef.current) { clearInterval(statsTimerRef.current); statsTimerRef.current = null; }
    if (dataTimeoutRef.current) { clearTimeout(dataTimeoutRef.current); dataTimeoutRef.current = null; }
    rxListenerRef.current?.remove();
    rxListenerRef.current = null;
  }, []);

  // ============ 重置数据超时计时器 ============
  const resetDataTimeout = useCallback(() => {
    if (dataTimeoutRef.current) clearTimeout(dataTimeoutRef.current);
    const s = settingsRef.current.dataTimeoutSeconds * 1000;
    dataTimeoutRef.current = setTimeout(() => {
      const dev = connectedDeviceRef.current;
      if (!dev) return;
      const alert = createSerialAlert('DATA_TIMEOUT', dev.deviceId.toString(), dev.displayName, settingsRef.current);
      setSerialAlerts(a => [alert, ...a].slice(0, 200));
    }, s);
  }, []);

  // ============ 处理解析字段 + 触发报警 ============
  const handleParsedFields = useCallback((fields: Record<string, number>) => {
    if (Object.keys(fields).length === 0) return;
    const now = Date.now();
    const currentRules = alertRules;

    setSerialParsedFields(prev => {
      const next = { ...prev };
      for (const [key, value] of Object.entries(fields)) {
        const existing = next[key];
        const newHistory: FieldHistoryPoint[] = [
          ...(existing?.history ?? []),
          { timestamp: now, value },
        ].slice(-MAX_FIELD_HISTORY);
        next[key] = { key, value, timestamp: now, history: newHistory };
      }
      return next;
    });

    // 检查报警规则
    for (const rule of currentRules) {
      if (!rule.enabled) continue;
      const val = fields[rule.fieldKey];
      if (val === undefined) continue;
      if (!evaluateThreshold(val, rule.operator, rule.value)) continue;
      const cooldownKey = rule.id;
      if (now - (ruleLastAlertRef.current[cooldownKey] ?? 0) < 30000) continue;
      ruleLastAlertRef.current[cooldownKey] = now;
      const dev = connectedDeviceRef.current;
      const extra = `${rule.fieldKey} ${rule.operator} ${rule.value}，当前值=${val}`;
      const alert = createSerialAlert('DATA_THRESHOLD', dev?.deviceId.toString() ?? '', dev?.displayName ?? null, settingsRef.current, extra);
      setSerialAlerts(a => [alert, ...a].slice(0, 200));
    }
  }, [alertRules]);

  // ============ 枚举 USB 设备 ============
  const discoverDevices = useCallback(async () => {
    if (!isSerialSupported) {
      setSerialError('iOS 不支持 USB 串口通信，请使用 Android 设备');
      return;
    }
    setIsDiscovering(true);
    setSerialError(null);
    try {
      const { UsbSerialManager } = await import('react-native-usb-serialport-for-android');
      const devices = await UsbSerialManager.list();
      setSerialDevices(devices.map(d => adaptSerialDevice(d, false)));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '获取设备列表失败';
      setSerialError(`枚举设备失败：${msg}`);
    } finally {
      setIsDiscovering(false);
    }
  }, []);


  // ===== 热相帧渲染（节流 10fps）=====
const renderThermalNow = useCallback((frame: ThermalFrame) => {
  const colormap = (settingsRef.current.thermalColormap ?? 'iron') as ThermalColormap;
  const uri = renderThermalFrame(frame, colormap);
  setLatestThermalFrame(frame);
  setLatestThermalDataUri(uri);
  setThermalFrames(prev => [frame, ...prev].slice(0, 100));
}, []);

const handleThermalFrame = useCallback((tempBytes: number[]) => {
  // 带帧头 → -40；无帧头 → 0
  const offset = thermalModeRef.current === 'withHeader' ? -40 : 0;
  const frame = parseThermalBytes(tempBytes, offset);
  
  if (!frame) return;

  thermalPendingRef.current = frame;
  const now = Date.now();
  const INTERVAL = 100;

  if (now - thermalLastRenderRef.current >= INTERVAL) {
    thermalLastRenderRef.current = now;
    renderThermalNow(frame);
    thermalPendingRef.current = null;
  } else if (!thermalTimerRef.current) {
    thermalTimerRef.current = setTimeout(() => {
      thermalTimerRef.current = null;
      if (thermalPendingRef.current) {
        thermalLastRenderRef.current = Date.now();
        renderThermalNow(thermalPendingRef.current);
        thermalPendingRef.current = null;
      }
    }, INTERVAL - (now - thermalLastRenderRef.current));
  }
}, [renderThermalNow]);

// ===== 热相数据分流（自动探测格式）=====
const feedThermalData = useCallback((bytes: number[]): boolean => {
  const buf = thermalBufferRef.current;
  buf.push(...bytes);

  // 首次探测：判断是不是热相数据
  if (thermalModeRef.current === 'unknown' && buf.length >= 4) {
    if (buf[0] === 0x5A && buf[1] === 0x06 && buf[2] === 0x02 && buf[3] === 0x00) {
      thermalModeRef.current = 'withHeader';
      console.log('[Serial热相] 探测到带帧头模式');
    } else if (
      // 温度合理范围粗筛：int16 值应该在 0~10000（即 0~100℃ * 100）之间
      // 拿前 4 字节试读，若都在合理范围则判为热相
      (() => {
        const v0 = (buf[0] | (buf[1] << 8));
        const v1 = (buf[2] | (buf[3] << 8));
        return v0 > 0 && v0 < 10000 && v1 > 0 && v1 < 10000;
      })()
    ) {
      thermalModeRef.current = 'noHeader';
      console.log('[Serial热相] 探测到无帧头模式（裸 int16）');
    } else {
      thermalModeRef.current = 'data';
      console.log('[Serial热相] 探测到普通数据模式');
    }
  }

  if (thermalModeRef.current === 'data') return false; // 交给普通数据流程

  // ---- 无帧头：定长 1536 切分 ----
  if (thermalModeRef.current === 'noHeader') {
    while (buf.length >= THERMAL_DATA_BYTES) {
      const frameBytes = buf.slice(0, THERMAL_DATA_BYTES);
      buf.splice(0, THERMAL_DATA_BYTES);
      handleThermalFrame(frameBytes);
    }
    if (buf.length > THERMAL_DATA_BYTES * 4) buf.length = 0;
    return true;
  }

  // ---- 带帧头：找 5A 06 02 00 ----
  if (thermalModeRef.current === 'withHeader') {
    while (true) {
      let idx = -1;
      for (let i = 0; i <= buf.length - 4; i++) {
        if (buf[i] === 0x5A && buf[i+1] === 0x06 && buf[i+2] === 0x02 && buf[i+3] === 0x00) {
          idx = i; break;
        }
      }
      if (idx < 0) {
        if (buf.length > 3) { const k = buf.slice(-3); buf.length = 0; buf.push(...k); }
        break;
      }
      if (idx > 0) buf.splice(0, idx);
      if (buf.length < 4 + THERMAL_DATA_BYTES) break;
      const tempBytes = buf.slice(4, 4 + THERMAL_DATA_BYTES);
      buf.splice(0, 4 + THERMAL_DATA_BYTES);
      handleThermalFrame(tempBytes);
    }
    if (buf.length > THERMAL_DATA_BYTES * 4) buf.length = 0;
    return true;
  }
// ---- 未知模式 ---
  return false;
}, [handleThermalFrame]);



  // ============ 连接串口设备 ============
  const connectSerial = useCallback(async (device: SerialDevice, config: SerialConfig) => {
    if (!isSerialSupported) {
      setSerialError('iOS 不支持 USB 串口通信');
      return;
    }
    setIsConnecting(true);
    setSerialError(null);

    try {
      const { UsbSerialManager } = await import('react-native-usb-serialport-for-android');

      // 请求 USB 权限
      console.log('[USB] 请求权限, deviceId:', device.deviceId);
      const hasPermission = await UsbSerialManager.tryRequestPermission(device.deviceId);
      console.log('[USB] 权限结果:', hasPermission); 
      if (!hasPermission) {
        // Permission dialog shown; user needs to re-tap "连接" after granting
        setSerialError('请在弹出的对话框中授予 USB 权限后重试');
        setIsConnecting(false);
        return;
      }

      // 打开串口（parity 为数字枚举值，直接传递给底层库）
      const serial = await UsbSerialManager.open(device.deviceId, {
        baudRate: config.baudRate,
        dataBits: config.dataBits,
        stopBits: config.stopBits,
        parity: config.parity as number,
      });
      usbSerialRef.current = serial;

      const connectedDev: SerialDevice = { ...device, isConnected: true };
      connectedDeviceRef.current = connectedDev;
      setConnectedSerial(connectedDev);
      setSerialDevices(prev => prev.map(d => d.deviceId === device.deviceId ? connectedDev : d));
      setSerialStats(DEFAULT_STATS);
      setSerialParsedFields({});
      ruleLastAlertRef.current = {};

      // 订阅数据接收（自动分流：热相 / 普通数据）
 rxListenerRef.current = serial.onReceived(event => {
  const bytes = hexDataToBytes(event.data);
  if (bytes.length === 0) return;

  rxBytesBuffer.current += bytes.length;
  resetDataTimeout();

  // ---- 1. 热相优先（feedThermalData 返回 true 表示已消费）----
  if (feedThermalData(bytes)) {
    return;
  }

  // ---- 2. 普通数据 ----
  const entry = createSerialLogEntry('RX', bytes, device.deviceId.toString());
  setSerialLogs(prev => [entry, ...prev].slice(0, MAX_LOG_ENTRIES));
  if (entry.parsedFields && Object.keys(entry.parsedFields).length > 0) {
    handleParsedFields(entry.parsedFields);
  }
});


      // 速率统计（每1秒）
      statsTimerRef.current = setInterval(() => {
        const rx = rxBytesBuffer.current;
        const tx = txBytesBuffer.current;
        rxBytesBuffer.current = 0;
        txBytesBuffer.current = 0;
        setSerialStats(prev => ({
          ...prev,
          rxRate: rx,
          txRate: tx,
          totalRxBytes: prev.totalRxBytes + rx,
          totalTxBytes: prev.totalTxBytes + tx,
        }));
      }, 1000);

      resetDataTimeout();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '连接失败';
      setSerialError(`串口连接失败：${msg}`);
    } finally {
      setIsConnecting(false);
    }
  }, [handleParsedFields, resetDataTimeout]);

  // ============ 断开串口 ============
  const disconnectSerial = useCallback(async () => {
    stopAllTasks();
    const dev = connectedDeviceRef.current;
    if (usbSerialRef.current) {
      try {
        await usbSerialRef.current.close();
      } catch { /* 忽略关闭错误 */ }
      usbSerialRef.current = null;
    }
    if (dev) {
      const alert = createSerialAlert('SERIAL_DISCONNECTED', dev.deviceId.toString(), dev.displayName, settingsRef.current);
      setSerialAlerts(a => [alert, ...a].slice(0, 200));
    }
    connectedDeviceRef.current = null;
    setConnectedSerial(null);
    setSerialDevices(prev => prev.map(d => ({ ...d, isConnected: false })));
    setSerialStats(DEFAULT_STATS);
    thermalModeRef.current = 'unknown';
    thermalBufferRef.current = [];
    thermalPendingRef.current = null;
    if (thermalTimerRef.current) {
      clearTimeout(thermalTimerRef.current);
      thermalTimerRef.current = null;
    }
  }, [stopAllTasks]);

  // ============ 发送数据 ============
  const sendSerialData = useCallback(async (input: string) => {
    const serial = usbSerialRef.current;
    const dev = connectedDeviceRef.current;
    if (!serial || !dev) return;
    const bytes = parseInputToBytes(input);
    if (bytes.length === 0) return;
    const hexStr = bytesToHexStr(bytes);
    try {
      await serial.send(hexStr);
      const entry = createSerialLogEntry('TX', bytes, dev.deviceId.toString());
      setSerialLogs(prev => [entry, ...prev].slice(0, MAX_LOG_ENTRIES));
      txBytesBuffer.current += bytes.length;
      setSerialStats(prev => ({ ...prev, totalTxBytes: prev.totalTxBytes + bytes.length }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '发送失败';
      setSerialError(`串口发送失败：${msg}`);
    }
  }, []);

  // ============ 清空操作 ============
  const clearSerialLogs = useCallback(() => setSerialLogs([]), []);
  const clearSerialAlerts = useCallback(() => setSerialAlerts([]), []);

  // ============ 报警规则 CRUD ============
  const addSerialAlertRule = useCallback((rule: Omit<import('./types').DataAlertRule, 'id'>) => {
    setAlertRules(prev => [...prev, { ...rule, id: `serial-rule-${genId()}` }]);
  }, []);
  const updateSerialAlertRule = useCallback((id: string, patch: Partial<import('./types').DataAlertRule>) => {
    setAlertRules(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  }, []);
  const deleteSerialAlertRule = useCallback((id: string) => {
    setAlertRules(prev => prev.filter(r => r.id !== id));
  }, []);

  // ============ 卸载清理 ============
  useEffect(() => {
    return () => {
      stopAllTasks();
      usbSerialRef.current?.close().catch(() => {});
    };
  }, [stopAllTasks]);

  const value: SerialContextType = {
    serialDevices,
    connectedSerial,
    isDiscovering,
    isConnecting,
    serialError,
    serialLogs,
    serialAlerts,
    serialStats,
    serialParsedFields,
    discoverDevices,
    connectSerial,
    disconnectSerial,
    sendSerialData,
    clearSerialLogs,
    clearSerialAlerts,
    updateSerialAlertRule,
    deleteSerialAlertRule,
    addSerialAlertRule,
    latestThermalFrame,
    latestThermalDataUri,
    thermalFrames,
    isConnected: connectedSerial !== null,
  };

  return <SerialContext.Provider value={value}>{children}</SerialContext.Provider>;
}
