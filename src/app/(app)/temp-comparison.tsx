/**
 * 温度曲线对比页（Stack 级别）
 * 展示多设备在同一时间轴上的最高/平均/最低温度折线图
 * 支持时间范围切换：1min / 5min / 30min
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Line, Polyline, Text as SvgText, Rect, Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useBle } from '@/lib/bleContext';
import { DEVICE_COLOR_MAP } from '@/lib/types';

const BG     = '#121212';
const CARD   = '#1A1A1A';
const BORDER = '#2A2A2A';
const CYAN   = '#00E5FF';
const MUTED  = '#555555';
const TEXT   = '#E0E0E0';
const PURPLE = '#7C4DFF';

type TimeRange = 60 | 300 | 1800; // 秒
const TIME_RANGES: { label: string; value: TimeRange }[] = [
  { label: '1 分钟', value: 60 },
  { label: '5 分钟', value: 300 },
  { label: '30 分钟', value: 1800 },
];

type TempLine = 'max' | 'avg' | 'min';
const TEMP_LINES: { key: TempLine; label: string; dash?: string }[] = [
  { key: 'max', label: '最高' },
  { key: 'avg', label: '平均', dash: '4,3' },
  { key: 'min', label: '最低', dash: '1,3' },
];

// ── 折线图 ────────────────────────────────────────────────────────
interface ChartDataset {
  deviceId: string;
  deviceLabel: string;
  color: string;
  points: Array<{ ts: number; max: number; avg: number; min: number }>;
}

function MultiLineChart({
  datasets,
  rangeMs,
  width,
  activeLine,
}: {
  datasets: ChartDataset[];
  rangeMs: number;
  width: number;
  activeLine: TempLine;
}) {
  const height = 200;
  const padL = 42, padR = 8, padT = 12, padB = 28;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;
  const now = Date.now();
  const startMs = now - rangeMs * 1000;

  // 全部数据点求温度范围
  const allVals: number[] = [];
  datasets.forEach(ds =>
    ds.points.forEach(p => {
      allVals.push(p.max, p.avg, p.min);
    })
  );
  const rawMin = allVals.length > 0 ? Math.min(...allVals) : 0;
  const rawMax = allVals.length > 0 ? Math.max(...allVals) : 100;
  const pad = (rawMax - rawMin) * 0.12 || 5;
  const yMin = rawMin - pad;
  const yMax = rawMax + pad;

  const toX = (ts: number) => padL + ((ts - startMs) / (rangeMs * 1000)) * chartW;
  const toY = (val: number) => padT + chartH - ((val - yMin) / (yMax - yMin)) * chartH;

  // Y 轴刻度
  const yTicks = 5;
  const yTickVals = Array.from({ length: yTicks }, (_, i) => yMin + ((yMax - yMin) / (yTicks - 1)) * i);

  // X 轴刻度（5等分）
  const xTicks = 5;
  const xTickMs = Array.from({ length: xTicks }, (_, i) => startMs + (rangeMs * 1000 / (xTicks - 1)) * i);

  const noData = datasets.every(ds => ds.points.length === 0);

  return (
    <Svg width={width} height={height}>
      {/* 背景 */}
      <Rect x={0} y={0} width={width} height={height} fill={CARD} />

      {/* 网格线 */}
      {yTickVals.map((val, i) => (
        <Line
          key={i}
          x1={padL} y1={toY(val)} x2={padL + chartW} y2={toY(val)}
          stroke={BORDER} strokeWidth={1}
        />
      ))}
      {xTickMs.map((ts, i) => (
        <Line
          key={i}
          x1={toX(ts)} y1={padT} x2={toX(ts)} y2={padT + chartH}
          stroke={BORDER} strokeWidth={1}
        />
      ))}

      {/* Y 轴标签 */}
      {yTickVals.map((val, i) => (
        <SvgText
          key={i}
          x={padL - 4} y={toY(val) + 4}
          fill={MUTED} fontSize={9} textAnchor="end"
        >
          {val.toFixed(0)}
        </SvgText>
      ))}

      {/* X 轴标签 */}
      {xTickMs.map((ts, i) => {
        const d = new Date(ts);
        const label = `${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
        return (
          <SvgText
            key={i}
            x={toX(ts)} y={height - 4}
            fill={MUTED} fontSize={9} textAnchor="middle"
          >
            {label}
          </SvgText>
        );
      })}

      {/* 各设备折线 */}
      {!noData && datasets.map(ds => {
        const filtered = ds.points.filter(p => p.ts >= startMs);
        if (filtered.length < 2) return null;

        const lineKey = activeLine;
        const pts = filtered.map(p => `${toX(p.ts)},${toY(p[lineKey])}`).join(' ');

        return (
          <Polyline
            key={ds.deviceId}
            points={pts}
            fill="none"
            stroke={ds.color}
            strokeWidth={2}
          />
        );
      })}

      {/* 各设备最新值标记点 */}
      {!noData && datasets.map(ds => {
        const filtered = ds.points.filter(p => p.ts >= startMs);
        if (filtered.length === 0) return null;
        const last = filtered[filtered.length - 1];
        const val = last[activeLine];
        return (
          <Circle
            key={`dot_${ds.deviceId}`}
            cx={toX(last.ts)} cy={toY(val)} r={3}
            fill={ds.color}
          />
        );
      })}

      {/* 空态提示 */}
      {noData && (
        <SvgText
          x={padL + chartW / 2} y={padT + chartH / 2}
          fill={MUTED} fontSize={12} textAnchor="middle"
        >
          暂无温度数据
        </SvgText>
      )}
    </Svg>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────
export default function TempComparisonScreen() {
  const router = useRouter();
  const { connectedDevices, deviceRuntimeInfo } = useBle();
  const { width } = useWindowDimensions();
  const chartWidth = width - 28;

  const [timeRange, setTimeRange] = useState<TimeRange>(60);
  const [activeLine, setActiveLine] = useState<TempLine>('max');

  const datasets: ChartDataset[] = useMemo(() =>
    connectedDevices.map(device => {
      const info = deviceRuntimeInfo[device.id];
      const color = DEVICE_COLOR_MAP[info?.colorLabel ?? 'cyan'];
      const label = info?.customName ?? device.name ?? `设备 ${device.id.slice(-4)}`;
      return {
        deviceId: device.id,
        deviceLabel: label,
        color,
        points: info?.tempHistory ?? [],
      };
    }),
    [connectedDevices, deviceRuntimeInfo]
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['top']}>
      {/* 标题栏 */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 10,
        paddingHorizontal: 16, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: BORDER,
      }}>
        <Pressable
          cssInterop={false}
          onPress={() => router.back()}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 4 })}
        >
          <Ionicons name="arrow-back" size={20} color={CYAN} />
        </Pressable>
        <Text style={{ color: PURPLE, fontSize: 15, fontWeight: '800', letterSpacing: 1, flex: 1 }}>
          温度曲线对比
        </Text>
        <Text style={{ color: MUTED, fontSize: 11 }}>
          {connectedDevices.length} 台设备
        </Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 14, gap: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {/* 无设备提示 */}
        {connectedDevices.length === 0 && (
          <View style={{
            alignItems: 'center', paddingVertical: 64,
            borderWidth: 1, borderColor: BORDER, borderRadius: 8,
          }}>
            <Ionicons name="thermometer-outline" size={48} color={MUTED} />
            <Text style={{ color: MUTED, fontSize: 14, marginTop: 14, fontWeight: '600' }}>
              暂无已连接设备
            </Text>
            <Text style={{ color: MUTED, fontSize: 12, marginTop: 6 }}>
              请先在「多设备」页面连接设备
            </Text>
          </View>
        )}

        {connectedDevices.length > 0 && (
          <>
            {/* 控制条 */}
            <View style={{
              backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
              borderRadius: 8, padding: 12, gap: 10,
            }}>
              {/* 时间范围 */}
              <View>
                <Text style={{ color: MUTED, fontSize: 10, marginBottom: 6, fontWeight: '600' }}>
                  时间范围
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {TIME_RANGES.map(tr => (
                    <Pressable
                      key={tr.value}
                      cssInterop={false}
                      onPress={() => setTimeRange(tr.value)}
                      style={({ pressed }) => ({
                        flex: 1, paddingVertical: 7, borderRadius: 6, alignItems: 'center',
                        borderWidth: 1,
                        borderColor: timeRange === tr.value ? PURPLE : BORDER,
                        backgroundColor: timeRange === tr.value ? `${PURPLE}20` : 'transparent',
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Text style={{
                        color: timeRange === tr.value ? PURPLE : MUTED,
                        fontSize: 12, fontWeight: timeRange === tr.value ? '700' : '400',
                      }}>
                        {tr.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* 温度线类型 */}
              <View>
                <Text style={{ color: MUTED, fontSize: 10, marginBottom: 6, fontWeight: '600' }}>
                  显示温度线
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {TEMP_LINES.map(tl => (
                    <Pressable
                      key={tl.key}
                      cssInterop={false}
                      onPress={() => setActiveLine(tl.key)}
                      style={({ pressed }) => ({
                        flex: 1, paddingVertical: 7, borderRadius: 6, alignItems: 'center',
                        borderWidth: 1,
                        borderColor: activeLine === tl.key ? CYAN : BORDER,
                        backgroundColor: activeLine === tl.key ? `${CYAN}18` : 'transparent',
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Text style={{
                        color: activeLine === tl.key ? CYAN : MUTED,
                        fontSize: 12, fontWeight: activeLine === tl.key ? '700' : '400',
                      }}>
                        {tl.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>

            {/* 图例 */}
            <View style={{
              flexDirection: 'row', flexWrap: 'wrap', gap: 10,
              backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
              borderRadius: 8, padding: 12,
            }}>
              {datasets.map(ds => (
                <View key={ds.deviceId} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 14, height: 3, backgroundColor: ds.color, borderRadius: 2 }} />
                  <Text style={{ color: TEXT, fontSize: 11 }}>{ds.deviceLabel}</Text>
                </View>
              ))}
            </View>

            {/* 折线图 */}
            <View style={{
              backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
              borderRadius: 8, overflow: 'hidden',
            }}>
              <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 }}>
                <Text style={{ color: TEXT, fontSize: 12, fontWeight: '700' }}>
                  实时温度对比折线图
                </Text>
                <Text style={{ color: MUTED, fontSize: 10, marginTop: 2 }}>
                  显示：{TEMP_LINES.find(t => t.key === activeLine)?.label}温度 ·
                  时间轴：最近 {TIME_RANGES.find(t => t.value === timeRange)?.label}
                </Text>
              </View>
              <MultiLineChart
                datasets={datasets}
                rangeMs={timeRange}
                width={chartWidth}
                activeLine={activeLine}
              />
            </View>

            {/* 各设备最新值卡片 */}
            <View style={{ gap: 8 }}>
              <Text style={{ color: MUTED, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>
                实时温度摘要
              </Text>
              {datasets.map(ds => {
                const info = deviceRuntimeInfo[ds.deviceId];
                return (
                  <View key={ds.deviceId} style={{
                    backgroundColor: CARD, borderWidth: 1,
                    borderColor: `${ds.color}40`, borderRadius: 8, padding: 12,
                  }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: ds.color }} />
                      <Text style={{ color: TEXT, fontSize: 13, fontWeight: '700', flex: 1 }}>
                        {ds.deviceLabel}
                      </Text>
                      <Text style={{ color: MUTED, fontSize: 10 }}>
                        {ds.points.length} 个数据点
                      </Text>
                    </View>
                    {info?.latestTempMax !== undefined ? (
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TempMini
                          label="最高"
                          value={info.latestTempMax}
                          color="#FF3366"
                        />
                        <TempMini
                          label="平均"
                          value={info.latestTempAvg ?? 0}
                          color={ds.color}
                        />
                        <TempMini
                          label="最低"
                          value={info.latestTempMin ?? 0}
                          color="#00BFFF"
                        />
                      </View>
                    ) : (
                      <Text style={{ color: MUTED, fontSize: 11 }}>等待热相数据…</Text>
                    )}
                  </View>
                );
              })}
            </View>
          </>
        )}

        <View style={{ height: 16 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function TempMini({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={{
      flex: 1, backgroundColor: `${color}12`, borderRadius: 6, padding: 8, alignItems: 'center',
    }}>
      <Text style={{ color: MUTED, fontSize: 9, marginBottom: 3 }}>{label}</Text>
      <Text style={{ color, fontSize: 14, fontWeight: '800', fontFamily: 'monospace' }}>
        {value.toFixed(1)}℃
      </Text>
    </View>
  );
}
