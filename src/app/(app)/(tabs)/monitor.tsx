/**
 * 数据监测页 - 实时显示蓝牙/串口数据收发 + 解析字段视图
 * 支持 BLE 蓝牙 和 USB 串口 双数据源
 */
import { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useBle } from '@/lib/bleContext';
import { useSerial } from '@/lib/serialContext';
import { useConnectionMode } from '@/lib/connectionMode';
import type { DataLogEntry, ParsedFieldState } from '@/lib/types';
import { bytesToAscii, bytesToHex, getRssiColor } from '@/lib/bleService';

const CYAN = '#00E5FF';
const RED = '#FF3333';
const GREEN = '#00E676';
const ORANGE = '#FF6B00';
const DARK_BG = '#121212';
const CARD_BG = '#1A1A1A';
const BORDER = '#333333';
const TEXT_PRIMARY = '#E0E0E0';
const TEXT_MUTED = '#666666';

type DisplayFormat = 'HEX' | 'ASCII';

// ============ 单条日志行 ============
function LogRow({ entry, format }: { entry: DataLogEntry; format: DisplayFormat }) {
  const isRx = entry.direction === 'RX';
  const isSerial = entry.channel === 'SERIAL';
  const color = isRx ? (isSerial ? ORANGE : CYAN) : GREEN;
  const timeStr = new Date(entry.timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const msStr = `.${String(new Date(entry.timestamp).getMilliseconds()).padStart(3, '0')}`;
  const dataStr = format === 'HEX' ? bytesToHex(entry.rawData) : bytesToAscii(entry.rawData);

  return (
    <View style={{
      flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 5,
      borderBottomColor: '#1E1E1E', borderBottomWidth: 1, alignItems: 'flex-start', gap: 8,
    }}>
      <Text style={{ color: TEXT_MUTED, fontSize: 10, fontFamily: 'monospace', width: 80 }}>
        {timeStr}{msStr}
      </Text>
      <View style={{ borderColor: color, borderWidth: 1, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 2, minWidth: 28, alignItems: 'center' }}>
        <Text style={{ color, fontSize: 10, fontWeight: '800', fontFamily: 'monospace' }}>
          {entry.direction}
        </Text>
      </View>
      <Text style={{ color: TEXT_MUTED, fontSize: 10, fontFamily: 'monospace', width: 32 }}>
        {entry.rawData.length}B
      </Text>
      <Text style={{ color: TEXT_PRIMARY, fontSize: 11, fontFamily: 'monospace', flex: 1, lineHeight: 16 }} numberOfLines={2}>
        {dataStr}
      </Text>
      {entry.parsedFields && Object.keys(entry.parsedFields).length > 0 && (
        <View style={{ borderColor: `${color}60`, borderWidth: 1, borderRadius: 2, paddingHorizontal: 4, paddingVertical: 1 }}>
          <Text style={{ color, fontSize: 8, fontWeight: '800' }}>
            {Object.keys(entry.parsedFields).join(',')}
          </Text>
        </View>
      )}
    </View>
  );
}

// ============ 解析字段卡片 ============
function ParsedFieldCard({ field, label, unit, hasAlert, accentColor }: {
  field: ParsedFieldState; label: string; unit: string; hasAlert: boolean; accentColor: string;
}) {
  const age = Date.now() - field.timestamp;
  const isStale = age > 10000;
  return (
    <View style={{
      backgroundColor: hasAlert ? `${RED}18` : '#1A1A1A',
      borderColor: hasAlert ? RED : isStale ? '#333333' : `${accentColor}50`,
      borderWidth: 1, borderRadius: 2, padding: 10, minWidth: 88, gap: 2,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {hasAlert && <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: RED }} />}
        <Text style={{ color: hasAlert ? RED : TEXT_MUTED, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 }}>
          {label || field.key}
        </Text>
      </View>
      <Text style={{ color: hasAlert ? RED : accentColor, fontSize: 20, fontWeight: '800', fontFamily: 'monospace', lineHeight: 24 }}>
        {field.value % 1 === 0 ? field.value.toString() : field.value.toFixed(1)}
      </Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: TEXT_MUTED, fontSize: 9 }}>{unit || '--'}</Text>
        <Text style={{ color: '#444444', fontSize: 8, fontFamily: 'monospace' }}>{field.key}:</Text>
      </View>
    </View>
  );
}

