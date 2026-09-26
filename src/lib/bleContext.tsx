/**
 * 蓝牙全局状态管理 Context
 * 使用 react-native-ble-plx 实现真实 BLE 扫描、连接、通知订阅、数据写入
 * 支持同时连接最多 4 个设备（多设备管理）
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { resolveBleConfigOrDefault,resolveDataMode, type DeviceDataMode } from './types';
import { State as BleAdapterState, type Subscription } from 'react-native-ble-plx';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  AlertEntry,
  AppSettings,
  BleDevice,
  BleState,
  DataAlertRule,
  DataLogEntry,
  DataStats,
  DeviceColorLabel,
  DeviceRuntimeInfo,
  FieldMapping,
  ParsedFieldState,
  ImageTransferRecord,
  ImageTransferProgress,
  ThermalFrame,
  ThermalColormap,
} from './types';
import {
  DEFAULT_BLE_UUID,
  DEFAULT_SERIAL_CONFIG,
  DEFAULT_IMG_THERMAL_UUID,
  DEVICE_COLORS,
  MAX_CONNECTED_DEVICES,
} from './types';
import {
  DEFAULT_ALERT_RULES,
  DEFAULT_FIELD_MAPPINGS,
  adaptDevice,
  base64ToBytes,
  bytesToBase64,
  createAlertEntry,
  createLogEntry,
  evaluateThreshold,
  bleManager,
  genId,
  requestAndroidPermissions,
} from './bleService';
import {
  createFrameRecord,
  jpegBytesToDataUri,
  createImageRecord,
  createProgress,
  MAX_IMAGE_HISTORY,
} from './imageTransfer';
import {
  parseThermalFrame,
  renderThermalPixels,
  pixelsToDataUri,
  MAX_THERMAL_HISTORY,
} from './thermalAnalysis';
import { sendAlertNotification } from './notificationService';


// ============ 热相协议常量 ============
const THERMAL_W = 32;
const THERMAL_H = 24;
const THERMAL_DATA_BYTES = THERMAL_W * THERMAL_H * 2;  // 1536
const THERMAL_HEADER_LEN = 4;
const THERMAL_TAIL_LEN = 2;                              // 校验
const THERMAL_TOTAL_LEN = THERMAL_HEADER_LEN + THERMAL_DATA_BYTES + THERMAL_TAIL_LEN; // 1542
const THERMAL_OFFSET = -40;

/**
 * 解析 32×24 int16 温度矩阵（1536 字节）为 ThermalFrame
 * 协议：帧头 5A 06 02 00 + 1536B int16 小端 + 2B 校验
 * 温度公式：raw / 100 - 40
 */
