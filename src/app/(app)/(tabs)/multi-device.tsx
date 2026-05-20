/**
 * 多设备管理页
 * 同时展示最多 4 个已连接 BLE 设备的实时状态
 * 支持追加连接、切换活动设备、设备命名、颜色标签、独立/全部断开
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useBle } from '@/lib/bleContext';
import type { DeviceColorLabel } from '@/lib/types';
import { DEVICE_COLOR_MAP, DEVICE_COLORS, MAX_CONNECTED_DEVICES } from '@/lib/types';

// ── 颜色常量 ────────────────────────────────────────────────────
const BG        = '#121212';
const CARD      = '#1A1A1A';
const BORDER    = '#2A2A2A';
const CYAN      = '#00E5FF';
const RED       = '#FF3366';
const TEXT      = '#E8E8E8';
const MUTED     = '#666666';
const ACTIVE_BG = '#0D2A2E';

// ── 颜色标签选择器 ───────────────────────────────────────────────
function ColorPicker({
  selected,
  onSelect,
}: {
  selected: DeviceColorLabel;
  onSelect: (c: DeviceColorLabel) => void;
}) {
  return (
    <View className="flex-row gap-2 flex-wrap">
      {DEVICE_COLORS.map(c => (
        <Pressable
          key={c}
          onPress={() => onSelect(c)}
          style={{
            width: 22, height: 22, borderRadius: 11,
            backgroundColor: DEVICE_COLOR_MAP[c],
            borderWidth: selected === c ? 2 : 0,
            borderColor: '#FFF',
          }}
        />
      ))}
    </View>
  );
}

// ── 单设备状态卡片 ───────────────────────────────────────────────
interface DeviceCardProps {
  device: { id: string; name: string | null; rssi: number; isConnected: boolean };
  isActive: boolean;
  colorLabel: DeviceColorLabel;
  customName?: string;
  latestTempMax?: number;
  latestTempMin?: number;
  latestTempAvg?: number;
  onSetActive: () => void;
  onDisconnect: () => void;
  onRename: (name: string) => void;
  onRecolor: (c: DeviceColorLabel) => void;
}

function DeviceCard({
  device, isActive, colorLabel, customName,
  latestTempMax, latestTempMin, latestTempAvg,
  onSetActive, onDisconnect, onRename, onRecolor,
}: DeviceCardProps) {
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(customName ?? device.name ?? device.id.slice(-6));
  const accentColor = DEVICE_COLOR_MAP[colorLabel];

  const rssiColor = device.rssi > -65 ? '#00E676' : device.rssi > -80 ? '#FFD600' : RED;
  const displayName = customName || device.name || `设备 ${device.id.slice(-4)}`;

  return (
    <Pressable
      onPress={onSetActive}
      style={{
        backgroundColor: isActive ? ACTIVE_BG : CARD,
        borderWidth: 1,
        borderColor: isActive ? accentColor : BORDER,
        borderRadius: 8,
        padding: 14,
        marginBottom: 10,
      }}
    >
      {/* 顶部行：颜色点 + 名称 + 活动标识 + 断开按钮 */}
      <View className="flex-row items-center gap-3 mb-3">
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: accentColor }} />
        {editing ? (
          <TextInput
            value={nameInput}
            onChangeText={setNameInput}
            onBlur={() => { onRename(nameInput.trim() || displayName); setEditing(false); }}
            autoFocus
            style={{
              flex: 1, color: TEXT, fontSize: 14, fontWeight: '700',
              borderBottomWidth: 1, borderBottomColor: accentColor,
              paddingVertical: 2,
            }}
          />
        ) : (
          <Text style={{ flex: 1, color: TEXT, fontSize: 14, fontWeight: '700' }}>
            {displayName}
          </Text>
        )}
        {isActive && (
          <View style={{
            backgroundColor: `${accentColor}25`, borderRadius: 4,
            paddingHorizontal: 6, paddingVertical: 2,
          }}>
            <Text style={{ color: accentColor, fontSize: 10, fontWeight: '700' }}>ACTIVE</Text>
          </View>
        )}
        <Pressable onPress={() => setEditing(e => !e)} style={{ padding: 4 }}>
          <Ionicons name="pencil" size={13} color={MUTED} />
        </Pressable>
        <Pressable
          onPress={onDisconnect}
          style={{
            backgroundColor: `${RED}20`, borderRadius: 6,
            paddingHorizontal: 10, paddingVertical: 4,
          }}
        >
          <Text style={{ color: RED, fontSize: 11, fontWeight: '700' }}>断开</Text>
        </Pressable>
      </View>

      {/* MAC / UUID */}
      <Text style={{ color: MUTED, fontSize: 10, fontFamily: 'monospace', marginBottom: 8 }}>
        ID: {device.id.slice(0, 8).toUpperCase()}…
      </Text>

      {/* 数据行 */}
      <View className="flex-row gap-4 flex-wrap mb-3">
        <MetricChip label="RSSI" value={`${device.rssi} dBm`} color={rssiColor} />
        {latestTempMax !== undefined && (
          <>
            <MetricChip label="最高温" value={`${latestTempMax.toFixed(1)} ℃`} color={RED} />
            <MetricChip label="平均温" value={`${(latestTempAvg ?? 0).toFixed(1)} ℃`} color={CYAN} />
            <MetricChip label="最低温" value={`${(latestTempMin ?? 0).toFixed(1)} ℃`} color="#00E676" />
          </>
        )}
      </View>

      {/* 颜色标签 */}
      <ColorPicker selected={colorLabel} onSelect={onRecolor} />
    </Pressable>
  );
}