// ============ 解析视图面板 ============
function ParsedFieldsPanel({ accentColor }: { accentColor: string }) {
  const { activeChannel } = useConnectionMode();
  const ble = useBle();
  const serial = useSerial();
  const isBle = activeChannel === 'BLE';
  const parsedFields = isBle ? ble.parsedFields : serial.serialParsedFields;
  const settings = ble.settings;
  const fields = Object.values(parsedFields);

  if (fields.length === 0) {
    return (
      <View style={{
        borderTopColor: BORDER, borderTopWidth: 1, backgroundColor: '#0E0E0E',
        paddingVertical: 10, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8,
      }}>
        <Ionicons name="analytics-outline" size={14} color={TEXT_MUTED} />
        <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>等待含分组字段的数据（如 T:25.3,D:1024）...</Text>
      </View>
    );
  }

  return (
    <View style={{ borderTopColor: BORDER, borderTopWidth: 1, backgroundColor: '#0D0D0D' }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 12, paddingVertical: 6, borderBottomColor: '#1A1A1A', borderBottomWidth: 1,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: accentColor }} />
          <Text style={{ color: accentColor, fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>PARSED FIELDS</Text>
        </View>
        <Text style={{ color: TEXT_MUTED, fontSize: 9 }}>{fields.length} 个字段</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ flexDirection: 'row', gap: 8, padding: 10 }}>
        {fields.map(f => {
          const mapping = settings.fieldMappings.find(m => m.fieldKey.toUpperCase() === f.key.toUpperCase());
          const hasAlert = settings.dataAlertRules.some(r => r.enabled && r.fieldKey.toUpperCase() === f.key.toUpperCase());
          return (
            <ParsedFieldCard key={f.key} field={f} label={mapping?.label ?? f.key}
              unit={mapping?.unit ?? ''} hasAlert={hasAlert} accentColor={accentColor} />
          );
        })}
      </ScrollView>
    </View>
  );
}

function RateIndicator({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={{ alignItems: 'center', minWidth: 70 }}>
      <Text style={{ color, fontSize: 16, fontWeight: '800', fontFamily: 'monospace' }}>
        {value > 999 ? `${(value / 1024).toFixed(1)}K` : value}
      </Text>
      <Text style={{ color: TEXT_MUTED, fontSize: 9, marginTop: 1 }}>{label} B/s</Text>
    </View>
  );
}