function parseThermalInt16(bytes: number[]): ThermalFrame | null {
  if (bytes.length < THERMAL_DATA_BYTES) return null;

  const view = new DataView(new Uint8Array(bytes.slice(0, THERMAL_DATA_BYTES)).buffer);
  const raw: number[] = new Array(THERMAL_W * THERMAL_H);

  for (let i = 0; i < THERMAL_W * THERMAL_H; i++) {
    const v = view.getInt16(i * 2, true) / 100 + THERMAL_OFFSET;
    raw[i] = v;
  }

  // ---- 3×3 中值滤波去坏点 ----
  const tempData = new Array(THERMAL_W * THERMAL_H);
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


// ============ 默认值 ============
const DEFAULT_SETTINGS: AppSettings = {
  rssiThreshold: -80,
  dataTimeoutSeconds: 10,
  defaultFormat: 'HEX',
  saveLog: true,
  dataAlertRules: DEFAULT_ALERT_RULES,
  fieldMappings: DEFAULT_FIELD_MAPPINGS,
  bleUuid: DEFAULT_BLE_UUID,
  serialConfig: DEFAULT_SERIAL_CONFIG,
  imgThermalUuid: DEFAULT_IMG_THERMAL_UUID,
  thermalColormap: 'iron',
  thermalUnit: 'C',
  notificationsEnabled: false,
  autoCloudSync: false,
  temperatureAlertThreshold: 85,
  streamBufferSize: 3,
};

const DEFAULT_STATS: DataStats = {
  totalRxBytes: 0,
  totalTxBytes: 0,
  rxRate: 0,
  txRate: 0,
  rssiHistory: [],
};

const MAX_LOG_ENTRIES = 1000;
const MAX_RSSI_HISTORY = 60;
const MAX_FIELD_HISTORY = 60;
const MAX_TEMP_HISTORY = 120; // 每设备最多120个温度历史点

// ============ Context 类型 ============
interface BleContextType extends BleState {
  bleReady: boolean;
  bleError: string | null;
  startScan: () => Promise<void>;
  stopScan: () => void;
  connectDevice: (device: BleDevice) => Promise<void>;
  disconnectDevice: () => Promise<void>;
  sendData: (input: string) => Promise<void>;
  clearLogs: () => void;
  clearAlerts: () => void;
  updateSettings: (settings: Partial<AppSettings>) => void;
  // 报警规则管理
  addAlertRule: (rule: Omit<DataAlertRule, 'id'>) => void;
  updateAlertRule: (id: string, rule: Partial<DataAlertRule>) => void;
  deleteAlertRule: (id: string) => void;
  // 字段映射管理
  addFieldMapping: (mapping: FieldMapping) => void;
  updateFieldMapping: (fieldKey: string, mapping: Partial<FieldMapping>) => void;
  deleteFieldMapping: (fieldKey: string) => void;
  // 图传
  imageHistory: ImageTransferRecord[];
  imageProgress: ImageTransferProgress | null;
  clearImageHistory: () => void;
  latestImageDataUri: string | null;
  imageStreamMode: boolean;
  setImageStreamMode: (on: boolean) => void;
  // 热相
  thermalFrames: ThermalFrame[];
  latestThermalFrame: ThermalFrame | null;
  latestThermalDataUri: string | null;
  clearThermalFrames: () => void;
  // ── 多设备管理 ──
  connectedDevices: BleDevice[];
  activeDeviceId: string | null;
  deviceRuntimeInfo: Record<string, DeviceRuntimeInfo>;
  setActiveDeviceId: (deviceId: string) => void;
  connectAdditionalDevice: (device: BleDevice) => Promise<void>;
  disconnectSpecificDevice: (deviceId: string) => Promise<void>;
  disconnectAllDevices: () => Promise<void>;
  updateDeviceInfo: (deviceId: string, info: Partial<Pick<DeviceRuntimeInfo, 'customName' | 'colorLabel'>>) => void;
  /** 添加外部预警（来自模型比对等模块）*/
  addExternalAlert: (entry: AlertEntry) => void;
}

const BleContext = createContext<BleContextType | null>(null);

export function useBle(): BleContextType {
  const ctx = useContext(BleContext);
  if (!ctx) throw new Error('useBle must be used within BleProvider');
  return ctx;
}


/**
 * 判断一包数据是否为"可打印 ASCII 文本"
 * 文本数据包几乎全是可打印字符
 * 二进制 包极难凑出连续可打印字符
 */
function isPrintableAsciiPacket(bytes: number[]): boolean {
  if (bytes.length === 0) return false;
  let printable = 0;
  for (const b of bytes) {
    // 0x20(空格) ~ 0x7E(~)，加上 \r \n \t
    if ((b >= 0x20 && b <= 0x7E) || b === 0x0A || b === 0x0D || b === 0x09) {
      printable++;
    }
  }
  return printable / bytes.length >= 0.9;
}


// ===== 图传/视频流缓冲区 =====
const imageBufferRef = useRef<number[]>([]);
const imageLastRenderRef = useRef<number>(0);
const imageRenderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const imagePendingFrameRef = useRef<string | null>(null);
const dataModeRef = useRef<DeviceDataMode>('DATA');
// ===== 热相缓冲区 =====
const thermalBufferRef = useRef<number[]>([]);


// ============ BleProvider ============
export function BleProvider({ children }: { children: React.ReactNode }) {
  const [bleReady, setBleReady] = useState(false);
  const [bleError, setBleError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [devices, setDevices] = useState<BleDevice[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<BleDevice | null>(null);
  const [dataLogs, setDataLogs] = useState<DataLogEntry[]>([]);
  const [alerts, setAlerts] = useState<AlertEntry[]>([]);
  const [stats, setStats] = useState<DataStats>(DEFAULT_STATS);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [parsedFields, setParsedFields] = useState<Record<string, ParsedFieldState>>({});

  
  // ===== 图传状态 =====
  const [imageHistory, setImageHistory] = useState<ImageTransferRecord[]>([]);
  const [imageProgress, setImageProgress] = useState<ImageTransferProgress | null>(null);
  const imageProgressRef = useRef<ImageTransferProgress | null>(null);
  const [latestImageDataUri, setLatestImageDataUri] = useState<string | null>(null);
  const [imageStreamMode, setImageStreamMode] = useState(false);

  // ===== 热相状态 =====
  const [thermalFrames, setThermalFrames] = useState<ThermalFrame[]>([]);
  const [latestThermalFrame, setLatestThermalFrame] = useState<ThermalFrame | null>(null);
  const [latestThermalDataUri, setLatestThermalDataUri] = useState<string | null>(null);

  // ===== 多设备状态 =====
  const [connectedDevices, setConnectedDevices] = useState<BleDevice[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [deviceRuntimeInfo, setDeviceRuntimeInfo] = useState<Record<string, DeviceRuntimeInfo>>({});

  // 订阅/定时器引用（主设备）
  const notifySubscriptionRef = useRef<Subscription | null>(null);
  const disconnectSubscriptionRef = useRef<Subscription | null>(null);
  const rssiTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dataTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 副设备订阅 Map（deviceId → subscription数组）
  const secondarySubsRef = useRef<Map<string, Subscription[]>>(new Map());
  const secondaryRssiTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  // 速率计算缓冲
  const rxBytesBufferRef = useRef<number>(0);
  const txBytesBufferRef = useRef<number>(0);
  const lastRssiAlertRef = useRef<number>(0);
  const ruleLastAlertRef = useRef<Record<string, number>>({});
  const tempAlertLastRef = useRef<Record<string, number>>({});

  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const connectedDeviceRef = useRef<BleDevice | null>(null);
  useEffect(() => { connectedDeviceRef.current = connectedDevice; }, [connectedDevice]);

  const connectedDevicesRef = useRef<BleDevice[]>([]);
  useEffect(() => { connectedDevicesRef.current = connectedDevices; }, [connectedDevices]);

  // ============ 加载保存设置 ============
  useEffect(() => {
    AsyncStorage.getItem('ble_settings').then(raw => {
      if (raw) {
        try {
          const saved = JSON.parse(raw) as Partial<AppSettings>;
          setSettings(prev => ({ ...prev, ...saved }));
        } catch { /* 忽略解析错误 */ }
      }
    });
  }, []);

  const saveSettings = useCallback(async (s: AppSettings) => {
    await AsyncStorage.setItem('ble_settings', JSON.stringify(s));
  }, []);

  // ============ 监听蓝牙适配器状态 ============
  useEffect(() => {
    const sub = bleManager.onStateChange(state => {
      if (state === BleAdapterState.PoweredOn) {
        setBleReady(true);
        setBleError(null);
      } else if (state === BleAdapterState.PoweredOff) {
        setBleReady(false);
        setBleError('蓝牙未开启，请在系统设置中开启蓝牙');
      } else if (state === BleAdapterState.Unauthorized) {
        setBleReady(false);
        setBleError('蓝牙权限未授予，请前往设置授予权限');
      } else if (state === BleAdapterState.Unsupported) {
        setBleReady(false);
        setBleError('本设备不支持蓝牙');
      }
    }, true);
    return () => sub.remove();
  }, []);

  // ============ 通知辅助 ============
  const maybeNotify = useCallback((entry: AlertEntry) => {
    if (settingsRef.current.notificationsEnabled) {
      sendAlertNotification(entry.type, entry.deviceName, entry.detail);
    }
  }, []);

  // ============ 添加预警/日志 ============
  const addAlert = useCallback((entry: AlertEntry) => {
    setAlerts(prev => [entry, ...prev].slice(0, 200));
    maybeNotify(entry);
  }, [maybeNotify]);

  const addExternalAlert = useCallback((entry: AlertEntry) => {
    setAlerts(prev => [entry, ...prev].slice(0, 200));
    maybeNotify(entry);
  }, [maybeNotify]);

  const addLog = useCallback((entry: DataLogEntry) => {
    setDataLogs(prev => [entry, ...prev].slice(0, MAX_LOG_ENTRIES));
  }, []);

  const appendRssiHistory = useCallback((rssiValue: number) => {
    setStats(prev => ({
      ...prev,
      rssiHistory: [
        ...prev.rssiHistory,
        { timestamp: Date.now(), value: rssiValue },
      ].slice(-MAX_RSSI_HISTORY),
    }));
  }, []);

  // ============ 更新设备运行时信息（温度历史） ============
  const updateDeviceTempHistory = useCallback((
    deviceId: string,
    maxTemp: number, minTemp: number, avgTemp: number
  ) => {
    const now = Date.now();
    setDeviceRuntimeInfo(prev => {
      const info = prev[deviceId];
      if (!info) return prev;
      const newPoint = { ts: now, max: maxTemp, min: minTemp, avg: avgTemp };
      return {
        ...prev,
        [deviceId]: {
          ...info,
          latestTempMax: maxTemp,
          latestTempMin: minTemp,
          latestTempAvg: avgTemp,
          tempHistory: [...info.tempHistory, newPoint].slice(-MAX_TEMP_HISTORY),
        },
      };
    });

    // 温度超限告警
    const threshold = settingsRef.current.temperatureAlertThreshold;
    const lastTime = tempAlertLastRef.current[deviceId] ?? 0;
    if (maxTemp > threshold && Date.now() - lastTime > 60000) {
      tempAlertLastRef.current[deviceId] = Date.now();
      const dev = connectedDevicesRef.current.find(d => d.id === deviceId) ?? null;
      const entry = createAlertEntry('TEMPERATURE_HIGH', dev, settingsRef.current, `${maxTemp.toFixed(1)}`);
      setAlerts(a => [entry, ...a].slice(0, 200));
      maybeNotify(entry);
    }
  }, [maybeNotify]);

  // ============ 处理解析字段 + 触发报警 ============
  const handleParsedFields = useCallback((
    fields: Record<string, number>,
    device: BleDevice | null,
  ) => {
    if (Object.keys(fields).length === 0) return;

    setParsedFields(prev => {
      const next = { ...prev };
      for (const [key, value] of Object.entries(fields)) {
        const existing = next[key];
        next[key] = {
          key,
          value,
          timestamp: Date.now(),
          history: [
            ...(existing?.history ?? []),
            { timestamp: Date.now(), value },
          ].slice(-MAX_FIELD_HISTORY),
        };
      }
      return next;
    });

    const currentSettings = settingsRef.current;
    const now = Date.now();
    for (const rule of currentSettings.dataAlertRules) {
      if (!rule.enabled) continue;
      const fieldVal = fields[rule.fieldKey.toUpperCase()];
      if (fieldVal === undefined) continue;
      if (!evaluateThreshold(fieldVal, rule.operator, rule.value)) continue;

      const lastTime = ruleLastAlertRef.current[rule.id] ?? 0;
      if (now - lastTime < 30000) continue;
      ruleLastAlertRef.current[rule.id] = now;

      const detail = `字段 ${rule.fieldKey} = ${fieldVal}，${rule.operator} ${rule.value}`;
      const alert = createAlertEntry('DATA_THRESHOLD', device, currentSettings, detail);
      setAlerts(a => [alert, ...a].slice(0, 200));
      maybeNotify(alert);
    }
  }, [maybeNotify]);

  // ============ 重置数据超时定时器 ============
  const resetDataTimeout = useCallback(() => {
    if (dataTimeoutRef.current) clearTimeout(dataTimeoutRef.current);
    dataTimeoutRef.current = setTimeout(() => {
      const dev = connectedDeviceRef.current;
      if (!dev) return;
      const alert = createAlertEntry('DATA_TIMEOUT', dev, settingsRef.current);
      setAlerts(a => [alert, ...a].slice(0, 200));
      maybeNotify(alert);
    }, settingsRef.current.dataTimeoutSeconds * 1000);
  }, [maybeNotify]);

  // ============ 停止主设备后台任务 ============
  const stopAllTasks = useCallback(() => {
    notifySubscriptionRef.current?.remove();
    notifySubscriptionRef.current = null;
    disconnectSubscriptionRef.current?.remove();
    disconnectSubscriptionRef.current = null;
    if (rssiTimerRef.current) { clearInterval(rssiTimerRef.current); rssiTimerRef.current = null; }
    if (statsTimerRef.current) { clearInterval(statsTimerRef.current); statsTimerRef.current = null; }
    if (dataTimeoutRef.current) { clearTimeout(dataTimeoutRef.current); dataTimeoutRef.current = null; }
    rxBytesBufferRef.current = 0;
    txBytesBufferRef.current = 0;
  }, []);

  // ============ 停止副设备订阅 ============
  const stopSecondaryDevice = useCallback((deviceId: string) => {
    const subs = secondarySubsRef.current.get(deviceId) ?? [];
    subs.forEach(s => s.remove());
    secondarySubsRef.current.delete(deviceId);
    const t = secondaryRssiTimersRef.current.get(deviceId);
    if (t) { clearInterval(t); secondaryRssiTimersRef.current.delete(deviceId); }
  }, []);

  // ============ 为设备初始化 DeviceRuntimeInfo ============
  const initDeviceRuntimeInfo = useCallback((deviceId: string) => {
    setDeviceRuntimeInfo(prev => {
      if (prev[deviceId]) return prev;
      const usedColors = Object.values(prev).map(i => i.colorLabel);
      const color = (DEVICE_COLORS.find(c => !usedColors.includes(c)) ?? 'cyan') as DeviceColorLabel;
      return {
        ...prev,
        [deviceId]: { deviceId, colorLabel: color, tempHistory: [] },
      };
    });
  }, []);

  // ============ 扫描设备 ============
  const startScan = useCallback(async () => {
    if (isScanning) return;

    const hasPermission = await requestAndroidPermissions();
    if (!hasPermission) {
      setBleError('蓝牙权限未授予，请前往设置授予权限');
      return;
    }
    if (!bleReady) {
      setBleError('蓝牙未就绪，请确认蓝牙已开启');
      return;
    }

    setBleError(null);
    setIsScanning(true);
    setDevices([]);

    bleManager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error) {
        setIsScanning(false);
        setBleError(`扫描失败：${error.message}`);
        return;
      }
      if (device) {
        const adapted = adaptDevice(device);
        setDevices(prev => {
          const exists = prev.findIndex(d => d.id === adapted.id);
          if (exists >= 0) {
            const updated = [...prev];
            updated[exists] = { ...updated[exists], rssi: adapted.rssi };
            return updated;
          }
          return [...prev, adapted];
        });
      }
    });

    scanStopTimerRef.current = setTimeout(() => {
      bleManager.stopDeviceScan();
      setIsScanning(false);
    }, 10000);
  }, [isScanning, bleReady]);

  const stopScan = useCallback(() => {
    bleManager.stopDeviceScan();
    if (scanStopTimerRef.current) { clearTimeout(scanStopTimerRef.current); scanStopTimerRef.current = null; }
    setIsScanning(false);
  }, []);



  // ============ 图传帧处理（区分单帧/流模式） ============
const handleImageFrame = useCallback((dataUri: string) => {
  // 流模式：只更新最新帧，节流 10fps，不存历史
  if (imageStreamMode) {
    imagePendingFrameRef.current = dataUri;
    const now = Date.now();
    const RENDER_INTERVAL = 100;

    if (now - imageLastRenderRef.current >= RENDER_INTERVAL) {
      imageLastRenderRef.current = now;
      setLatestImageDataUri(dataUri);
      imagePendingFrameRef.current = null;
    } else if (!imageRenderTimerRef.current) {
      imageRenderTimerRef.current = setTimeout(() => {
        imageRenderTimerRef.current = null;
        if (imagePendingFrameRef.current) {
          imageLastRenderRef.current = Date.now();
          setLatestImageDataUri(imagePendingFrameRef.current);
          imagePendingFrameRef.current = null;
        }
      }, RENDER_INTERVAL - (now - imageLastRenderRef.current));
    }
    return;
  }

  // 单帧模式：存历史
  const record = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    receivedAt: Date.now(),
    totalChunks: 1,
    receivedChunks: 1,
    dataUri,
    isComplete: true,
  };
  setImageHistory(prev => [record, ...prev].slice(0, MAX_IMAGE_HISTORY));
  setLatestImageDataUri(dataUri);
}, [imageStreamMode]);

// ============ 图传数据切分（FF D9 边界） ============
const feedImageData = useCallback((bytes: number[]) => {
  try {
    const buf = imageBufferRef.current;
    buf.push(...bytes);

    while (true) {
      let endIdx = -1;
      for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i] === 0xFF && buf[i + 1] === 0xD9) {
          endIdx = i + 2;
          break;
        }
      }
      if (endIdx < 0) break;

      const frameBytes = buf.slice(0, endIdx);
      const isJpeg = frameBytes.length >= 2
        && frameBytes[0] === 0xFF && frameBytes[1] === 0xD8;

      const remaining = buf.slice(endIdx);
      buf.length = 0;
      buf.push(...remaining);

      if (isJpeg) {
        const dataUri = jpegBytesToDataUri(frameBytes);
        handleImageFrame(dataUri);
      }
    }

    // 溢出保护：512KB 没找到 FF D9 就清空
    if (imageBufferRef.current.length > 512 * 1024) {
      console.warn('图传缓冲区溢出，清空');
      imageBufferRef.current = [];
    }
  } catch (e) {
    console.log('图传切分错误:', e);
  }
}, [handleImageFrame]);

