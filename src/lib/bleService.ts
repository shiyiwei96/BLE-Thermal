/**
 * BLE 服务层
 * 封装 react-native-ble-plx 的真实蓝牙操作，
 * 以及通用数据格式转换、解析和预警工具函数。
 */
import { BleManager, type Device as BleDevice_PLX } from 'react-native-ble-plx';
import { Platform } from 'react-native';
import type {
  AlertEntry,
  AlertType,
  AppSettings,
  BleDevice,
  DataAlertRule,
  DataLogEntry,
  FieldMapping,
  ThresholdOperator,
} from './types';
import { DEFAULT_BLE_UUID } from './types';

// ============ BleManager 单例 ============
export const bleManager = new BleManager();

// ============ 工具函数 ============
let _idCounter = 0;
export function genId(): string {
  return `${Date.now()}-${(++_idCounter).toString(36)}`;
}

// ============ 权限工具 ============
/**
 * 请求蓝牙所需的 Android 运行时权限
 * iOS 权限通过 app.json info.plist 声明，系统自动弹框
 */
export async function requestAndroidPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const { PermissionsAndroid } = await import('react-native');
  const apiLevel = parseInt(String(Platform.Version), 10);

  if (apiLevel < 31) {
    // Android < 12：只需位置权限
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title: '位置权限',
        message: '扫描蓝牙设备需要位置权限',
        buttonNeutral: '稍后再说',
        buttonNegative: '拒绝',
        buttonPositive: '授予',
      }
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }

  // Android 12+：BLUETOOTH_SCAN + BLUETOOTH_CONNECT
  const results = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  ]);
  return (
    results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED &&
    results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED
  );
}

// ============ 设备对象适配 ============
export function adaptDevice(device: BleDevice_PLX, connected = false): BleDevice {
  return {
    id: device.id,
    name: device.name ?? device.localName ?? null,
    rssi: device.rssi ?? -100,
    isConnected: connected,
    address: device.id, // iOS 为 UUID，Android 为 MAC 地址
  };
}

// ============ Base64 与字节数组互转 ============
export function base64ToBytes(base64: string): number[] {
  const binaryStr = atob(base64);
  const bytes: number[] = [];
  for (let i = 0; i < binaryStr.length; i++) {
    bytes.push(binaryStr.charCodeAt(i));
  }
  return bytes;
}

export function bytesToBase64(bytes: number[]): string {
  const binaryStr = bytes.map(b => String.fromCharCode(b)).join('');
  return btoa(binaryStr);
}

// ============ 数据格式转换 ============
export function bytesToHex(bytes: number[]): string {
  return bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

export function bytesToAscii(bytes: number[]): string {
  return bytes.map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
}

export function hexStringToBytes(hexStr: string): number[] {
  const cleaned = hexStr.replace(/\s+/g, '');
  const result: number[] = [];
  for (let i = 0; i < cleaned.length; i += 2) {
    const byte = parseInt(cleaned.slice(i, i + 2), 16);
    if (!isNaN(byte)) result.push(byte);
  }
  return result;
}

export function asciiStringToBytes(str: string): number[] {
  return Array.from(str).map(c => c.charCodeAt(0));
}

// ============ 数据分组解析 ============
/**
 * 解析形如 "T:25.3,D:1024,S:60" 的分组数据字符串
 * 返回 Record<字段名大写, 数值>，解析失败返回空对象
 */
export function parseGroupedData(text: string): Record<string, number> {
  const result: Record<string, number> = {};
  const pattern = /([A-Za-z][A-Za-z0-9]*)\s*:\s*(-?\d+(?:\.\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const key = match[1].toUpperCase();
    const val = parseFloat(match[2]);
    if (!isNaN(val)) result[key] = val;
  }
  return result;
}

export function parseBytesAsGrouped(bytes: number[]): Record<string, number> {
  const text = bytes.map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '').join('');
  return parseGroupedData(text);
}

export function hasGroupedFormat(bytes: number[]): boolean {
  const text = bytes.map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '').join('');
  return /[A-Za-z][A-Za-z0-9]*\s*:\s*-?\d/.test(text);
}

// ============ 阈值运算符判断 ============
export function evaluateThreshold(value: number, operator: ThresholdOperator, threshold: number): boolean {
  switch (operator) {
    case '>':  return value > threshold;
    case '<':  return value < threshold;
    case '>=': return value >= threshold;
    case '<=': return value <= threshold;
    case '==': return Math.abs(value - threshold) < 0.0001;
    default:   return false;
  }
}

