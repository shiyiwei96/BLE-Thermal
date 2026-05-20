/**
 * 预警记录页 - 查看所有预警历史（BLE + 串口合并展示）
 */
import { useCallback, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useBle } from '@/lib/bleContext';
import { useSerial } from '@/lib/serialContext';
import type { AlertEntry, AlertType, ConnectionChannel } from '@/lib/types';

const CYAN = '#00E5FF';
const RED = '#FF3333';
const ORANGE = '#FF6B00';
const DARK_BG = '#121212';
const CARD_BG = '#1A1A1A';
const BORDER = '#333333';
const TEXT_PRIMARY = '#E0E0E0';
const TEXT_MUTED = '#666666';

// ============ 预警类型配置 ============
interface AlertConfig { label: string; icon: string; color: string; bgColor: string; }

const ALERT_CONFIGS: Record<AlertType, AlertConfig> = {
  RSSI_WEAK:           { label: '信号弱',   icon: 'wifi-outline',          color: ORANGE, bgColor: `${ORANGE}20` },
  DATA_TIMEOUT:        { label: '数据超时', icon: 'time-outline',           color: ORANGE, bgColor: `${ORANGE}20` },
  CONNECTION_LOST:     { label: '连接断开', icon: 'close-circle-outline',   color: RED,    bgColor: `${RED}20` },
  DATA_THRESHOLD:      { label: '数据报警', icon: 'alert-circle-outline',   color: RED,    bgColor: `${RED}20` },
  SERIAL_DISCONNECTED: { label: '串口断开', icon: 'hardware-chip-outline',  color: RED,    bgColor: `${RED}20` },
  SIMILARITY_DROP:     { label: '相似度骤降', icon: 'analytics-outline',    color: RED,    bgColor: `${RED}20` },
};

// 通道颜色
const channelColor = (ch?: ConnectionChannel) => ch === 'SERIAL' ? ORANGE : CYAN;

// ============ 预警条目 ============
function AlertItem({ entry }: { entry: AlertEntry }) {
  const config = ALERT_CONFIGS[entry.type] ?? { label: entry.type, icon: 'alert-outline', color: ORANGE, bgColor: `${ORANGE}20` };
  const time = new Date(entry.timestamp);
  const timeStr = time.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
    + ' ' + time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  const devIcon = entry.channel === 'SERIAL' ? 'hardware-chip' : 'bluetooth';
  const chColor = channelColor(entry.channel);

  return (
    <View style={{
      marginHorizontal: 16, marginVertical: 4, backgroundColor: CARD_BG,
      borderLeftColor: config.color, borderLeftWidth: 3,
      borderWidth: 1, borderColor: BORDER, borderRadius: 2, padding: 12, gap: 6,
    }}>
      {/* 顶行：类型标签 + 通道标记 + 时间 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: config.bgColor, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 2 }}>
            <Ionicons name={config.icon as any} size={12} color={config.color} />
            <Text style={{ color: config.color, fontSize: 11, fontWeight: '700' }}>{config.label}</Text>
          </View>
          {/* 通道标签 */}
          <View style={{ borderColor: `${chColor}60`, borderWidth: 1, borderRadius: 2, paddingHorizontal: 5, paddingVertical: 2 }}>
            <Text style={{ color: chColor, fontSize: 9, fontWeight: '800' }}>
              {entry.channel ?? 'BLE'}
            </Text>
          </View>
        </View>
        <Text style={{ color: TEXT_MUTED, fontSize: 10, fontFamily: 'monospace' }}>{timeStr}</Text>
      </View>

      {/* 设备信息 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Ionicons name={devIcon} size={11} color={TEXT_MUTED} />
        <Text style={{ color: TEXT_MUTED, fontSize: 11, fontFamily: 'monospace' }}>
          {entry.deviceName ?? entry.deviceId}
        </Text>
      </View>

      {/* 预警详情 */}
      <Text style={{ color: TEXT_PRIMARY, fontSize: 12, lineHeight: 17 }}>{entry.detail}</Text>
    </View>
  );
}