// 热相渲染节流
const thermalLastRenderRef = useRef<number>(0);
const thermalPendingRef = useRef<ThermalFrame | null>(null);
const thermalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const renderThermalNow = useCallback((frame: ThermalFrame) => {
  const colormap = settingsRef.current.thermalColormap as ThermalColormap;
  const pixels = renderThermalPixels(frame, colormap);
  const dataUri = pixelsToDataUri(pixels, frame.width, frame.height);

  setLatestThermalFrame(frame);
  setLatestThermalDataUri(dataUri);
  setThermalFrames(prev => [frame, ...prev].slice(0, MAX_THERMAL_HISTORY));
  updateDeviceTempHistory('primary', frame.maxTemp, frame.minTemp, frame.avgTemp);
}, [updateDeviceTempHistory]);

const handleThermalFrame = useCallback((tempBytes: number[]) => {
  try {
    const frame = parseThermalInt16(tempBytes);
    if (!frame) return;

    thermalPendingRef.current = frame;
    const now = Date.now();
    const INTERVAL = 100; // 10fps

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
  } catch (e) {
    console.log('热相处理错误:', e);
  }
}, [renderThermalNow]);


// ============ 热相数据切分（帧头 5A 06 02 00） ============
const feedThermalData = useCallback((bytes: number[]) => {
  const buf = thermalBufferRef.current;
  buf.push(...bytes);

  while (true) {
    // 找帧头 5A 06 02 00
    let headerIdx = -1;
    for (let i = 0; i <= buf.length - 4; i++) {
      if (buf[i] === 0x5A && buf[i+1] === 0x06 && buf[i+2] === 0x02 && buf[i+3] === 0x00) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) {
      if (buf.length > 3) {
        const keep = buf.slice(-3);
        buf.length = 0;
        buf.push(...keep);
      }
      break;
    }
    if (headerIdx > 0) buf.splice(0, headerIdx);

    // 数据不够一帧，等下一包
    if (buf.length < 4 + THERMAL_DATA_BYTES) break;

    // 提取 1536 字节温度数据
    const tempBytes = buf.slice(4, 4 + THERMAL_DATA_BYTES);
    buf.splice(0, 4 + THERMAL_DATA_BYTES);

    // 丢弃到下一个帧头之间的字节（校验/垃圾，长度不固定）
    let nextHeaderIdx = -1;
    for (let i = 0; i <= buf.length - 4; i++) {
      if (buf[i] === 0x5A && buf[i+1] === 0x06 && buf[i+2] === 0x02 && buf[i+3] === 0x00) {
        nextHeaderIdx = i;
        break;
      }
    }
    if (nextHeaderIdx > 0) buf.splice(0, nextHeaderIdx);

    handleThermalFrame(tempBytes);
  }

  if (buf.length > THERMAL_DATA_BYTES * 4) {
    console.warn('热相缓冲区溢出，清空');
    buf.length = 0;
  }
}, [handleThermalFrame]);