function MetricChip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={{ backgroundColor: `${color}15`, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4 }}>
      <Text style={{ color: MUTED, fontSize: 9, marginBottom: 1 }}>{label}</Text>
      <Text style={{ color, fontSize: 12, fontWeight: '700', fontFamily: 'monospace' }}>{value}</Text>
    </View>
  );
}

// ── 扫描到的设备列表（待连接） ───────────────────────────────────
function ScanList({
  devices,
  connectedIds,
  maxReached,
  onConnect,
}: {
  devices: Array<{ id: string; name: string | null; rssi: number }>;
  connectedIds: Set<string>;
  maxReached: boolean;
  onConnect: (d: { id: string; name: string | null; rssi: number; isConnected: boolean; address: string }) => void;
}) {
  const available = devices.filter(d => !connectedIds.has(d.id));
  if (available.length === 0) return null;

  return (
    <View style={{ marginTop: 8 }}>
      <Text style={{ color: MUTED, fontSize: 11, marginBottom: 8, fontWeight: '700', letterSpacing: 0.5 }}>
        扫描到的设备
      </Text>
      {available.map(d => (
        <View
          key={d.id}
          style={{
            backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
            borderRadius: 6, padding: 12, marginBottom: 6,
            flexDirection: 'row', alignItems: 'center',
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: TEXT, fontSize: 13, fontWeight: '600' }}>
              {d.name ?? `未知设备 ${d.id.slice(-4)}`}
            </Text>
            <Text style={{ color: MUTED, fontSize: 10, fontFamily: 'monospace' }}>
              {d.id.slice(0, 12)}…  RSSI: {d.rssi} dBm
            </Text>
          </View>
          <Pressable
            onPress={() => onConnect({ ...d, isConnected: false, address: d.id })}
            disabled={maxReached}
            style={{
              backgroundColor: maxReached ? `${MUTED}30` : `${CYAN}20`,
              borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6,
            }}
          >
            <Text style={{ color: maxReached ? MUTED : CYAN, fontSize: 12, fontWeight: '700' }}>
              {maxReached ? '已满' : '连接'}
            </Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

// ── 主页面 ───────────────────────────────────────────────────────
export default function MultiDeviceScreen() {
  const {
    devices, isScanning, startScan, stopScan,
    connectedDevices, activeDeviceId, deviceRuntimeInfo,
    setActiveDeviceId, connectAdditionalDevice,
    disconnectSpecificDevice, disconnectAllDevices,
    updateDeviceInfo, bleError,
  } = useBle();
  const router = useRouter();

  const connectedIds = new Set(connectedDevices.map(d => d.id));
  const maxReached = connectedDevices.length >= MAX_CONNECTED_DEVICES;

  const handleScan = useCallback(() => {
    if (isScanning) stopScan(); else startScan();
  }, [isScanning, startScan, stopScan]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['top']}>
      {/* 标题栏 */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 16, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: BORDER,
      }}>
        <Text style={{ color: CYAN, fontSize: 16, fontWeight: '800', letterSpacing: 1, flex: 1 }}>
          多设备管理
        </Text>
        <View style={{
          backgroundColor: `${CYAN}20`, borderRadius: 12,
          paddingHorizontal: 10, paddingVertical: 3,
        }}>
          <Text style={{ color: CYAN, fontSize: 11, fontWeight: '700' }}>
            {connectedDevices.length}/{MAX_CONNECTED_DEVICES}
          </Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 14 }}
        showsVerticalScrollIndicator={false}
      >
        {/* 错误提示 */}
        {bleError && (
          <View style={{
            backgroundColor: `${RED}18`, borderWidth: 1, borderColor: `${RED}50`,
            borderRadius: 6, padding: 10, marginBottom: 12,
          }}>
            <Text style={{ color: RED, fontSize: 12 }}>{bleError}</Text>
          </View>
        )}

        {/* 操作按钮行 */}
        <View className="flex-row gap-3 mb-4">
          <Pressable
            onPress={handleScan}
            style={{
              flex: 1, backgroundColor: isScanning ? `${RED}20` : `${CYAN}20`,
              borderWidth: 1, borderColor: isScanning ? RED : CYAN,
              borderRadius: 6, paddingVertical: 10, alignItems: 'center',
            }}
          >
            {isScanning
              ? <ActivityIndicator size="small" color={RED} />
              : <Ionicons name="bluetooth" size={16} color={CYAN} />}
            <Text style={{
              color: isScanning ? RED : CYAN,
              fontSize: 12, fontWeight: '700', marginTop: 4,
            }}>
              {isScanning ? '停止扫描' : '扫描设备'}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push('/(app)/temp-comparison')}
            style={{
              flex: 1, backgroundColor: '#1A1A2E',
              borderWidth: 1, borderColor: '#7C4DFF',
              borderRadius: 6, paddingVertical: 10, alignItems: 'center',
            }}
          >
            <Ionicons name="stats-chart" size={16} color="#7C4DFF" />
            <Text style={{ color: '#7C4DFF', fontSize: 12, fontWeight: '700', marginTop: 4 }}>
              温度对比
            </Text>
          </Pressable>

          {connectedDevices.length > 1 && (
            <Pressable
              onPress={disconnectAllDevices}
              style={{
                flex: 1, backgroundColor: `${RED}15`,
                borderWidth: 1, borderColor: `${RED}60`,
                borderRadius: 6, paddingVertical: 10, alignItems: 'center',
              }}
            >
              <Ionicons name="close-circle" size={16} color={RED} />
              <Text style={{ color: RED, fontSize: 12, fontWeight: '700', marginTop: 4 }}>
                全部断开
              </Text>
            </Pressable>
          )}
        </View>

        {/* 已连接设备卡片 */}
        {connectedDevices.length === 0 ? (
          <View style={{
            alignItems: 'center', paddingVertical: 48,
            borderWidth: 1, borderColor: BORDER, borderRadius: 8,
            marginBottom: 16,
          }}>
            <Ionicons name="git-network-outline" size={40} color={MUTED} />
            <Text style={{ color: MUTED, fontSize: 14, marginTop: 12, fontWeight: '600' }}>
              暂无已连接设备
            </Text>
            <Text style={{ color: MUTED, fontSize: 12, marginTop: 6 }}>
              点击「扫描设备」并选择设备连接
            </Text>
          </View>
        ) : (
          <View style={{ marginBottom: 8 }}>
            <Text style={{ color: MUTED, fontSize: 11, marginBottom: 8, fontWeight: '700', letterSpacing: 0.5 }}>
              已连接设备 ({connectedDevices.length})
            </Text>
            {connectedDevices.map(device => {
              const info = deviceRuntimeInfo[device.id];
              return (
                <DeviceCard
                  key={device.id}
                  device={device}
                  isActive={activeDeviceId === device.id}
                  colorLabel={info?.colorLabel ?? 'cyan'}
                  customName={info?.customName}
                  latestTempMax={info?.latestTempMax}
                  latestTempMin={info?.latestTempMin}
                  latestTempAvg={info?.latestTempAvg}
                  onSetActive={() => setActiveDeviceId(device.id)}
                  onDisconnect={() => disconnectSpecificDevice(device.id)}
                  onRename={name => updateDeviceInfo(device.id, { customName: name })}
                  onRecolor={c => updateDeviceInfo(device.id, { colorLabel: c })}
                />
              );
            })}
          </View>
        )}

        {/* 扫描到的可连接设备 */}
        <ScanList
          devices={devices}
          connectedIds={connectedIds}
          maxReached={maxReached}
          onConnect={connectAdditionalDevice}
        />

        {/* 说明 */}
        <View style={{
          backgroundColor: `${CYAN}08`, borderWidth: 1, borderColor: `${CYAN}20`,
          borderRadius: 6, padding: 12, marginTop: 12,
        }}>
          <Text style={{ color: MUTED, fontSize: 11, lineHeight: 18 }}>
            最多同时连接 {MAX_CONNECTED_DEVICES} 台设备。点击设备卡片切换活动设备，
            活动设备的数据将在「数据监测」「热相」「图传」等页面展示。
            非活动设备实时采集温度数据用于对比分析。
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
