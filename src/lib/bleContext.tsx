/**
 * 蓝牙全局状态管理 Context
 * 使用 react-native-ble-plx 实现真实 BLE 扫描、连接、通知订阅、数据写入
 * 支持同时连接最多 4 个设备（多设备管理）
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
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
  parseImageChunk,
  mergeChunks,
  createProgress,
  createImageRecord,
  MAX_IMAGE_HISTORY,
} from './imageTransfer';
import {
  parseThermalFrame,
  renderThermalPixels,
  pixelsToDataUri,
  MAX_THERMAL_HISTORY,
} from './thermalAnalysis';
import { sendAlertNotification } from './notificationService';

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

  // ============ 内部：连接设备并设置主状态 ============
  const _connectPrimary = useCallback(async (device: BleDevice) => {
    const connectedPlx = await bleManager.connectToDevice(device.id, {
      autoConnect: false,
      requestMTU: 512,
    });
    await connectedPlx.discoverAllServicesAndCharacteristics();

    const adapted = adaptDevice(connectedPlx, true);
    setConnectedDevice(adapted);
    setDevices(prev => prev.map(d => d.id === device.id ? { ...d, isConnected: true } : d));
    setStats(DEFAULT_STATS);
    setParsedFields({});
    ruleLastAlertRef.current = {};

    const currentUuid = settingsRef.current.bleUuid;
    const { serviceUuid, rxCharUuid } = currentUuid;
    const { imageCharUuid, thermalCharUuid } = settingsRef.current.imgThermalUuid;

    // 订阅 RX
    notifySubscriptionRef.current = connectedPlx.monitorCharacteristicForService(
      serviceUuid, rxCharUuid,
      (error, characteristic) => {
        if (error || !characteristic?.value) return;
        const bytes = base64ToBytes(characteristic.value);
        const logEntry = createLogEntry('RX', bytes, device.id);
        addLog(logEntry);
        rxBytesBufferRef.current += bytes.length;
        if (logEntry.parsedFields && Object.keys(logEntry.parsedFields).length > 0) {
          handleParsedFields(logEntry.parsedFields, connectedDeviceRef.current);
        }
        resetDataTimeout();
      }
    );

    // 订阅图传
    connectedPlx.monitorCharacteristicForService(
      serviceUuid, imageCharUuid,
      (_err, characteristic) => {
        if (!characteristic?.value) return;
        const bytes = base64ToBytes(characteristic.value);
        const chunk = parseImageChunk(bytes);
        if (!chunk) return;

        const prev = imageProgressRef.current;
        const isNewTransfer = !prev || prev.totalChunks !== chunk.total;
        const progress: ImageTransferProgress = isNewTransfer
          ? createProgress(chunk.total)
          : { ...prev, chunks: { ...prev.chunks } };

        if (!progress.chunks[chunk.index]) {
          progress.chunks[chunk.index] = chunk.payload;
          progress.receivedChunks = Object.keys(progress.chunks).length;
        }
        imageProgressRef.current = progress;
        setImageProgress({ ...progress });

        if (progress.receivedChunks >= progress.totalChunks) {
          const dataUri = mergeChunks(progress);
          if (dataUri) {
            const record = createImageRecord(genId(), dataUri, progress);
            setImageHistory(prev => [record, ...prev].slice(0, MAX_IMAGE_HISTORY));
          }
          imageProgressRef.current = null;
          setImageProgress(null);
        }
      }
    );

    // 订阅热相
    connectedPlx.monitorCharacteristicForService(
      serviceUuid, thermalCharUuid,
      (_err, characteristic) => {
        if (!characteristic?.value) return;
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
      }
    );

    // 连接断开监听
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
    });

    // RSSI 定时读取
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

    // 速率统计
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
  }, [stopAllTasks, addLog, addAlert, appendRssiHistory, handleParsedFields,
      resetDataTimeout, updateDeviceTempHistory, maybeNotify]);

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

      const { serviceUuid } = settingsRef.current.bleUuid;
      const { thermalCharUuid } = settingsRef.current.imgThermalUuid;
      const subs: Subscription[] = [];

      // 仅订阅热相（副设备温度监测）
      const thermalSub = connectedPlx.monitorCharacteristicForService(
        serviceUuid, thermalCharUuid,
        (_err, characteristic) => {
          if (!characteristic?.value) return;
          const bytes = base64ToBytes(characteristic.value);
          const frame = parseThermalFrame(bytes);
          if (!frame) return;
          updateDeviceTempHistory(device.id, frame.maxTemp, frame.minTemp, frame.avgTemp);
        }
      );
      subs.push(thermalSub);

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
    const { txCharUuid, serviceUuid } = settingsRef.current.bleUuid;

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