// ============ 预警文案 ============
export function getAlertDetail(type: AlertType, device: BleDevice | null, extra?: string): string {
  const name = device?.name ?? device?.address ?? '未知设备';
  switch (type) {
    case 'RSSI_WEAK':
      return `设备 ${name} 信号强度 ${extra} dBm，低于预警阈值`;
    case 'DATA_TIMEOUT':
      return `设备 ${name} 超过 ${extra} 秒未收到数据`;
    case 'CONNECTION_LOST':
      return `与设备 ${name} 的连接意外断开`;
    case 'DATA_THRESHOLD':
      return `设备 ${name} 数据字段报警：${extra}`;
    case 'SIMILARITY_DROP':
      return `模型比对相似度骤降：当前评分 ${extra} 分，低于告警阈值`;
    case 'TEMPERATURE_HIGH':
      return `设备 ${name} 温度超限：当前 ${extra} ℃`;
    default:
      return `设备 ${name} 发生预警：${extra ?? ''}`;
  }
}

// ============ 创建数据日志条目 ============
export function createLogEntry(
  direction: 'RX' | 'TX',
  rawData: number[],
  deviceId: string
): DataLogEntry {
  const entry: DataLogEntry = {
    id: genId(),
    timestamp: Date.now(),
    direction,
    rawData,
    deviceId,
  };
  if (direction === 'RX') {
    const parsed = parseBytesAsGrouped(rawData);
    if (Object.keys(parsed).length > 0) entry.parsedFields = parsed;
  }
  return entry;
}

// ============ 创建预警记录 ============
export function createAlertEntry(
  type: AlertType,
  device: BleDevice | null,
  settings: AppSettings,
  extraDetail?: string
): AlertEntry {
  let detail = '';
  if (type === 'RSSI_WEAK' && device) {
    detail = getAlertDetail(type, device, device.rssi.toString());
  } else if (type === 'DATA_TIMEOUT') {
    detail = getAlertDetail(type, device, settings.dataTimeoutSeconds.toString());
  } else if (type === 'CONNECTION_LOST') {
    detail = getAlertDetail(type, device);
  } else if (type === 'DATA_THRESHOLD') {
    detail = getAlertDetail(type, device, extraDetail ?? '');
  }
  return {
    id: genId(),
    timestamp: Date.now(),
    type,
    deviceId: device?.id ?? '',
    deviceName: device?.name ?? device?.address ?? null,
    detail,
  };
}

// ============ 信号强度评级 ============
export type SignalStrength = 'excellent' | 'good' | 'fair' | 'weak' | 'critical';

export function getRssiLevel(rssi: number): SignalStrength {
  if (rssi >= -50) return 'excellent';
  if (rssi >= -60) return 'good';
  if (rssi >= -70) return 'fair';
  if (rssi >= -80) return 'weak';
  return 'critical';
}

export function getRssiLabel(rssi: number): string {
  const level = getRssiLevel(rssi);
  const labels: Record<SignalStrength, string> = {
    excellent: '极强', good: '良好', fair: '一般', weak: '较弱', critical: '极弱',
  };
  return labels[level];
}

export function getRssiColor(rssi: number): string {
  const level = getRssiLevel(rssi);
  const colors: Record<SignalStrength, string> = {
    excellent: '#00E5FF', good: '#00B4CC', fair: '#FFB300', weak: '#FF6B00', critical: '#FF3333',
  };
  return colors[level];
}

// ============ 默认字段映射 ============
export const DEFAULT_FIELD_MAPPINGS: FieldMapping[] = [
  { fieldKey: 'T', label: '温度', unit: '℃' },
  { fieldKey: 'H', label: '湿度', unit: '%RH' },
  { fieldKey: 'D', label: '数字量', unit: '' },
  { fieldKey: 'S', label: '转速', unit: 'rpm' },
  { fieldKey: 'V', label: '电压', unit: 'V' },
];

export const DEFAULT_ALERT_RULES: DataAlertRule[] = [
  { id: 'rule-t-high', fieldKey: 'T', operator: '>', value: 80, enabled: true },
  { id: 'rule-t-low',  fieldKey: 'T', operator: '<', value: 0,  enabled: true },
  { id: 'rule-v-low',  fieldKey: 'V', operator: '<', value: 3.0, enabled: true },
];

// ============ BLE UUID 工具 ============
/** 统一转大写便于 iOS/Android 匹配 */
export function normalizeUuid(uuid: string): string {
  return uuid.toUpperCase();
}