// ============ 主页面 ============
export default function AlertsScreen() {
  const { alerts, clearAlerts } = useBle();
  const { serialAlerts, clearSerialAlerts } = useSerial();
  const [filter, setFilter] = useState<'ALL' | 'BLE' | 'SERIAL'>('ALL');

  // 合并并按时间降序排列
  const allAlerts: AlertEntry[] = [
    ...alerts.map(a => ({ ...a, channel: a.channel ?? ('BLE' as ConnectionChannel) })),
    ...serialAlerts,
  ].sort((a, b) => b.timestamp - a.timestamp);

  const filtered = filter === 'ALL' ? allAlerts
    : filter === 'BLE' ? allAlerts.filter(a => a.channel !== 'SERIAL')
    : allAlerts.filter(a => a.channel === 'SERIAL');

  const handleClearAll = useCallback(() => {
    clearAlerts();
    clearSerialAlerts();
  }, [clearAlerts, clearSerialAlerts]);

  // 统计
  const bleCount = allAlerts.filter(a => a.channel !== 'SERIAL').length;
  const serialCount = allAlerts.filter(a => a.channel === 'SERIAL').length;
  const criticalCount = allAlerts.filter(a => a.type === 'CONNECTION_LOST' || a.type === 'DATA_THRESHOLD' || a.type === 'SERIAL_DISCONNECTED').length;
  const warnCount = allAlerts.length - criticalCount;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: DARK_BG }}>
      {/* ===== 顶部标题栏 ===== */}
      <View style={{
        paddingHorizontal: 16, paddingVertical: 12,
        borderBottomColor: BORDER, borderBottomWidth: 1, backgroundColor: '#0F0F0F',
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <View>
          <Text style={{ color: CYAN, fontSize: 16, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1 }}>
            ALERT LOG
          </Text>
          <Text style={{ color: TEXT_MUTED, fontSize: 10, marginTop: 1 }}>
            共 {allAlerts.length} 条预警  ·  BLE: {bleCount}  ·  串口: {serialCount}
          </Text>
        </View>
        {allAlerts.length > 0 && (
          <Pressable
            cssInterop={false} onPress={handleClearAll}
            style={({ pressed }) => ({ borderColor: TEXT_MUTED, borderWidth: 1, borderRadius: 2, paddingHorizontal: 10, paddingVertical: 6, opacity: pressed ? 0.7 : 1 })}
          >
            <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>清空</Text>
          </Pressable>
        )}
      </View>

      {/* ===== 统计卡片 ===== */}
      <View style={{ flexDirection: 'row', backgroundColor: '#0F0F0F', borderBottomColor: BORDER, borderBottomWidth: 1, padding: 12, gap: 8 }}>
        {[
          { label: '严重', count: criticalCount, color: RED },
          { label: '警告', count: warnCount, color: ORANGE },
          { label: 'BLE', count: bleCount, color: CYAN },
          { label: '串口', count: serialCount, color: ORANGE },
        ].map(({ label, count, color }) => (
          <View key={label} style={{
            flex: 1, backgroundColor: CARD_BG, borderColor: count > 0 ? color : BORDER,
            borderWidth: 1, borderRadius: 2, padding: 10, alignItems: 'center', gap: 4,
          }}>
            <Text style={{ color: count > 0 ? color : TEXT_MUTED, fontSize: 22, fontWeight: '800', fontFamily: 'monospace' }}>{count}</Text>
            <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>{label}</Text>
          </View>
        ))}
      </View>

      {/* ===== 来源筛选器 ===== */}
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#0F0F0F', borderBottomColor: BORDER, borderBottomWidth: 1 }}>
        {(['ALL', 'BLE', 'SERIAL'] as const).map(f => {
          const active = filter === f;
          const color = f === 'SERIAL' ? ORANGE : f === 'BLE' ? CYAN : TEXT_PRIMARY;
          const labels = { ALL: '全部', BLE: 'BLE 蓝牙', SERIAL: 'USB 串口' };
          return (
            <Pressable
              key={f} cssInterop={false} onPress={() => setFilter(f)}
              style={({ pressed }) => ({
                paddingHorizontal: 12, paddingVertical: 5, borderRadius: 2, borderWidth: 1,
                borderColor: active ? color : BORDER,
                backgroundColor: active ? `${color}18` : 'transparent',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: active ? color : TEXT_MUTED, fontSize: 11, fontWeight: active ? '800' : '400' }}>
                {labels[f]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* ===== 预警列表 ===== */}
      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <AlertItem entry={item} />}
        contentContainerStyle={{ paddingVertical: 8 }}
        contentInsetAdjustmentBehavior="automatic"
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 80, gap: 10 }}>
            <Ionicons name="checkmark-circle-outline" size={52} color={CYAN} />
            <Text style={{ color: TEXT_MUTED, fontSize: 14, fontWeight: '600' }}>暂无预警记录</Text>
            <Text style={{ color: TEXT_MUTED, fontSize: 12 }}>系统运行正常</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}
