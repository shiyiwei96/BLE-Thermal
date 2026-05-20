/**
 * 数据统计页 - 显示RSSI折线图、字段历史趋势图和收发统计
 * 支持 BLE 蓝牙 和 USB 串口 双数据源
 */
import { useWindowDimensions } from 'react-native';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';

import { useBle } from '@/lib/bleContext';
import { useSerial } from '@/lib/serialContext';
import { useConnectionMode } from '@/lib/connectionMode';
import { getRssiColor } from '@/lib/bleService';
import type { FieldHistoryPoint } from '@/lib/types';

const CYAN = '#00E5FF';
const RED = '#FF3333';
const GREEN = '#00E676';
const ORANGE = '#FF6B00';
const DARK_BG = '#121212';
const CARD_BG = '#1A1A1A';
const BORDER = '#333333';
const TEXT_PRIMARY = '#E0E0E0';
const TEXT_MUTED = '#666666';

// ============ 格式化字节数 ============
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// ============ RSSI 折线图 ============
function RssiLineChart({
  data,
  threshold,
  width,
}: {
  data: Array<{ timestamp: number; value: number }>;
  threshold: number;
  width: number;
}) {
  const height = 160;
  const paddingLeft = 40;
  const paddingRight = 12;
  const paddingTop = 12;
  const paddingBottom = 24;

  const chartW = width - paddingLeft - paddingRight;
  const chartH = height - paddingTop - paddingBottom;

  if (data.length === 0) {
    return (
      <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: TEXT_MUTED, fontSize: 12 }}>暂无RSSI数据</Text>
      </View>
    );
  }

  // RSSI 范围：-100 ~ -30
  const minRssi = -100;
  const maxRssi = -30;
  const rssiRange = maxRssi - minRssi;

  // 计算坐标映射
  const toX = (index: number) => {
    if (data.length <= 1) return paddingLeft + chartW / 2;
    return paddingLeft + (index / (data.length - 1)) * chartW;
  };
  const toY = (rssi: number) => {
    return paddingTop + ((maxRssi - rssi) / rssiRange) * chartH;
  };

  // 折线路径
  const points = data.map((d, i) => `${toX(i)},${toY(d.value)}`).join(' ');

  // Y轴刻度
  const yTicks = [-30, -50, -70, -90];

  // 阈值线Y坐标
  const thresholdY = toY(threshold);

  // 当前RSSI点颜色
  const lastRssi = data[data.length - 1]?.value ?? -65;
  const dotColor = getRssiColor(lastRssi);

  return (
    <Svg width={width} height={height}>
      {/* 背景 */}
      <Rect x={0} y={0} width={width} height={height} fill={CARD_BG} />

      {/* Y轴刻度线（水平参考线，极细） */}
      {yTicks.map(tick => (
        <Line
          key={tick}
          x1={paddingLeft}
          y1={toY(tick)}
          x2={paddingLeft + chartW}
          y2={toY(tick)}
          stroke="#222222"
          strokeWidth={1}
        />
      ))}

      {/* Y轴刻度标签 */}
      {yTicks.map(tick => (
        <SvgText
          key={tick}
          x={paddingLeft - 4}
          y={toY(tick) + 4}
          fontSize={9}
          fill={TEXT_MUTED}
          textAnchor="end"
          fontFamily="monospace"
        >
          {tick}
        </SvgText>
      ))}

      {/* 预警阈值线 */}
      <Line
        x1={paddingLeft}
        y1={thresholdY}
        x2={paddingLeft + chartW}
        y2={thresholdY}
        stroke={RED}
        strokeWidth={1}
        strokeDasharray="4,3"
      />
      <SvgText
        x={paddingLeft + chartW - 2}
        y={thresholdY - 3}
        fontSize={8}
        fill={RED}
        textAnchor="end"
        fontFamily="monospace"
      >
        预警阈值 {threshold}
      </SvgText>

      {/* X轴 */}
      <Line
        x1={paddingLeft}
        y1={paddingTop + chartH}
        x2={paddingLeft + chartW}
        y2={paddingTop + chartH}
        stroke={BORDER}
        strokeWidth={1}
      />
      {/* Y轴 */}
      <Line
        x1={paddingLeft}
        y1={paddingTop}
        x2={paddingLeft}
        y2={paddingTop + chartH}
        stroke={BORDER}
        strokeWidth={1}
      />

      {/* RSSI 折线 */}
      {data.length > 1 && (
        <Polyline
          points={points}
          fill="none"
          stroke={CYAN}
          strokeWidth={1.5}
        />
      )}

      {/* 最新数据点 */}
      {data.length > 0 && (
        <Circle
          cx={toX(data.length - 1)}
          cy={toY(lastRssi)}
          r={3}
          fill={dotColor}
          stroke={DARK_BG}
          strokeWidth={1}
        />
      )}

      {/* X轴时间标签（首尾） */}
      {data.length > 1 && (
        <>
          <SvgText
            x={paddingLeft}
            y={height - 4}
            fontSize={8}
            fill={TEXT_MUTED}
            textAnchor="start"
            fontFamily="monospace"
          >
            {new Date(data[0].timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
          </SvgText>
          <SvgText
            x={paddingLeft + chartW}
            y={height - 4}
            fontSize={8}
            fill={TEXT_MUTED}
            textAnchor="end"
            fontFamily="monospace"
          >
            {new Date(data[data.length - 1].timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
          </SvgText>
        </>
      )}
    </Svg>
  );
}

// ============ 统计卡片 ============
function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: CARD_BG,
        borderColor: BORDER,
        borderWidth: 1,
        borderRadius: 2,
        padding: 12,
        gap: 4,
      }}
    >
      <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>{label}</Text>
      <Text style={{ color: color ?? TEXT_PRIMARY, fontSize: 20, fontWeight: '800', fontFamily: 'monospace' }}>
        {value}
      </Text>
      {sub && <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>{sub}</Text>}
    </View>
  );
}