// =================回调函数// =================
  const _connectPrimary = useCallback(async (device: BleDevice) => {
  const connectedPlx = await bleManager.connectToDevice(device.id, {
    autoConnect: false,
    requestMTU: 512,
  });
  await connectedPlx.discoverAllServicesAndCharacteristics();

  const adapted = adaptDevice(connectedPlx, true);

  // 根据设备名选择 UUID 配置
  const deviceConfig = resolveBleConfigOrDefault(adapted.name);
  const serviceUuid = deviceConfig.serviceUuid;
  const rxCharUuid = deviceConfig.rxCharUuid;
  const { imageCharUuid, thermalCharUuid } = settingsRef.current.imgThermalUuid;

  // 根据设备名确定数据模式（仅用于初始值，运行时按字节自动判别）
  dataModeRef.current = resolveDataMode(adapted.name);

  setConnectedDevice(adapted);
  setDevices(prev => prev.map(d => d.id === device.id ? { ...d, isConnected: true } : d));
  setStats(DEFAULT_STATS);
  setParsedFields({});
  ruleLastAlertRef.current = {};

  // ================= 1. RX 订阅（自动分流） =================
  notifySubscriptionRef.current = connectedPlx.monitorCharacteristicForService(
    serviceUuid, rxCharUuid,
    (error, characteristic) => {
      if (error || !characteristic?.value) return;
      const bytes = base64ToBytes(characteristic.value);
      if (bytes.length === 0) return;

      rxBytesBufferRef.current += bytes.length;
      resetDataTimeout();

          // ============ 自动判别数据格式 ============

    // ---- 1. 图传（JPEG）----
    const isJpegStart = bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xD8;
    const isMidJpeg = imageBufferRef.current.length > 0;
    if (isJpegStart || isMidJpeg) {
      feedImageData(bytes);
      if (isJpegStart) {
        addLog(createLogEntry('RX', [0xFF, 0xD8], device.id));
      }
      return;
    }

    // ---- 2. 文本数据（可打印 ASCII）----
    if (isPrintableAsciiPacket(bytes)) {
      const logEntry = createLogEntry('RX', bytes, device.id);
      addLog(logEntry);
      if (logEntry.parsedFields && Object.keys(logEntry.parsedFields).length > 0) 
        handleParsedFields(logEntry.parsedFields, connectedDeviceRef.current);
      return;
    }

    // ---- 3. 热相 （二进制）----
    feedThermalData(bytes);
    return;
    }
    
  
);

  // ================= 2. 热相订阅（独立特征，两种设备都订阅） =================
  try {
    connectedPlx.monitorCharacteristicForService(
      serviceUuid, thermalCharUuid,
      (_err, characteristic) => {
        if (!characteristic?.value) return;
        try {
          const bytes = base64ToBytes(characteristic.value);
          const frame = parseThermalFrame(bytes);
          if (!frame) return;

          const colormap = settingsRef.current.thermalColormap;
          const pixels = renderThermalPixels(frame, colormap);
          const dataUri = pixelsToDataUri(pixels, frame.width, frame.height);

          setLatestThermalFrame(frame);
          setLatestThermalDataUri(dataUri);
          setThermalFrames(prev => [frame, ...prev].slice(0, MAX_THERMAL_HISTORY));
          updateDeviceTempHistory(device.id, frame.maxTemp, frame.minTemp, frame.avgTemp);
        } catch (e) {
          console.log('热相数据处理错误:', e);
        }
      }
    );
  } catch (e) {
    console.log('热相特征不存在，跳过:', e);
  }

  // ================= 3. 图传独立特征订阅（如果 imageCharUuid 与 rxCharUuid 不同） =================
  if (imageCharUuid && imageCharUuid.toLowerCase() !== rxCharUuid.toLowerCase()) {
    try {
      connectedPlx.monitorCharacteristicForService(
        serviceUuid, imageCharUuid,
        (_err, characteristic) => {
          if (!characteristic?.value) return;
          try {
            const bytes = base64ToBytes(characteristic.value);
            feedImageData(bytes);
          } catch (e) {
            console.log('图传特征处理错误:', e);
          }
        }
      );
    } catch (e) {
      console.log('图传特征不存在，跳过:', e);
    }
  }

  // ================= 4. 连接断开监听 =================
  disconnectSubscriptionRef.current = connectedPlx.onDisconnected((error) => {
    const dev = connectedDeviceRef.current;
    const detail = error ? error.message : '连接意外断开';
    const alert = createAlertEntry('CONNECTION_LOST', dev, settingsRef.current, detail);
    setAlerts(a => [alert, ...a].slice(0, 200));
    maybeNotify(alert);
    setConnectedDevice(null);
    setConnectedDevices(prev => prev.filter(d => d.id !== device.id));
    setActiveDeviceId(prev => {
      const remaining = connectedDevicesRef.current.filter(d => d.id !== device.id);
      return remaining.length > 0 ? remaining[0].id : null;
    });
    setDevices(prev => prev.map(d => d.id === device.id ? { ...d, isConnected: false } : d));
    setStats(DEFAULT_STATS);
    stopAllTasks();
    // 清空图传缓冲
    imageBufferRef.current = [];
  });

  // ================= 5. RSSI 定时读取 =================
  rssiTimerRef.current = setInterval(async () => {
    try {
      const rssi = await connectedPlx.readRSSI();
      const rssiVal = rssi.rssi ?? -100;
      setConnectedDevice(prev => prev ? { ...prev, rssi: rssiVal } : prev);
      setConnectedDevices(prev => prev.map(d => d.id === device.id ? { ...d, rssi: rssiVal } : d));
      appendRssiHistory(rssiVal);

      const now = Date.now();
      if (rssiVal < settingsRef.current.rssiThreshold && now - lastRssiAlertRef.current > 60000) {
        lastRssiAlertRef.current = now;
        const dev = connectedDeviceRef.current;
        if (dev) addAlert(createAlertEntry('RSSI_WEAK', { ...dev, rssi: rssiVal }, settingsRef.current));
      }
    } catch { /* 忽略 */ }
  }, 2000);

  // ================= 6. 速率统计 =================
  statsTimerRef.current = setInterval(() => {
    const rx = rxBytesBufferRef.current;
    const tx = txBytesBufferRef.current;
    rxBytesBufferRef.current = 0;
    txBytesBufferRef.current = 0;
    setStats(prev => ({
      ...prev,
      rxRate: rx,
      txRate: tx,
      totalRxBytes: prev.totalRxBytes + rx,
      totalTxBytes: prev.totalTxBytes + tx,
    }));
  }, 1000);

  resetDataTimeout();
  return adapted;
}, [
  stopAllTasks, addLog, addAlert, appendRssiHistory, handleParsedFields,
  resetDataTimeout, updateDeviceTempHistory, maybeNotify,
  feedImageData,feedThermalData,
]);


  // ============ 连接主设备（第一个设备） ============
  const connectDevice = useCallback(async (device: BleDevice) => {
    if (connectedDevicesRef.current.length >= MAX_CONNECTED_DEVICES) {
      setBleError(`已达到最大连接数（${MAX_CONNECTED_DEVICES}），请先断开其他设备`);
      return;
    }
    stopScan();
    setBleError(null);
    try {
      initDeviceRuntimeInfo(device.id);
      const adapted = await _connectPrimary(device);
      setConnectedDevices(prev => {
        const filtered = prev.filter(d => d.id !== device.id);
        return [...filtered, { ...adapted, isConnected: true }];
      });
      setActiveDeviceId(device.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '连接失败';
      setBleError(`连接失败：${msg}`);
    }
  }, [stopScan, _connectPrimary, initDeviceRuntimeInfo]);

  // ============ 追加连接副设备 ============
  const connectAdditionalDevice = useCallback(async (device: BleDevice) => {
    if (connectedDevicesRef.current.length >= MAX_CONNECTED_DEVICES) {
      setBleError(`已达到最大连接数（${MAX_CONNECTED_DEVICES}），请先断开其他设备`);
      return;
    }
    if (connectedDevicesRef.current.some(d => d.id === device.id)) {
      setBleError('该设备已连接');
      return;
    }
    stopScan();
    setBleError(null);
    try {
      initDeviceRuntimeInfo(device.id);
      const connectedPlx = await bleManager.connectToDevice(device.id, {
        autoConnect: false,
        requestMTU: 512,
      });
      await connectedPlx.discoverAllServicesAndCharacteristics();
      const adapted = adaptDevice(connectedPlx, true);

      const deviceConfig = resolveBleConfigOrDefault(adapted.name);
      const serviceUuid = deviceConfig.serviceUuid;
      const { thermalCharUuid } = settingsRef.current.imgThermalUuid;
      const subs: Subscription[] = [];

      // 仅订阅热相（副设备温度监测）
      let thermalSub: Subscription | null = null;
       try {
        thermalSub = connectedPlx.monitorCharacteristicForService(
        serviceUuid, thermalCharUuid,
        (_err, characteristic) => {
          if (!characteristic?.value) return;
          const bytes = base64ToBytes(characteristic.value);
          const frame = parseThermalFrame(bytes);
          if (!frame) return;
          updateDeviceTempHistory(device.id, frame.maxTemp, frame.minTemp, frame.avgTemp);
        }
      );
      } catch (e)
      {
       console.log('副设备热相特征不存在，跳过:', e);
      }
      if (thermalSub) subs.push(thermalSub);

      // 断开监听
      const discSub = connectedPlx.onDisconnected(() => {
        stopSecondaryDevice(device.id);
        setConnectedDevices(prev => prev.filter(d => d.id !== device.id));
        setDevices(prev => prev.map(d => d.id === device.id ? { ...d, isConnected: false } : d));
      });
      subs.push(discSub);
      secondarySubsRef.current.set(device.id, subs);

      // RSSI 读取（每 3 秒）
      const rssiTimer = setInterval(async () => {
        try {
          const rssi = await connectedPlx.readRSSI();
          const rssiVal = rssi.rssi ?? -100;
          setConnectedDevices(prev => prev.map(d => d.id === device.id ? { ...d, rssi: rssiVal } : d));
        } catch { /* 忽略 */ }
      }, 3000);
      secondaryRssiTimersRef.current.set(device.id, rssiTimer);

      setConnectedDevices(prev => {
        const filtered = prev.filter(d => d.id !== device.id);
        return [...filtered, { ...adapted, isConnected: true }];
      });
      setDevices(prev => prev.map(d => d.id === device.id ? { ...d, isConnected: true } : d));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '连接失败';
      setBleError(`连接副设备失败：${msg}`);
    }
  }, [stopScan, initDeviceRuntimeInfo, stopSecondaryDevice, updateDeviceTempHistory]);

  // ============ 断开特定设备 ============
  const disconnectSpecificDevice = useCallback(async (deviceId: string) => {
    const isActive = activeDeviceId === deviceId;
    try { await bleManager.cancelDeviceConnection(deviceId); } catch { /* 忽略 */ }

    if (isActive) {
      stopAllTasks();
      setConnectedDevice(null);
      setStats(DEFAULT_STATS);
    } else {
      stopSecondaryDevice(deviceId);
    }

    setConnectedDevices(prev => {
      const next = prev.filter(d => d.id !== deviceId);
      if (isActive && next.length > 0) {
        setActiveDeviceId(next[0].id);
      } else if (isActive) {
        setActiveDeviceId(null);
      }
      return next;
    });
    setDevices(prev => prev.map(d => d.id === deviceId ? { ...d, isConnected: false } : d));
  }, [activeDeviceId, stopAllTasks, stopSecondaryDevice]);

  // ============ 断开所有设备 ============
  const disconnectAllDevices = useCallback(async () => {
    const all = connectedDevicesRef.current;
    await Promise.all(all.map(d => bleManager.cancelDeviceConnection(d.id).catch(() => {})));
    stopAllTasks();
    all.forEach(d => stopSecondaryDevice(d.id));
    setConnectedDevice(null);
    setConnectedDevices([]);
    setActiveDeviceId(null);
    setDevices(prev => prev.map(d => ({ ...d, isConnected: false })));
    setStats(DEFAULT_STATS);
  }, [stopAllTasks, stopSecondaryDevice]);

  // ============ 更新设备自定义信息 ============
  const updateDeviceInfo = useCallback((
    deviceId: string,
    info: Partial<Pick<DeviceRuntimeInfo, 'customName' | 'colorLabel'>>
  ) => {
    setDeviceRuntimeInfo(prev => {
      const existing = prev[deviceId] ?? { deviceId, colorLabel: 'cyan' as DeviceColorLabel, tempHistory: [] };
      return { ...prev, [deviceId]: { ...existing, ...info } };
    });
  }, []);

  // ============ 断开设备（主/活动设备） ============
  const disconnectDevice = useCallback(async () => {
    if (activeDeviceId) {
      await disconnectSpecificDevice(activeDeviceId);
    } else {
      // 兼容：断开单一设备
      const dev = connectedDeviceRef.current;
      if (dev) await disconnectSpecificDevice(dev.id);
    }
  }, [activeDeviceId, disconnectSpecificDevice]);

  // ============ 发送数据 ============
  const sendData = useCallback(async (input: string) => {
    const dev = connectedDeviceRef.current;
    if (!dev) return;

    let bytes: number[];
    const hexPattern = /^[0-9A-Fa-f\s]+$/;
    if (hexPattern.test(input.trim()) && input.trim().replace(/\s/g, '').length % 2 === 0) {
      bytes = input.trim().split(/\s+/).flatMap(h => {
        const b = parseInt(h, 16);
        return isNaN(b) ? [] : [b];
      });
    } else {
      bytes = Array.from(input).map(c => c.charCodeAt(0));
    }
    if (bytes.length === 0) return;

    const b64 = bytesToBase64(bytes);
    const deviceConfig = resolveBleConfigOrDefault(dev.name);
    const serviceUuid = deviceConfig.serviceUuid;
    const txCharUuid = deviceConfig.txCharUuid;
    
    try {
      await bleManager.writeCharacteristicWithoutResponseForDevice(dev.id, serviceUuid, txCharUuid, b64);
      const entry = createLogEntry('TX', bytes, dev.id);
      addLog(entry);
      txBytesBufferRef.current += bytes.length;
      setStats(prev => ({ ...prev, totalTxBytes: prev.totalTxBytes + bytes.length }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '发送失败';
      setBleError(`发送失败：${msg}`);
    }
  }, [addLog]);

  // ============ 清空操作 ============
  const clearLogs = useCallback(() => setDataLogs([]), []);
  const clearAlerts = useCallback(() => setAlerts([]), []);
  const clearImageHistory = useCallback(() => {
    setImageHistory([]);
    setImageProgress(null);
    imageProgressRef.current = null;
  }, []);
  const clearThermalFrames = useCallback(() => {
    setThermalFrames([]);
    setLatestThermalFrame(null);
    setLatestThermalDataUri(null);
  }, []);

  // ============ 更新设置 ============
  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...partial };
      saveSettings(next);
      return next;
    });
  }, [saveSettings]);

  // ============ 报警规则管理 ============
  const addAlertRule = useCallback((rule: Omit<DataAlertRule, 'id'>) => {
    setSettings(prev => {
      const next = { ...prev, dataAlertRules: [...prev.dataAlertRules, { ...rule, id: genId() }] };
      saveSettings(next);
      return next;
    });
  }, [saveSettings]);

  const updateAlertRule = useCallback((id: string, partial: Partial<DataAlertRule>) => {
    setSettings(prev => {
      const next = {
        ...prev,
        dataAlertRules: prev.dataAlertRules.map(r => r.id === id ? { ...r, ...partial } : r),
      };
      saveSettings(next);
      return next;
    });
  }, [saveSettings]);

  const deleteAlertRule = useCallback((id: string) => {
    setSettings(prev => {
      const next = { ...prev, dataAlertRules: prev.dataAlertRules.filter(r => r.id !== id) };
      saveSettings(next);
      return next;
    });
  }, [saveSettings]);

  // ============ 字段映射管理 ============
  const addFieldMapping = useCallback((mapping: FieldMapping) => {
    setSettings(prev => {
      if (prev.fieldMappings.some(m => m.fieldKey === mapping.fieldKey)) return prev;
      const next = { ...prev, fieldMappings: [...prev.fieldMappings, mapping] };
      saveSettings(next);
      return next;
    });
  }, [saveSettings]);

  const updateFieldMapping = useCallback((fieldKey: string, partial: Partial<FieldMapping>) => {
    setSettings(prev => {
      const next = {
        ...prev,
        fieldMappings: prev.fieldMappings.map(m => m.fieldKey === fieldKey ? { ...m, ...partial } : m),
      };
      saveSettings(next);
      return next;
    });
  }, [saveSettings]);

  const deleteFieldMapping = useCallback((fieldKey: string) => {
    setSettings(prev => {
      const next = { ...prev, fieldMappings: prev.fieldMappings.filter(m => m.fieldKey !== fieldKey) };
      saveSettings(next);
      return next;
    });
  }, [saveSettings]);

  // ============ 清理 ============
  useEffect(() => {
    return () => {
      stopAllTasks();
      secondarySubsRef.current.forEach((subs) => subs.forEach(s => s.remove()));
      secondaryRssiTimersRef.current.forEach(t => clearInterval(t));
      if (scanStopTimerRef.current) clearTimeout(scanStopTimerRef.current);
    };
  }, [stopAllTasks]);

  return (
    <BleContext.Provider value={{
      bleReady,
      bleError,
      isScanning,
      devices,
      connectedDevice,
      dataLogs,
      alerts,
      stats,
      settings,
      parsedFields,
      startScan,
      stopScan,
      connectDevice,
      disconnectDevice,
      sendData,
      clearLogs,
      clearAlerts,
      updateSettings,
      addAlertRule,
      updateAlertRule,
      deleteAlertRule,
      addFieldMapping,
      updateFieldMapping,
      deleteFieldMapping,
      // 图传
      imageHistory,
      imageProgress,
      clearImageHistory,
      latestImageDataUri,
      imageStreamMode,
      setImageStreamMode,
      // 热相
      thermalFrames,
      latestThermalFrame,
      latestThermalDataUri,
      clearThermalFrames,
      // 多设备
      connectedDevices,
      activeDeviceId,
      deviceRuntimeInfo,
      setActiveDeviceId,
      connectAdditionalDevice,
      disconnectSpecificDevice,
      disconnectAllDevices,
      updateDeviceInfo,
      addExternalAlert,
    }}>
      {children}
    </BleContext.Provider>
  );
}

export { BleContext };
