/**
 * USB 串口服务层
 * 封装 react-native-usb-serialport-for-android 的操作工具函数
 * 仅支持 Android（iOS 不支持 USB Host）
 */
import { Platform } from 'react-native';
import type { Device as RNSerialDevice } from 'react-native-usb-serialport-for-android';
import type { SerialDevice, SerialConfig, AppSettings, AlertEntry, DataLogEntry } from './types';
import { DEFAULT_SERIAL_CONFIG } from './types';
import { genId, parseBytesAsGrouped, createLogEntry as bleCreateLogEntry } from './bleService';

// ============ 平台检查 ============
export const isSerialSupported = Platform.OS === 'android';

// ============ 设备适配 ============
export function adaptSerialDevice(dev: RNSerialDevice, connected = false): SerialDevice {
  return {
    deviceId: dev.deviceId,
    vendorId: dev.vendorId,
    productId: dev.productId,
    displayName: `USB设备 ${dev.vendorId.toString(16).toUpperCase().padStart(4, '0')}:${dev.productId.toString(16).toUpperCase().padStart(4, '0')}`,
    isConnected: connected,
  };
}

// ============ 十六进制工具 ============
/** 将字节数组转为十六进制字符串（用于发送） */
export function bytesToHexStr(bytes: number[]): string {
  return bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');
}

/** 将十六进制字符串解析为字节数组 */
export function hexStrToBytes(hexStr: string): number[] {
  const clean = hexStr.replace(/\s/g, '');
  if (clean.length % 2 !== 0) return [];
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    const byte = parseInt(clean.slice(i, i + 2), 16);
    if (!isNaN(byte)) bytes.push(byte);
  }
  return bytes;
}

/** 将十六进制字符串（收到的数据）转为字节数组 */
export function hexDataToBytes(hexStr: string): number[] {
  return hexStrToBytes(hexStr);
}

// ============ 串口输入解析 ============
/** 将用户输入（十六进制或ASCII）转为字节数组 */
export function parseInputToBytes(input: string): number[] {
  const trimmed = input.trim();
  const hexPattern = /^[0-9A-Fa-f\s]+$/;
  if (hexPattern.test(trimmed) && trimmed.replace(/\s/g, '').length % 2 === 0) {
    return trimmed.split(/\s+/).flatMap(h => {
      const b = parseInt(h, 16);
      return isNaN(b) ? [] : [b];
    });
  }
  // ASCII 模式
  return Array.from(trimmed).map(c => c.charCodeAt(0));
}

// ============ 创建串口数据日志条目 ============
export function createSerialLogEntry(
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
    channel: 'SERIAL',
  };
  if (direction === 'RX') {
    const parsed = parseBytesAsGrouped(rawData);
    if (Object.keys(parsed).length > 0) entry.parsedFields = parsed;
  }
  return entry;
}

// ============ 创建串口预警记录 ============
export function createSerialAlert(
  type: 'DATA_TIMEOUT' | 'SERIAL_DISCONNECTED' | 'DATA_THRESHOLD',
  deviceId: string,
  deviceName: string | null,
  settings: AppSettings,
  extra?: string
): AlertEntry {
  let detail = '';
  const name = deviceName ?? deviceId;
  switch (type) {
    case 'SERIAL_DISCONNECTED':
      detail = `串口设备 ${name} 已断开连接`;
      break;
    case 'DATA_TIMEOUT':
      detail = `串口设备 ${name} 超过 ${settings.dataTimeoutSeconds} 秒未收到数据`;
      break;
    case 'DATA_THRESHOLD':
      detail = `串口设备 ${name} 数据字段报警：${extra ?? ''}`;
      break;
  }
  return {
    id: genId(),
    timestamp: Date.now(),
    type,
    deviceId,
    deviceName,
    detail,
    channel: 'SERIAL',
  };
}

// ============ 默认串口配置 ============
export { DEFAULT_SERIAL_CONFIG };