// ============ 字段历史折线图 ============
function FieldLineChart({
  data,
  label,
  unit,
  color,
  alertValue,
  alertOp,
  width,
}: {
  data: FieldHistoryPoint[];
  label: string;
  unit: string;
  color: string;
  alertValue?: number;
  alertOp?: string;
  width: number;
}) {
  const height = 120;
  const paddingLeft = 42;
  const paddingRight = 12;
  const paddingTop = 10;
  const paddingBottom = 22;

  const chartW = width - paddingLeft - paddingRight;
  const chartH = height - paddingTop - paddingBottom;

  if (data.length < 2) {
    return (
      <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>数据不足，等待更多采样...</Text>
      </View>
    );
  }

  const values = data.map(d => d.value);
  let minVal = Math.min(...values);
  let maxVal = Math.max(...values);
  if (minVal === maxVal) { minVal -= 1; maxVal += 1; }
  const range = maxVal - minVal;
  const pad = range * 0.15;
  const yMin = minVal - pad;
  const yMax = maxVal + pad;
  const yRange = yMax - yMin;

  const toX = (i: number) => paddingLeft + (i / (data.length - 1)) * chartW;
  const toY = (v: number) => paddingTop + ((yMax - v) / yRange) * chartH;

  const points = data.map((d, i) => `${toX(i)},${toY(d.value)}`).join(' ');
  const lastVal = data[data.length - 1].value;

  // Y 轴最多4个刻度
  const tickCount = 3;
  const yTicks = Array.from({ length: tickCount + 1 }, (_, i) =>
    parseFloat((yMin + (yRange / tickCount) * i).toFixed(1))
  );

  // 报警阈值线
  const showAlertLine = alertValue !== undefined && alertValue >= yMin && alertValue <= yMax;
  const alertY = showAlertLine ? toY(alertValue!) : 0;

  return (
    <Svg width={width} height={height}>
      <Rect x={0} y={0} width={width} height={height} fill={CARD_BG} />

      {/* Y轴参考线 */}
      {yTicks.map((tick, i) => (
        <Line
          key={i}
          x1={paddingLeft} y1={toY(tick)}
          x2={paddingLeft + chartW} y2={toY(tick)}
          stroke="#1E1E1E" strokeWidth={1}
        />
      ))}

      {/* Y轴刻度标签 */}
      {yTicks.map((tick, i) => (
        <SvgText
          key={i}
          x={paddingLeft - 4} y={toY(tick) + 4}
          fontSize={8} fill={TEXT_MUTED}
          textAnchor="end" fontFamily="monospace"
        >
          {tick}
        </SvgText>
      ))}

      {/* 报警阈值线 */}
      {showAlertLine && (
        <>
          <Line
            x1={paddingLeft} y1={alertY}
            x2={paddingLeft + chartW} y2={alertY}
            stroke={RED} strokeWidth={1} strokeDasharray="4,3"
          />
          <SvgText
            x={paddingLeft + chartW - 2} y={alertY - 3}
            fontSize={7} fill={RED} textAnchor="end" fontFamily="monospace"
          >
            阈值 {alertOp}{alertValue}{unit}
          </SvgText>
        </>
      )}

      {/* 轴线 */}
      <Line x1={paddingLeft} y1={paddingTop + chartH} x2={paddingLeft + chartW} y2={paddingTop + chartH} stroke={BORDER} strokeWidth={1} />
      <Line x1={paddingLeft} y1={paddingTop} x2={paddingLeft} y2={paddingTop + chartH} stroke={BORDER} strokeWidth={1} />

      {/* 折线 */}
      <Polyline points={points} fill="none" stroke={color} strokeWidth={1.5} />

      {/* 最新数据点 */}
      <Circle cx={toX(data.length - 1)} cy={toY(lastVal)} r={3} fill={color} stroke={DARK_BG} strokeWidth={1} />

      {/* X轴首尾时间 */}
      <SvgText x={paddingLeft} y={height - 4} fontSize={7} fill={TEXT_MUTED} textAnchor="start" fontFamily="monospace">
        {new Date(data[0].timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
      </SvgText>
      <SvgText x={paddingLeft + chartW} y={height - 4} fontSize={7} fill={TEXT_MUTED} textAnchor="end" fontFamily="monospace">
        {new Date(data[data.length - 1].timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
      </SvgText>
    </Svg>
  );
}

// 字段颜色池
const FIELD_COLORS = ['#00E5FF', '#00E676', '#FFB300', '#BF80FF', '#FF6B9D', '#FF9F43', '#54A0FF'];
function getFieldColor(index: number): string {
  return FIELD_COLORS[index % FIELD_COLORS.length];
}

// ============ 主页面 ============
export default function StatsScreen() {
  const { activeChannel, setActiveChannel } = useConnectionMode();
  const isBle = activeChannel === 'BLE';
  const accentColor = isBle ? CYAN : ORANGE;

  const { connectedDevice, stats: bleStats, dataLogs: bleLogs, settings, parsedFields: bleParsedFields } = useBle();
  const { connectedSerial, serialStats, serialLogs, serialParsedFields } = useSerial();

  const stats = isBle ? bleStats : serialStats;
  const dataLogs = isBle ? bleLogs : serialLogs;
  const parsedFields = isBle ? bleParsedFields : serialParsedFields;
  const { width } = useWindowDimensions();

  const chartWidth = width - 32;

  // 计算平均RSSI（仅BLE有意义）
  const avgRssi = stats.rssiHistory.length > 0
    ? Math.round(stats.rssiHistory.reduce((sum, d) => sum + d.value, 0) / stats.rssiHistory.length)
    : null;
  const minRssiVal = stats.rssiHistory.length > 0 ? Math.min(...stats.rssiHistory.map(d => d.value)) : null;
  const maxRssiVal = stats.rssiHistory.length > 0 ? Math.max(...stats.rssiHistory.map(d => d.value)) : null;

  const totalBytes = stats.totalRxBytes + stats.totalTxBytes;
  const rxPct = totalBytes > 0 ? Math.round((stats.totalRxBytes / totalBytes) * 100) : 0;

  const parsedFieldEntries = Object.values(parsedFields);

  const deviceLabel = isBle
    ? (connectedDevice ? (connectedDevice.name ?? connectedDevice.address) : '未连接')
    : (connectedSerial ? connectedSerial.displayName : '未连接');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: DARK_BG }}>
      {/* ===== 顶部标题栏 ===== */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomColor: BORDER, borderBottomWidth: 1, backgroundColor: '#0F0F0F' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Text style={{ color: accentColor, fontSize: 16, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1 }}>
              DATA STATS
            </Text>
            <Text style={{ color: TEXT_MUTED, fontSize: 10, marginTop: 1 }}>{deviceLabel}</Text>
          </View>
          {/* 通道切换 */}
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {(['BLE', 'SERIAL'] as const).map(ch => {
              const active = activeChannel === ch;
              const color = ch === 'BLE' ? CYAN : ORANGE;
              return (
                <Pressable
                  key={ch} cssInterop={false} onPress={() => setActiveChannel(ch)}
                  style={({ pressed }) => ({
                    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 2, borderWidth: 1,
                    borderColor: active ? color : BORDER,
                    backgroundColor: active ? `${color}18` : 'transparent',
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ color: active ? color : TEXT_MUTED, fontSize: 11, fontWeight: active ? '800' : '400' }}>
                    {ch === 'BLE' ? '蓝牙' : '串口'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} contentInsetAdjustmentBehavior="automatic">

        {/* ===== RSSI 折线图（仅 BLE 模式） ===== */}
        {isBle && (
          <>
            <View style={{ backgroundColor: CARD_BG, borderColor: BORDER, borderWidth: 1, borderRadius: 2, overflow: 'hidden' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 }}>
                <Text style={{ color: TEXT_PRIMARY, fontSize: 12, fontWeight: '700' }}>RSSI 信号强度趋势</Text>
                {connectedDevice && (
                  <Text style={{ color: getRssiColor(connectedDevice.rssi), fontSize: 14, fontWeight: '800', fontFamily: 'monospace' }}>
                    {connectedDevice.rssi} dBm
                  </Text>
                )}
              </View>
              <RssiLineChart data={stats.rssiHistory} threshold={settings.rssiThreshold} width={chartWidth} />
              <View style={{ flexDirection: 'row', gap: 16, paddingHorizontal: 12, paddingVertical: 8, borderTopColor: '#1E1E1E', borderTopWidth: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <View style={{ width: 16, height: 2, backgroundColor: CYAN }} />
                  <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>RSSI</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <View style={{ width: 16, height: 1, backgroundColor: RED }} />
                  <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>预警阈值</Text>
                </View>
                <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>记录点: {stats.rssiHistory.length}</Text>
              </View>
            </View>

            {stats.rssiHistory.length > 0 && (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <StatCard label="当前 RSSI" value={`${connectedDevice?.rssi ?? '--'}`} sub="dBm" color={connectedDevice ? getRssiColor(connectedDevice.rssi) : TEXT_MUTED} />
                <StatCard label="平均 RSSI" value={avgRssi !== null ? `${avgRssi}` : '--'} sub="dBm" />
                <StatCard label="最低 / 最高" value={minRssiVal !== null ? `${minRssiVal}` : '--'} sub={maxRssiVal !== null ? `最高 ${maxRssiVal} dBm` : undefined} color={minRssiVal !== null ? getRssiColor(minRssiVal) : TEXT_MUTED} />
              </View>
            )}
          </>
        )}

        {/* ===== 串口模式：连接状态卡片 ===== */}
        {!isBle && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <StatCard label="串口设备" value={connectedSerial ? '已连接' : '未连接'} sub={connectedSerial?.displayName} color={connectedSerial ? ORANGE : TEXT_MUTED} />
            <StatCard label="记录条数" value={`${dataLogs.length}`} sub="条" color={ORANGE} />
            <StatCard label="解析字段" value={`${parsedFieldEntries.length}`} sub="个" color={ORANGE} />
          </View>
        )}

        {/* ===== 解析字段历史趋势图 ===== */}
        {parsedFieldEntries.length > 0 && (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: BORDER }} />
              <Text style={{ color: accentColor, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 }}>FIELD TRENDS</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: BORDER }} />
            </View>

            {parsedFieldEntries.map((field, idx) => {
              const mapping = settings.fieldMappings.find(m => m.fieldKey.toUpperCase() === field.key.toUpperCase());
              const label = mapping?.label ?? field.key;
              const unit = mapping?.unit ?? '';
              const color = getFieldColor(idx);
              const matchedRule = settings.dataAlertRules.find(r => r.enabled && r.fieldKey.toUpperCase() === field.key.toUpperCase());
              const currentVal = field.value;
              const isAlerting = matchedRule
                ? (() => {
                    switch (matchedRule.operator) {
                      case '>':  return currentVal > matchedRule.value;
                      case '<':  return currentVal < matchedRule.value;
                      case '>=': return currentVal >= matchedRule.value;
                      case '<=': return currentVal <= matchedRule.value;
                      case '==': return Math.abs(currentVal - matchedRule.value) < 0.0001;
                    }
                  })()
                : false;

              const historyData = field.history ?? [];

              return (
                <View key={field.key} style={{ backgroundColor: isAlerting ? `${RED}10` : CARD_BG, borderColor: isAlerting ? RED : BORDER, borderWidth: 1, borderRadius: 2, overflow: 'hidden' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {isAlerting && (
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: RED }} />
                      )}
                      <Text style={{ color: isAlerting ? RED : TEXT_PRIMARY, fontSize: 12, fontWeight: '700' }}>
                        {label}
                      </Text>
                      <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>({field.key})</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
                      <Text style={{ color: isAlerting ? RED : color, fontSize: 20, fontWeight: '800', fontFamily: 'monospace' }}>
                        {currentVal % 1 === 0 ? currentVal.toString() : currentVal.toFixed(1)}
                      </Text>
                      <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>{unit}</Text>
                    </View>
                  </View>
                  <FieldLineChart data={historyData} label={label} color={isAlerting ? RED : color} width={chartWidth} unit={unit} />
                  {matchedRule && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderTopColor: '#1E1E1E', borderTopWidth: 1 }}>
                      <Ionicons name={isAlerting ? 'alert-circle' : 'alert-circle-outline'} size={12} color={isAlerting ? RED : TEXT_MUTED} />
                      <Text style={{ color: isAlerting ? RED : TEXT_MUTED, fontSize: 10 }}>
                        报警条件: {field.key} {matchedRule.operator} {matchedRule.value} {unit}
                        {isAlerting ? '  ⚠ 当前已触发' : '  ✓ 未触发'}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* ===== 收发统计 ===== */}
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: BORDER }} />
            <Text style={{ color: accentColor, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 }}>TX / RX STATS</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: BORDER }} />
          </View>

          <View style={{ flexDirection: 'row', gap: 8 }}>
            <StatCard label="总接收" value={formatBytes(stats.totalRxBytes)} sub={`占 ${rxPct}%`} color={accentColor} />
            <StatCard label="总发送" value={formatBytes(stats.totalTxBytes)} sub={`占 ${100 - rxPct}%`} color={GREEN} />
            <StatCard label="总条目" value={`${dataLogs.length}`} sub="条记录" />
          </View>

          {/* RX/TX 占比条 */}
          {totalBytes > 0 && (
            <View style={{ backgroundColor: CARD_BG, borderColor: BORDER, borderWidth: 1, borderRadius: 2, padding: 12, gap: 8 }}>
              <Text style={{ color: TEXT_MUTED, fontSize: 10, fontWeight: '700' }}>收发比例</Text>
              <View style={{ height: 12, borderRadius: 2, overflow: 'hidden', flexDirection: 'row' }}>
                <View style={{ flex: rxPct, backgroundColor: accentColor, opacity: 0.8 }} />
                <View style={{ flex: 100 - rxPct, backgroundColor: GREEN, opacity: 0.8 }} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <View style={{ width: 10, height: 10, backgroundColor: accentColor, borderRadius: 1 }} />
                  <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>RX {rxPct}%</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <View style={{ width: 10, height: 10, backgroundColor: GREEN, borderRadius: 1 }} />
                  <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>TX {100 - rxPct}%</Text>
                </View>
              </View>
            </View>
          )}

          {/* 无数据提示 */}
          {totalBytes === 0 && (
            <View style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
              <Ionicons name={isBle ? 'bluetooth-outline' : 'hardware-chip-outline'} size={40} color={TEXT_MUTED} />
              <Text style={{ color: TEXT_MUTED, fontSize: 13 }}>暂无收发数据</Text>
              <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>
                {isBle ? '请先连接 BLE 设备并收发数据' : '请先连接串口设备并收发数据'}
              </Text>
            </View>
          )}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}