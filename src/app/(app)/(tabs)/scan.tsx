/**
 * 设备扫描页 - BLE 蓝牙 + USB 串口双模式
 * BLE: 扫描并连接 BLE 设备（需要蓝牙权限）
 * SERIAL: 枚举 USB Type-C 串口设备并连接（仅 Android）
 */
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useBle } from '@/lib/bleContext';
import { useSerial } from '@/lib/serialContext';
import { useConnectionMode } from '@/lib/connectionMode';
import type { BleDevice, SerialConfig, SerialDevice } from '@/lib/types';
import { BAUD_RATES, DEFAULT_SERIAL_CONFIG, PARITY_LABELS } from '@/lib/types';
import { getRssiColor, getRssiLabel } from '@/lib/bleService';
import { isSerialSupported } from '@/lib/serialService';

// 颜色常量
const CYAN = '#00E5FF';
const RED = '#FF3333';
const ORANGE = '#FF6B00';
const GREEN = '#00E676';
const DARK_BG = '#121212';
const CARD_BG = '#1A1A1A';
const BORDER = '#333333';
const TEXT_PRIMARY = '#E0E0E0';
const TEXT_MUTED = '#666666';

// ============ BLE 设备列表项 ============
function BleDeviceItem({
  device,
  onConnect,
  onDisconnect,
  isConnecting,
}: {
  device: BleDevice;
  onConnect: (device: BleDevice) => void;
  onDisconnect: () => void;
  isConnecting: boolean;
}) {
  const rssiColor = getRssiColor(device.rssi);
  const rssiLabel = getRssiLabel(device.rssi);
  const signalBars = Math.max(1, Math.min(4, Math.round((device.rssi + 100) / 18)));

  return (
    <View
      style={{
        backgroundColor: CARD_BG,
        borderColor: device.isConnected ? CYAN : BORDER,
        borderWidth: 1,
        marginHorizontal: 16,
        marginVertical: 4,
        padding: 14,
        borderRadius: 2,
        boxShadow: device.isConnected ? `0 0 8px ${CYAN}40` : undefined,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <Ionicons
          name={device.isConnected ? 'bluetooth' : 'bluetooth-outline'}
          size={16}
          color={device.isConnected ? CYAN : TEXT_MUTED}
          style={{ marginRight: 8 }}
        />
        <Text
          style={{ color: device.isConnected ? CYAN : TEXT_PRIMARY, fontSize: 15, fontWeight: '700', fontFamily: 'monospace', flex: 1 }}
          numberOfLines={1}
        >
          {device.name ?? '未知设备'}
        </Text>
        {device.isConnected && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: CYAN }} />
            <Text style={{ color: CYAN, fontSize: 11, fontWeight: '700' }}>已连接</Text>
          </View>
        )}
      </View>

      <View style={{ flexDirection: 'row', gap: 16, marginBottom: 12 }}>
        <View>
          <Text style={{ color: TEXT_MUTED, fontSize: 10, marginBottom: 2 }}>MAC 地址</Text>
          <Text style={{ color: TEXT_PRIMARY, fontSize: 12, fontFamily: 'monospace' }}>{device.address}</Text>
        </View>
        <View>
          <Text style={{ color: TEXT_MUTED, fontSize: 10, marginBottom: 2 }}>信号强度</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
              {[1, 2, 3, 4].map(bar => (
                <View key={bar} style={{ width: 4, height: 4 + bar * 3, backgroundColor: bar <= signalBars ? rssiColor : BORDER, borderRadius: 1 }} />
              ))}
            </View>
            <Text style={{ color: rssiColor, fontSize: 12, fontFamily: 'monospace', fontWeight: '700' }}>{device.rssi} dBm</Text>
            <Text style={{ color: rssiColor, fontSize: 10 }}>({rssiLabel})</Text>
          </View>
        </View>
      </View>

      {device.isConnected ? (
        <Pressable
          cssInterop={false} onPress={onDisconnect}
          style={({ pressed }) => ({
            borderColor: RED, borderWidth: 1, borderRadius: 2, paddingVertical: 8,
            alignItems: 'center', opacity: pressed ? 0.7 : 1,
            backgroundColor: pressed ? `${RED}20` : 'transparent',
          })}
        >
          <Text style={{ color: RED, fontSize: 13, fontWeight: '700' }}>断开连接</Text>
        </Pressable>
      ) : (
        <Pressable
          cssInterop={false} onPress={() => onConnect(device)} disabled={isConnecting}
          style={({ pressed }) => ({
            borderColor: CYAN, borderWidth: 1, borderRadius: 2, paddingVertical: 8,
            alignItems: 'center', opacity: isConnecting || pressed ? 0.6 : 1,
            backgroundColor: pressed ? `${CYAN}20` : 'transparent',
          })}
        >
          {isConnecting ? <ActivityIndicator size="small" color={CYAN} /> : (
            <Text style={{ color: CYAN, fontSize: 13, fontWeight: '700' }}>连接</Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

// ============ 串口连接配置 Modal ============
function SerialConfigModal({
  visible,
  initial,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  initial: SerialConfig;
  onConfirm: (cfg: SerialConfig) => void;
  onClose: () => void;
}) {
  const [baudRate, setBaudRate] = useState(initial.baudRate);
  const [dataBits, setDataBits] = useState(initial.dataBits);
  const [stopBits, setStopBits] = useState(initial.stopBits);
  const [parity, setParity] = useState(initial.parity);

  const parityOptions: Array<{ value: 0 | 1 | 2; label: string }> = [
    { value: 0, label: '无 (None)' },
    { value: 1, label: '奇 (Odd)' },
    { value: 2, label: '偶 (Even)' },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 20 }}>
        <View style={{ backgroundColor: '#1A1A1A', borderColor: BORDER, borderWidth: 1, borderRadius: 4, padding: 20, gap: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: ORANGE, fontSize: 14, fontWeight: '800', letterSpacing: 1 }}>串口通信参数</Text>
            <Pressable cssInterop={false} onPress={onClose} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Ionicons name="close" size={20} color={TEXT_MUTED} />
            </Pressable>
          </View>

          {/* 波特率 */}
          <View style={{ gap: 6 }}>
            <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>波特率 (Baud Rate)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {BAUD_RATES.map(b => (
                  <Pressable
                    key={b} cssInterop={false} onPress={() => setBaudRate(b)}
                    style={({ pressed }) => ({
                      borderColor: baudRate === b ? ORANGE : BORDER, borderWidth: 1, borderRadius: 2,
                      paddingHorizontal: 10, paddingVertical: 6, opacity: pressed ? 0.7 : 1,
                      backgroundColor: baudRate === b ? `${ORANGE}20` : '#111',
                    })}
                  >
                    <Text style={{ color: baudRate === b ? ORANGE : TEXT_MUTED, fontSize: 11, fontFamily: 'monospace' }}>
                      {b}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </View>

          {/* 数据位 */}
          <View style={{ gap: 6 }}>
            <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>数据位 (Data Bits)</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {[5, 6, 7, 8].map(d => (
                <Pressable
                  key={d} cssInterop={false} onPress={() => setDataBits(d)}
                  style={({ pressed }) => ({
                    borderColor: dataBits === d ? ORANGE : BORDER, borderWidth: 1, borderRadius: 2,
                    paddingHorizontal: 14, paddingVertical: 6, opacity: pressed ? 0.7 : 1,
                    backgroundColor: dataBits === d ? `${ORANGE}20` : '#111',
                  })}
                >
                  <Text style={{ color: dataBits === d ? ORANGE : TEXT_MUTED, fontSize: 13, fontFamily: 'monospace' }}>{d}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* 停止位 */}
          <View style={{ gap: 6 }}>
            <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>停止位 (Stop Bits)</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {[1, 2].map(s => (
                <Pressable
                  key={s} cssInterop={false} onPress={() => setStopBits(s)}
                  style={({ pressed }) => ({
                    borderColor: stopBits === s ? ORANGE : BORDER, borderWidth: 1, borderRadius: 2,
                    paddingHorizontal: 20, paddingVertical: 6, opacity: pressed ? 0.7 : 1,
                    backgroundColor: stopBits === s ? `${ORANGE}20` : '#111',
                  })}
                >
                  <Text style={{ color: stopBits === s ? ORANGE : TEXT_MUTED, fontSize: 13, fontFamily: 'monospace' }}>{s}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* 校验位 */}
          <View style={{ gap: 6 }}>
            <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>校验位 (Parity)</Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {parityOptions.map(opt => (
                <Pressable
                  key={opt.value} cssInterop={false} onPress={() => setParity(opt.value)}
                  style={({ pressed }) => ({
                    borderColor: parity === opt.value ? ORANGE : BORDER, borderWidth: 1, borderRadius: 2,
                    paddingHorizontal: 10, paddingVertical: 6, opacity: pressed ? 0.7 : 1,
                    backgroundColor: parity === opt.value ? `${ORANGE}20` : '#111',
                  })}
                >
                  <Text style={{ color: parity === opt.value ? ORANGE : TEXT_MUTED, fontSize: 11 }}>{opt.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* 预览 */}
          <View style={{ backgroundColor: '#0D0D0D', borderColor: `${ORANGE}30`, borderWidth: 1, borderRadius: 2, padding: 10 }}>
            <Text style={{ color: TEXT_MUTED, fontSize: 10, marginBottom: 4 }}>参数预览：</Text>
            <Text style={{ color: ORANGE, fontSize: 12, fontFamily: 'monospace', fontWeight: '700' }}>
              {baudRate} baud  {dataBits}-{stopBits}-{PARITY_LABELS[parity]?.split(' ')[0]}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              cssInterop={false} onPress={onClose}
              style={({ pressed }) => ({
                flex: 1, borderColor: BORDER, borderWidth: 1, borderRadius: 2,
                padding: 12, alignItems: 'center', opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: TEXT_MUTED, fontSize: 13, fontWeight: '700' }}>取消</Text>
            </Pressable>
            <Pressable
              cssInterop={false} onPress={() => onConfirm({ baudRate, dataBits, stopBits, parity })}
              style={({ pressed }) => ({
                flex: 1, backgroundColor: ORANGE, borderRadius: 2,
                padding: 12, alignItems: 'center', opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: '#121212', fontSize: 13, fontWeight: '800' }}>连接</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ============ 串口设备列表项 ============
function SerialDeviceItem({
  device,
  onConnect,
  onDisconnect,
  isConnecting,
}: {
  device: SerialDevice;
  onConnect: (device: SerialDevice) => void;
  onDisconnect: () => void;
  isConnecting: boolean;
}) {
  return (
    <View
      style={{
        backgroundColor: CARD_BG,
        borderColor: device.isConnected ? ORANGE : BORDER,
        borderWidth: 1,
        marginHorizontal: 16,
        marginVertical: 4,
        padding: 14,
        borderRadius: 2,
        boxShadow: device.isConnected ? `0 0 8px ${ORANGE}40` : undefined,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <Ionicons
          name={device.isConnected ? 'hardware-chip' : 'hardware-chip-outline'}
          size={16}
          color={device.isConnected ? ORANGE : TEXT_MUTED}
          style={{ marginRight: 8 }}
        />
        <Text style={{ color: device.isConnected ? ORANGE : TEXT_PRIMARY, fontSize: 15, fontWeight: '700', fontFamily: 'monospace', flex: 1 }} numberOfLines={1}>
          {device.displayName}
        </Text>
        {device.isConnected && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: ORANGE }} />
            <Text style={{ color: ORANGE, fontSize: 11, fontWeight: '700' }}>已连接</Text>
          </View>
        )}
      </View>

      <View style={{ flexDirection: 'row', gap: 16, marginBottom: 12 }}>
        <View>
          <Text style={{ color: TEXT_MUTED, fontSize: 10, marginBottom: 2 }}>VendorID</Text>
          <Text style={{ color: TEXT_PRIMARY, fontSize: 12, fontFamily: 'monospace' }}>
            0x{device.vendorId.toString(16).toUpperCase().padStart(4, '0')}
          </Text>
        </View>
        <View>
          <Text style={{ color: TEXT_MUTED, fontSize: 10, marginBottom: 2 }}>ProductID</Text>
          <Text style={{ color: TEXT_PRIMARY, fontSize: 12, fontFamily: 'monospace' }}>
            0x{device.productId.toString(16).toUpperCase().padStart(4, '0')}
          </Text>
        </View>
        <View>
          <Text style={{ color: TEXT_MUTED, fontSize: 10, marginBottom: 2 }}>设备 ID</Text>
          <Text style={{ color: TEXT_PRIMARY, fontSize: 12, fontFamily: 'monospace' }}>{device.deviceId}</Text>
        </View>
      </View>

      {device.isConnected ? (
        <Pressable
          cssInterop={false} onPress={onDisconnect}
          style={({ pressed }) => ({
            borderColor: RED, borderWidth: 1, borderRadius: 2, paddingVertical: 8,
            alignItems: 'center', opacity: pressed ? 0.7 : 1,
            backgroundColor: pressed ? `${RED}20` : 'transparent',
          })}
        >
          <Text style={{ color: RED, fontSize: 13, fontWeight: '700' }}>断开串口</Text>
        </Pressable>
      ) : (
        <Pressable
          cssInterop={false} onPress={() => onConnect(device)} disabled={isConnecting}
          style={({ pressed }) => ({
            borderColor: ORANGE, borderWidth: 1, borderRadius: 2, paddingVertical: 8,
            alignItems: 'center', opacity: isConnecting || pressed ? 0.6 : 1,
            backgroundColor: pressed ? `${ORANGE}20` : 'transparent',
          })}
        >
          {isConnecting ? <ActivityIndicator size="small" color={ORANGE} /> : (
            <Text style={{ color: ORANGE, fontSize: 13, fontWeight: '700' }}>设置参数并连接</Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

// ============ 主页面 ============
export default function ScanScreen() {
  const router = useRouter();
  const { activeChannel, setActiveChannel } = useConnectionMode();

  // BLE
  const {
    isScanning, devices, connectedDevice,
    startScan, stopScan, connectDevice, disconnectDevice,
    bleReady, bleError,
  } = useBle();

  // Serial
  const {
    serialDevices, connectedSerial,
    isDiscovering, isConnecting: isSerialConnecting, serialError,
    discoverDevices, connectSerial, disconnectSerial,
  } = useSerial();

  const [bleConnectingId, setBleConnectingId] = useState<string | null>(null);
  const [bleConnectError, setBleConnectError] = useState<string | null>(null);
  const [serialConnectingId, setSerialConnectingId] = useState<number | null>(null);
  const [serialConfigTarget, setSerialConfigTarget] = useState<SerialDevice | null>(null);
  const [serialCfg, setSerialCfg] = useState<SerialConfig>(DEFAULT_SERIAL_CONFIG);

  // ---- BLE 操作 ----
  const handleBleConnect = useCallback(async (device: BleDevice) => {
    setBleConnectingId(device.id);
    setBleConnectError(null);
    try {
      await connectDevice(device);
      router.push('/(app)/(tabs)/monitor');
    } catch (e: unknown) {
      setBleConnectError(e instanceof Error ? e.message : '连接失败');
    } finally {
      setBleConnectingId(null);
    }
  }, [connectDevice, router]);

  const handleBleDisconnect = useCallback(async () => { await disconnectDevice(); }, [disconnectDevice]);

  const handleScanToggle = useCallback(() => {
    if (isScanning) stopScan(); else startScan();
  }, [isScanning, startScan, stopScan]);

  // ---- 串口操作 ----
  const handleSerialConnect = useCallback((device: SerialDevice) => {
    setSerialCfg(DEFAULT_SERIAL_CONFIG);
    setSerialConfigTarget(device);
  }, []);

  const handleSerialConfirm = useCallback(async (cfg: SerialConfig) => {
    if (!serialConfigTarget) return;
    setSerialConnectingId(serialConfigTarget.deviceId);
    setSerialConfigTarget(null);
    try {
      await connectSerial(serialConfigTarget, cfg);
      router.push('/(app)/(tabs)/monitor');
    } finally {
      setSerialConnectingId(null);
    }
  }, [connectSerial, serialConfigTarget, router]);

  const handleSerialDisconnect = useCallback(async () => { await disconnectSerial(); }, [disconnectSerial]);

  const isBle = activeChannel === 'BLE';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: DARK_BG }}>
      {/* ===== 顶部标题栏 ===== */}
      <View style={{
        paddingHorizontal: 16, paddingVertical: 10,
        borderBottomColor: BORDER, borderBottomWidth: 1, backgroundColor: '#0F0F0F',
      }}>
        {/* 通道切换选项卡 */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
          {(['BLE', 'SERIAL'] as const).map(ch => {
            const active = activeChannel === ch;
            const color = ch === 'BLE' ? CYAN : ORANGE;
            const label = ch === 'BLE' ? '🔵 BLE 蓝牙' : '🔌 USB 串口';
            return (
              <Pressable
                key={ch} cssInterop={false} onPress={() => setActiveChannel(ch)}
                style={({ pressed }) => ({
                  flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 2,
                  borderWidth: 1, borderColor: active ? color : BORDER,
                  backgroundColor: active ? `${color}18` : '#111',
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ color: active ? color : TEXT_MUTED, fontSize: 12, fontWeight: '800' }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* 副标题 + 操作按钮 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>
            {isBle
              ? `发现 ${devices.length} 个设备${connectedDevice ? `  ·  已连接: ${connectedDevice.name ?? connectedDevice.address}` : ''}`
              : `发现 ${serialDevices.length} 个设备${connectedSerial ? `  ·  已连接: ${connectedSerial.displayName}` : ''}`}
          </Text>

          {isBle ? (
            <Pressable
              cssInterop={false} onPress={handleScanToggle} disabled={!bleReady && !isScanning}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', gap: 6,
                paddingHorizontal: 14, paddingVertical: 8, borderRadius: 2, borderWidth: 1,
                borderColor: isScanning ? RED : CYAN,
                opacity: (!bleReady && !isScanning) ? 0.4 : pressed ? 0.7 : 1,
                backgroundColor: isScanning ? `${RED}15` : `${CYAN}15`,
              })}
            >
              {isScanning && <ActivityIndicator size="small" color={RED} style={{ marginRight: 2 }} />}
              <Ionicons name={isScanning ? 'stop-circle' : 'search'} size={14} color={isScanning ? RED : CYAN} />
              <Text style={{ color: isScanning ? RED : CYAN, fontSize: 12, fontWeight: '700' }}>
                {isScanning ? '停止' : '扫描'}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              cssInterop={false} onPress={discoverDevices} disabled={isDiscovering}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', gap: 6,
                paddingHorizontal: 14, paddingVertical: 8, borderRadius: 2, borderWidth: 1,
                borderColor: ORANGE, opacity: isDiscovering || pressed ? 0.6 : 1,
                backgroundColor: `${ORANGE}15`,
              })}
            >
              {isDiscovering
                ? <ActivityIndicator size="small" color={ORANGE} />
                : <Ionicons name="refresh" size={14} color={ORANGE} />}
              <Text style={{ color: ORANGE, fontSize: 12, fontWeight: '700' }}>
                {isDiscovering ? '检测中...' : '检测设备'}
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* ===== 错误提示 ===== */}
      {(isBle ? (bleError || bleConnectError) : serialError) && (
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 8,
          paddingHorizontal: 16, paddingVertical: 8,
          backgroundColor: `${RED}18`, borderBottomColor: `${RED}40`, borderBottomWidth: 1,
        }}>
          <Ionicons name="warning-outline" size={14} color={ORANGE} />
          <Text style={{ color: ORANGE, fontSize: 11, flex: 1, lineHeight: 16 }}>
            {isBle ? (bleConnectError ?? bleError) : serialError}
          </Text>
        </View>
      )}

      {/* BLE 扫描进度条 */}
      {isBle && isScanning && (
        <View style={{ height: 2, backgroundColor: `${CYAN}30` }}>
          <View style={{ height: 2, width: '40%', backgroundColor: CYAN }} />
        </View>
      )}

      {/* ===== iOS 串口不支持提示 ===== */}
      {!isBle && !isSerialSupported && (
        <View style={{ margin: 20, padding: 16, backgroundColor: `${ORANGE}15`, borderColor: `${ORANGE}40`, borderWidth: 1, borderRadius: 4, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="information-circle" size={18} color={ORANGE} />
            <Text style={{ color: ORANGE, fontSize: 13, fontWeight: '700' }}>iOS 不支持 USB 串口</Text>
          </View>
          <Text style={{ color: TEXT_MUTED, fontSize: 12, lineHeight: 18 }}>
            USB 串口通信仅支持 Android 设备。iOS 系统对 USB Host 访问有严格限制，无法直接访问 Type-C 串口设备。
          </Text>
          <Text style={{ color: TEXT_MUTED, fontSize: 12, lineHeight: 18 }}>
            请切换至「BLE 蓝牙」模式，或使用 Android 设备连接串口设备。
          </Text>
        </View>
      )}

      {/* ===== 串口说明提示（Android 未检测时） ===== */}
      {!isBle && isSerialSupported && serialDevices.length === 0 && !isDiscovering && (
        <View style={{ marginHorizontal: 16, marginTop: 10, padding: 12, backgroundColor: `${ORANGE}10`, borderColor: `${ORANGE}30`, borderWidth: 1, borderRadius: 3 }}>
          <Text style={{ color: TEXT_MUTED, fontSize: 11, lineHeight: 17 }}>
            💡 <Text style={{ color: ORANGE }}>使用方式：</Text>通过 OTG 转接头将串口设备（USB-TTL/RS232/RS485 等）连接到手机 Type-C 接口，点击「检测设备」枚举可用设备。
          </Text>
        </View>
      )}

      {/* ===== BLE 设备列表 ===== */}
      {isBle && (
        <FlatList
          data={devices}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingVertical: 8 }}
          contentInsetAdjustmentBehavior="automatic"
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 80 }}>
              <Ionicons name="bluetooth-outline" size={48} color={TEXT_MUTED} />
              <Text style={{ color: TEXT_MUTED, fontSize: 14, marginTop: 12, fontWeight: '600' }}>
                {isScanning ? '正在扫描设备...' : '未发现 BLE 设备'}
              </Text>
              <Text style={{ color: TEXT_MUTED, fontSize: 12, marginTop: 4 }}>
                {isScanning ? '请确保目标设备蓝牙已开启' : bleReady ? '点击「扫描」按钮开始' : '请先开启系统蓝牙'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <BleDeviceItem
              device={item}
              onConnect={handleBleConnect}
              onDisconnect={handleBleDisconnect}
              isConnecting={bleConnectingId === item.id}
            />
          )}
        />
      )}

      {/* ===== 串口设备列表 ===== */}
      {!isBle && isSerialSupported && (
        <FlatList
          data={serialDevices}
          keyExtractor={item => String(item.deviceId)}
          contentContainerStyle={{ paddingVertical: 8 }}
          contentInsetAdjustmentBehavior="automatic"
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 80 }}>
              <Ionicons name="hardware-chip-outline" size={48} color={TEXT_MUTED} />
              <Text style={{ color: TEXT_MUTED, fontSize: 14, marginTop: 12, fontWeight: '600' }}>
                {isDiscovering ? '正在检测串口设备...' : '未发现串口设备'}
              </Text>
              <Text style={{ color: TEXT_MUTED, fontSize: 12, marginTop: 4 }}>
                {isDiscovering ? '请稍候' : '请连接串口设备后点击「检测设备」'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <SerialDeviceItem
              device={item}
              onConnect={handleSerialConnect}
              onDisconnect={handleSerialDisconnect}
              isConnecting={serialConnectingId === item.deviceId}
            />
          )}
        />
      )}

      {/* ===== 底部状态栏 ===== */}
      <View style={{
        flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
        paddingVertical: 8, borderTopColor: BORDER, borderTopWidth: 1, gap: 8,
      }}>
        {isBle ? (
          <>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: bleReady ? (isScanning ? CYAN : GREEN) : RED }} />
            <Text style={{ color: TEXT_MUTED, fontSize: 11, fontFamily: 'monospace' }}>
              {!bleReady ? '蓝牙未就绪' : isScanning ? `扫描中... 已发现 ${devices.length} 个` : connectedDevice ? `已连接: ${connectedDevice.name ?? connectedDevice.address}` : '就绪'}
            </Text>
          </>
        ) : (
          <>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: connectedSerial ? ORANGE : TEXT_MUTED }} />
            <Text style={{ color: TEXT_MUTED, fontSize: 11, fontFamily: 'monospace' }}>
              {connectedSerial ? `串口已连接: ${connectedSerial.displayName}` : `发现 ${serialDevices.length} 个串口设备`}
            </Text>
          </>
        )}
      </View>

      {/* 串口参数配置 Modal */}
      {serialConfigTarget && (
        <SerialConfigModal
          visible={true}
          initial={serialCfg}
          onConfirm={handleSerialConfirm}
          onClose={() => setSerialConfigTarget(null)}
        />
      )}
    </SafeAreaView>
  );
}
