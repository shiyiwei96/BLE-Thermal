/**
 * 蓝牙全局状态管理 Context
 * 使用 react-native-ble-plx 实现真实 BLE 扫描、连接、通知订阅、数据写入
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
  FieldMapping,
  ParsedFieldState,
} from './types';
import { DEFAULT_BLE_UUID, DEFAULT_SERIAL_CONFIG } from './types';
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

// ============ Context 类型 ============
interface BleContextType extends BleState {
  bleReady: boolean;              // 蓝牙适配器是否就绪
  bleError: string | null;        // 蓝牙状态错误信息
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

  // 订阅/定时器引用
  const notifySubscriptionRef = useRef<Subscription | null>(null);
  const disconnectSubscriptionRef = useRef<Subscription | null>(null);
  const rssiTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dataTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 速率计算缓冲
  const rxBytesBufferRef = useRef<number>(0);
  const txBytesBufferRef = useRef<number>(0);
  const lastRssiAlertRef = useRef<number>(0);
  const ruleLastAlertRef = useRef<Record<string, number>>({});

  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const connectedDeviceRef = useRef<BleDevice | null>(null);
  useEffect(() => { connectedDeviceRef.current = connectedDevice; }, [connectedDevice]);

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

  // ============ 添加预警/日志 ============
  const addAlert = useCallback((entry: AlertEntry) => {
    setAlerts(prev => [entry, ...prev].slice(0, 200));
  }, []);

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
    }
  }, []);

  // ============ 重置数据超时定时器 ============
  const resetDataTimeout = useCallback(() => {
    if (dataTimeoutRef.current) clearTimeout(dataTimeoutRef.current);
    dataTimeoutRef.current = setTimeout(() => {
      const dev = connectedDeviceRef.current;
      if (!dev) return;
      const alert = createAlertEntry('DATA_TIMEOUT', dev, settingsRef.current);
      setAlerts(a => [alert, ...a].slice(0, 200));
    }, settingsRef.current.dataTimeoutSeconds * 1000);
  }, []);

  // ============ 停止所有后台任务 ============
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

  // ============ 扫描设备 ============
  const startScan = useCallback(async () => {
    if (isScanning) return;

    // Android 权限检查
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
            // 更新 RSSI
            const updated = [...prev];
            updated[exists] = { ...updated[exists], rssi: adapted.rssi };
            return updated;
          }
          return [...prev, adapted];
        });
      }
    });

    // 10 秒后自动停止扫描
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

  // ============ 连接设备 ============
  const connectDevice = useCallback(async (device: BleDevice) => {
    stopScan();
    setBleError(null);

    try {
      // 连接设备
      const connectedPlx = await bleManager.connectToDevice(device.id, {
        autoConnect: false,
        requestMTU: 512,
      });

      // 发现所有 Services 和 Characteristics
      await connectedPlx.discoverAllServicesAndCharacteristics();

      const adapted = adaptDevice(connectedPlx, true);
      setConnectedDevice(adapted);
      setDevices(prev => prev.map(d => d.id === device.id ? { ...d, isConnected: true } : d));
      setStats(DEFAULT_STATS);
      setParsedFields({});
      ruleLastAlertRef.current = {};

      const currentUuid = settingsRef.current.bleUuid;
      const serviceUuid = currentUuid.serviceUuid;
      const rxCharUuid = currentUuid.rxCharUuid;
      const txCharUuid = currentUuid.txCharUuid;

      // 订阅 RX 通知特征值
      notifySubscriptionRef.current = connectedPlx.monitorCharacteristicForService(
        serviceUuid,
        rxCharUuid,
        (error, characteristic) => {
          if (error) {
            // 连接断开会触发此回调，不重复处理
            return;
          }
          if (!characteristic?.value) return;

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

      // 监听连接断开
      disconnectSubscriptionRef.current = connectedPlx.onDisconnected((error) => {
        const dev = connectedDeviceRef.current;
        const detail = error ? error.message : '连接意外断开';
        const alert = createAlertEntry('CONNECTION_LOST', dev, settingsRef.current, detail);
        setAlerts(a => [alert, ...a].slice(0, 200));
        setConnectedDevice(null);
        setDevices(prev => prev.map(d => ({ ...d, isConnected: false })));
        setStats(DEFAULT_STATS);
        stopAllTasks();
      });

      // RSSI 定时读取（每 2 秒）
      rssiTimerRef.current = setInterval(async () => {
        try {
          const rssi = await connectedPlx.readRSSI();
          const rssiVal = rssi.rssi ?? -100;
          setConnectedDevice(prev => prev ? { ...prev, rssi: rssiVal } : prev);
          appendRssiHistory(rssiVal);

          // RSSI 预警
          const now = Date.now();
          if (
            rssiVal < settingsRef.current.rssiThreshold &&
            now - lastRssiAlertRef.current > 60000
          ) {
            lastRssiAlertRef.current = now;
            const dev = connectedDeviceRef.current;
            if (dev) addAlert(createAlertEntry('RSSI_WEAK', { ...dev, rssi: rssiVal }, settingsRef.current));
          }
        } catch { /* 读取 RSSI 失败忽略 */ }
      }, 2000);

      // 速率统计（每1秒）
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

      // 初始数据超时定时器
      resetDataTimeout();

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '连接失败';
      setBleError(`连接失败：${msg}`);
    }
  }, [stopScan, addLog, addAlert, appendRssiHistory, handleParsedFields, resetDataTimeout, stopAllTasks]);

  // ============ 断开设备 ============
  const disconnectDevice = useCallback(async () => {
    const dev = connectedDeviceRef.current;
    if (dev) {
      try {
        await bleManager.cancelDeviceConnection(dev.id);
      } catch { /* 忽略断开错误 */ }
    }
    stopAllTasks();
    setConnectedDevice(null);
    setDevices(prev => prev.map(d => ({ ...d, isConnected: false })));
    setStats(DEFAULT_STATS);
  }, [stopAllTasks]);

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
    }}>
      {children}
    </BleContext.Provider>
  );
}

export { BleContext };