// ============ 主页面 ============
export default function MonitorScreen() {
  const { activeChannel } = useConnectionMode();
  const isBle = activeChannel === 'BLE';
  const accentColor = isBle ? CYAN : ORANGE;

  // BLE 数据源
  const {
    connectedDevice,
    dataLogs: bleLogs,
    stats: bleStats,
    settings,
    parsedFields: bleParsedFields,
    sendData: bleSend,
    clearLogs: bleClearLogs,
    disconnectDevice,
  } = useBle();

  // 串口数据源
  const {
    connectedSerial,
    serialLogs,
    serialStats,
    serialParsedFields,
    sendSerialData,
    clearSerialLogs,
    disconnectSerial,
  } = useSerial();

  // 当前激活的连接
  const activeDevice = isBle ? connectedDevice : connectedSerial;
  const dataLogs = isBle ? bleLogs : serialLogs;
  const stats = isBle ? bleStats : serialStats;
  const parsedFields = isBle ? bleParsedFields : serialParsedFields;

  const [format, setFormat] = useState<DisplayFormat>(settings.defaultFormat);
  const [inputText, setInputText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const listRef = useRef<FlatList>(null);
  const [showParsed, setShowParsed] = useState(true);

  useFocusEffect(
    useCallback(() => {
      setFormat(settings.defaultFormat);
    }, [settings.defaultFormat])
  );

  const handleSend = useCallback(async () => {
    if (!activeDevice) { setErrorMsg('请先连接设备'); return; }
    if (!inputText.trim()) { setErrorMsg('请输入要发送的数据'); return; }
    if (isBle) await bleSend(inputText.trim());
    else await sendSerialData(inputText.trim());
    setInputText('');
    setErrorMsg('');
  }, [activeDevice, isBle, inputText, bleSend, sendSerialData]);

  const handleDisconnect = useCallback(async () => {
    if (isBle) await disconnectDevice();
    else await disconnectSerial();
  }, [isBle, disconnectDevice, disconnectSerial]);

  const handleClearLogs = useCallback(() => {
    if (isBle) bleClearLogs();
    else clearSerialLogs();
  }, [isBle, bleClearLogs, clearSerialLogs]);

  // 未连接状态
  if (!activeDevice) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: DARK_BG }}>
        <View style={{
          paddingHorizontal: 16, paddingVertical: 12,
          borderBottomColor: BORDER, borderBottomWidth: 1, backgroundColor: '#0F0F0F',
        }}>
          <Text style={{ color: accentColor, fontSize: 16, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1 }}>
            DATA MONITOR
          </Text>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Ionicons name={isBle ? 'bluetooth-outline' : 'hardware-chip-outline'} size={56} color={TEXT_MUTED} />
          <Text style={{ color: TEXT_MUTED, fontSize: 15, fontWeight: '600' }}>未连接任何设备</Text>
          <Text style={{ color: TEXT_MUTED, fontSize: 12 }}>
            请前往「设备扫描」页{isBle ? '连接 BLE 设备' : '连接 USB 串口设备'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // 设备名称 / 地址展示
  const deviceLabel = isBle
    ? (connectedDevice?.name ?? connectedDevice?.address ?? '')
    : (connectedSerial?.displayName ?? '');

  const deviceSub = isBle
    ? connectedDevice?.address ?? ''
    : `VID:0x${connectedSerial?.vendorId.toString(16).toUpperCase().padStart(4, '0')}  PID:0x${connectedSerial?.productId.toString(16).toUpperCase().padStart(4, '0')}`;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: DARK_BG }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {/* ===== 顶部标题栏 ===== */}
        <View style={{
          paddingHorizontal: 16, paddingVertical: 10,
          borderBottomColor: BORDER, borderBottomWidth: 1, backgroundColor: '#0F0F0F',
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: accentColor, fontSize: 16, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1 }}>
                  DATA MONITOR
                </Text>
                {/* 通道标签 */}
                <View style={{ borderColor: `${accentColor}60`, borderWidth: 1, borderRadius: 2, paddingHorizontal: 6, paddingVertical: 2 }}>
                  <Text style={{ color: accentColor, fontSize: 9, fontWeight: '800' }}>
                    {isBle ? 'BLE' : 'SERIAL'}
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: accentColor }} />
                <Text style={{ color: TEXT_PRIMARY, fontSize: 11, fontFamily: 'monospace' }}>{deviceLabel}</Text>
                <Text style={{ color: TEXT_MUTED, fontSize: 11, fontFamily: 'monospace' }}>{deviceSub}</Text>
                {isBle && connectedDevice && (
                  <Text style={{ color: getRssiColor(connectedDevice.rssi), fontSize: 11, fontFamily: 'monospace', fontWeight: '700' }}>
                    {connectedDevice.rssi} dBm
                  </Text>
                )}
              </View>
            </View>
            <Pressable
              cssInterop={false} onPress={handleDisconnect}
              style={({ pressed }) => ({
                borderColor: RED, borderWidth: 1, borderRadius: 2,
                paddingHorizontal: 10, paddingVertical: 6, opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: RED, fontSize: 11, fontWeight: '700' }}>断开</Text>
            </Pressable>
          </View>
        </View>

        {/* ===== 数据统计条 ===== */}
        <View style={{
          flexDirection: 'row', backgroundColor: '#0F0F0F',
          borderBottomColor: BORDER, borderBottomWidth: 1,
          paddingVertical: 8, paddingHorizontal: 16,
          alignItems: 'center', justifyContent: 'space-around',
        }}>
          <RateIndicator label="RX" value={stats.rxRate} color={accentColor} />
          <View style={{ width: 1, height: 32, backgroundColor: BORDER }} />
          <RateIndicator label="TX" value={stats.txRate} color={GREEN} />
          <View style={{ width: 1, height: 32, backgroundColor: BORDER }} />
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: TEXT_PRIMARY, fontSize: 14, fontWeight: '700', fontFamily: 'monospace' }}>{dataLogs.length}</Text>
            <Text style={{ color: TEXT_MUTED, fontSize: 9, marginTop: 1 }}>条记录</Text>
          </View>
          <View style={{ width: 1, height: 32, backgroundColor: BORDER }} />
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {(['HEX', 'ASCII'] as DisplayFormat[]).map(f => (
              <Pressable key={f} cssInterop={false} onPress={() => setFormat(f)}
                style={({ pressed }) => ({
                  borderColor: format === f ? accentColor : BORDER, borderWidth: 1, borderRadius: 2,
                  paddingHorizontal: 8, paddingVertical: 3, opacity: pressed ? 0.7 : 1,
                  backgroundColor: format === f ? `${accentColor}20` : 'transparent',
                })}>
                <Text style={{ color: format === f ? accentColor : TEXT_MUTED, fontSize: 10, fontWeight: '700' }}>{f}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* ===== 日志列表表头 ===== */}
        <View style={{
          flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 6,
          backgroundColor: '#0F0F0F', borderBottomColor: BORDER, borderBottomWidth: 1,
          alignItems: 'center', gap: 8,
        }}>
          <Text style={{ color: TEXT_MUTED, fontSize: 10, width: 80 }}>时间</Text>
          <Text style={{ color: TEXT_MUTED, fontSize: 10, width: 28 }}>方向</Text>
          <Text style={{ color: TEXT_MUTED, fontSize: 10, width: 32 }}>长度</Text>
          <Text style={{ color: TEXT_MUTED, fontSize: 10, flex: 1 }}>数据</Text>
          <Pressable cssInterop={false} onPress={handleClearLogs} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>清空</Text>
          </Pressable>
        </View>

        {/* ===== 日志列表 ===== */}
        <FlatList
          ref={listRef}
          data={dataLogs}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <LogRow entry={item} format={format} />}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 8 }}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 40 }}>
              <Text style={{ color: TEXT_MUTED, fontSize: 13 }}>暂无数据记录</Text>
              <Text style={{ color: TEXT_MUTED, fontSize: 11, marginTop: 4 }}>等待接收数据...</Text>
            </View>
          }
        />

        {/* ===== 解析字段视图面板（可折叠） ===== */}
        <View style={{ borderTopColor: BORDER, borderTopWidth: 1 }}>
          <Pressable
            cssInterop={false} onPress={() => setShowParsed(v => !v)}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#0D0D0D', opacity: pressed ? 0.7 : 1,
            })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="analytics-outline" size={13} color={Object.keys(parsedFields).length > 0 ? accentColor : TEXT_MUTED} />
              <Text style={{ color: Object.keys(parsedFields).length > 0 ? accentColor : TEXT_MUTED, fontSize: 10, fontWeight: '700' }}>
                PARSED FIELDS
              </Text>
              {Object.keys(parsedFields).length > 0 && (
                <View style={{ backgroundColor: `${accentColor}30`, borderColor: `${accentColor}60`, borderWidth: 1, borderRadius: 2, paddingHorizontal: 5, paddingVertical: 1 }}>
                  <Text style={{ color: accentColor, fontSize: 9, fontWeight: '800' }}>{Object.keys(parsedFields).length}</Text>
                </View>
              )}
            </View>
            <Ionicons name={showParsed ? 'chevron-down' : 'chevron-up'} size={12} color={TEXT_MUTED} />
          </Pressable>
          {showParsed && <ParsedFieldsPanel accentColor={accentColor} />}
        </View>

        {/* ===== 发送数据输入区 ===== */}
        <View style={{ borderTopColor: BORDER, borderTopWidth: 1, backgroundColor: CARD_BG, padding: 12, gap: 6 }}>
          {errorMsg ? <Text style={{ color: RED, fontSize: 11, marginBottom: 2 }}>{errorMsg}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TextInput
              style={{
                flex: 1, backgroundColor: '#111111', borderColor: BORDER, borderWidth: 1,
                borderRadius: 2, paddingHorizontal: 12, paddingVertical: 8,
                color: TEXT_PRIMARY, fontSize: 13, fontFamily: 'monospace',
              }}
              value={inputText}
              onChangeText={t => { setInputText(t); setErrorMsg(''); }}
              placeholder="输入十六进制或ASCII数据..."
              placeholderTextColor={TEXT_MUTED}
              returnKeyType="send"
              onSubmitEditing={handleSend}
            />
            <Pressable
              cssInterop={false} onPress={handleSend}
              style={({ pressed }) => ({
                backgroundColor: accentColor, borderRadius: 2,
                paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: '#121212', fontSize: 13, fontWeight: '800' }}>发送</Text>
            </Pressable>
          </View>
          <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>支持十六进制（如 4A 5F）或普通文本</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
