/**
 * 模型比对页 — 机器学习特征提取 + 实时 BLE 图传比对分析
 * 工业级暗色仪表盘风格
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

import { useBle } from '@/lib/bleContext';
import {
  buildReferenceModel,
  calcTrendStats,
  compareImages,
} from '@/lib/mlComparison';
import { parseRgbBuffer, rgbaToBmpDataUri } from '@/lib/fileAnalysis';
import {
  COMPARISON_GRID,
  DEFAULT_DIFF_THRESHOLD,
  DEFAULT_SIMILARITY_ALERT,
  MAX_COMPARISON_HISTORY,
  type ComparisonResult,
  type ReferenceModel,
  type RgbFileParams,
} from '@/lib/types';
import { genId } from '@/lib/bleService';

// ─── 主题 ────────────────────────────────────────────────────────────────────
const BG        = '#121212';
const CARD_BG   = '#1E1E1E';
const BORDER    = '#2A2A2A';
const CYAN      = '#00E5FF';
const GREEN     = '#00E676';
const RED       = '#FF3366';
const ORANGE    = '#FF9100';
const TEXT_PRI  = '#E0E0E0';
const TEXT_MUT  = '#666666';

// ─── 辅助组件 ─────────────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 18, paddingBottom: 4 }}>
      <Text style={{ color: TEXT_MUT, fontSize: 10, fontWeight: '700', letterSpacing: 1.2 }}>
        {title.toUpperCase()}
      </Text>
    </View>
  );
}

function Badge({
  label, value, color = CYAN,
}: { label: string; value: string; color?: string }) {
  return (
    <View style={{
      flex: 1, backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
      borderRadius: 2, padding: 8, alignItems: 'center', gap: 2,
    }}>
      <Text style={{ color: TEXT_MUT, fontSize: 9 }}>{label}</Text>
      <Text style={{ color, fontSize: 14, fontFamily: 'monospace', fontWeight: '800' }}>{value}</Text>
    </View>
  );
}

/** 简易折线图（SVG-less，纯 View） */
function SparkLine({ scores, h = 40 }: { scores: number[]; h?: number }) {
  if (scores.length < 2) {
    return (
      <View style={{ height: h, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: TEXT_MUT, fontSize: 10 }}>暂无数据</Text>
      </View>
    );
  }
  const max = 100;
  const barW = 10;
  const gap = 4;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: h, gap }}>
      {scores.map((s, i) => {
        const color = s >= 70 ? GREEN : s >= 40 ? ORANGE : RED;
        return (
          <View key={i} style={{ alignItems: 'center', gap: 2 }}>
            <View style={{
              width: barW,
              height: Math.max(2, Math.round((s / max) * h)),
              backgroundColor: color,
              borderRadius: 1,
            }} />
          </View>
        );
      })}
    </View>
  );
}

/** 4×4 网格异常块可视化 */
function AnomalyGrid({
  anomalyBlocks, size = 96,
}: { anomalyBlocks: number[]; size?: number }) {
  const cellSize = size / COMPARISON_GRID;
  const cells = Array.from({ length: COMPARISON_GRID * COMPARISON_GRID }, (_, i) => i);
  return (
    <View style={{ width: size, height: size, flexDirection: 'row', flexWrap: 'wrap' }}>
      {cells.map(idx => {
        const isAnomaly = anomalyBlocks.includes(idx);
        return (
          <View key={idx} style={{
            width: cellSize, height: cellSize,
            borderWidth: 0.5, borderColor: isAnomaly ? RED : BORDER,
            backgroundColor: isAnomaly ? `${RED}30` : 'transparent',
          }} />
        );
      })}
    </View>
  );
}

/** 评分颜色 */
function scoreColor(s: number) {
  if (s >= 70) return GREEN;
  if (s >= 40) return ORANGE;
  return RED;
}

/** 大评分数字卡片 */
function ScoreCard({ score }: { score: number }) {
  const color = scoreColor(score);
  return (
    <View style={{
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: `${color}12`, borderWidth: 1, borderColor: color,
      borderRadius: 2, paddingHorizontal: 16, paddingVertical: 8,
      minWidth: 72,
    }}>
      <Text style={{ color, fontSize: 36, fontFamily: 'monospace', fontWeight: '900' }}>
        {score}
      </Text>
      <Text style={{ color, fontSize: 9, letterSpacing: 1 }}>/ 100</Text>
    </View>
  );
}

// ─── RGB 参数快速输入面板 ─────────────────────────────────────────────────────

function RgbParamsPanel({
  params, onChange,
}: { params: RgbFileParams; onChange: (p: RgbFileParams) => void }) {
  const inp = {
    backgroundColor: '#111', borderWidth: 1, borderColor: BORDER,
    borderRadius: 2, paddingHorizontal: 8, paddingVertical: 5,
    color: CYAN, fontSize: 12, fontFamily: 'monospace' as const,
  };
  return (
    <View style={{
      backgroundColor: CARD_BG, borderWidth: 1, borderColor: CYAN,
      borderRadius: 2, padding: 12, gap: 8,
    }}>
      <Text style={{ color: CYAN, fontSize: 11, fontWeight: '700' }}>RGB / RAW 参数</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: TEXT_MUT, fontSize: 9, marginBottom: 3 }}>宽度</Text>
          <TextInput style={inp} value={params.width > 0 ? String(params.width) : ''} keyboardType="numeric"
            placeholder="640" placeholderTextColor={TEXT_MUT}
            onChangeText={v => onChange({ ...params, width: parseInt(v) || 0 })} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: TEXT_MUT, fontSize: 9, marginBottom: 3 }}>高度</Text>
          <TextInput style={inp} value={params.height > 0 ? String(params.height) : ''} keyboardType="numeric"
            placeholder="480" placeholderTextColor={TEXT_MUT}
            onChangeText={v => onChange({ ...params, height: parseInt(v) || 0 })} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {([1, 3, 4] as const).map(ch => (
          <Pressable key={ch} cssInterop={false}
            onPress={() => onChange({ ...params, channels: ch })}
            style={({ pressed }) => ({
              flex: 1, paddingVertical: 5, borderRadius: 2, borderWidth: 1,
              borderColor: params.channels === ch ? CYAN : BORDER,
              backgroundColor: params.channels === ch ? `${CYAN}15` : 'transparent',
              alignItems: 'center', opacity: pressed ? 0.7 : 1,
            })}>
            <Text style={{ color: params.channels === ch ? CYAN : TEXT_MUT, fontSize: 11, fontWeight: '700' }}>
              {ch === 1 ? '灰度' : ch === 3 ? 'RGB' : 'RGBA'}
            </Text>
          </Pressable>
        ))}
        {(['uint8', 'uint16'] as const).map(d => (
          <Pressable key={d} cssInterop={false}
            onPress={() => onChange({ ...params, depth: d })}
            style={({ pressed }) => ({
              flex: 1, paddingVertical: 5, borderRadius: 2, borderWidth: 1,
              borderColor: params.depth === d ? ORANGE : BORDER,
              backgroundColor: params.depth === d ? `${ORANGE}15` : 'transparent',
              alignItems: 'center', opacity: pressed ? 0.7 : 1,
            })}>
            <Text style={{ color: params.depth === d ? ORANGE : TEXT_MUT, fontSize: 11, fontWeight: '700' }}>
              {d}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ─── 主页面 ──────────────────────────────────────────────────────────────────

export default function ModelComparisonScreen() {
  const { imageHistory, alerts, connectedDevice } = useBle();

  // ── 参考模型 ──
  const [refModel, setRefModel] = useState<ReferenceModel | null>(null);
  const [buildingRef, setBuildingRef] = useState(false);
  const [showRefParams, setShowRefParams] = useState(false);
  const [refParams, setRefParams] = useState<RgbFileParams>({ width: 0, height: 0, channels: 3, depth: 'uint8' });
  const pendingRefBuf = useRef<{ buf: ArrayBuffer; name: string } | null>(null);

  // ── 比对结果 ──
  const [comparing, setComparing] = useState(false);
  const [latestResult, setLatestResult] = useState<ComparisonResult | null>(null);
  const [history, setHistory] = useState<ComparisonResult[]>([]);
  const [trendScores, setTrendScores] = useState<number[]>([]);

  // ── 设置 ──
  const [diffThreshold, setDiffThreshold] = useState(DEFAULT_DIFF_THRESHOLD);
  const [alertThreshold, setAlertThreshold] = useState(DEFAULT_SIMILARITY_ALERT);
  const [autoMode, setAutoMode] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // ── 测试图导入 ──
  const [showTestParams, setShowTestParams] = useState(false);
  const [testParams, setTestParams] = useState<RgbFileParams>({ width: 0, height: 0, channels: 3, depth: 'uint8' });
  const pendingTestBuf = useRef<{ buf: ArrayBuffer; name: string } | null>(null);

  // ── 消息 ──
  const [errMsg, setErrMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');

  const lastAutoImageId = useRef<string>('');

  const showErr  = (m: string) => { setErrMsg(m); setTimeout(() => setErrMsg(''), 3500); };
  const showInfo = (m: string) => { setInfoMsg(m); setTimeout(() => setInfoMsg(''), 2500); };

  // ── 自动模式：监听 BLE 图传新帧 ──
  useEffect(() => {
    if (!autoMode || !refModel || !imageHistory.length) return;
    const latest = imageHistory[0];
    if (latest.id === lastAutoImageId.current) return;
    lastAutoImageId.current = latest.id;

    // BLE 图传是 data URI，需要判断是否可解析为 RGBA
    // BLE 图传图像是 BMP/JPEG data URI，无法直接在 JS 中像素级解码
    // 提示用户此限制
    showInfo('自动模式已触发，BLE 图传图像需为 RGB/RAW 格式方可比对');
  }, [imageHistory, autoMode, refModel]);

  useFocusEffect(useCallback(() => { /* 聚焦时无需重新加载 */ }, []));

  // ─── 读取文件为 ArrayBuffer ───────────────────────────────────────────────
  const readBuf = async (uri: string): Promise<ArrayBuffer | null> => {
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const bin = atob(b64);
      const buf = new ArrayBuffer(bin.length);
      const view = new Uint8Array(buf);
      for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
      return buf;
    } catch { return null; }
  };

  // ─── 导入参考模型文件 ─────────────────────────────────────────────────────
  const handleImportRef = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/octet-stream', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];
      const ext = asset.name?.split('.').pop()?.toLowerCase();
      if (!ext || !['rgb', 'raw'].includes(ext)) {
        showErr('参考模型仅支持 .rgb / .raw 格式（需像素级解码）');
        return;
      }
      const buf = await readBuf(asset.uri);
      if (!buf) { showErr('文件读取失败'); return; }
      pendingRefBuf.current = { buf, name: asset.name ?? 'ref.rgb' };
      setRefParams({ width: 0, height: 0, channels: 3, depth: 'uint8' });
      setShowRefParams(true);
    } catch { showErr('文件选取失败，请重试'); }
  };

  const handleConfirmRef = async () => {
    const pending = pendingRefBuf.current;
    if (!pending) return;
    if (refParams.width <= 0 || refParams.height <= 0) { showErr('请输入有效宽高'); return; }
    const expected = refParams.width * refParams.height * refParams.channels *
      (refParams.depth === 'uint16' ? 2 : 1);
    if (pending.buf.byteLength < expected) {
      showErr(`文件大小（${pending.buf.byteLength} B）与参数不匹配（需 ${expected} B）`);
      return;
    }
    setBuildingRef(true);
    setShowRefParams(false);
    try {
      const rgba = parseRgbBuffer(pending.buf, refParams);
      if (!rgba) { showErr('RGB 解析失败'); return; }
      const thumbUri = rgbaToBmpDataUri(
        rgba.slice(0, Math.min(rgba.length, 64 * 64 * 4)),
        Math.min(refParams.width, 64),
        Math.min(refParams.height, 64)
      );
      const model = buildReferenceModel(rgba, refParams.width, refParams.height, pending.name, thumbUri);
      setRefModel(model);
      pendingRefBuf.current = null;
      showInfo(`参考模型构建完成，特征维度 ${
        model.colorHistogram.length + model.statisticalMoments.length +
        model.lbpHistogram.length + model.gridFeatures.length
      } 维`);
    } finally { setBuildingRef(false); }
  };

  // ─── 手动导入测试图并比对 ────────────────────────────────────────────────
  const handleImportTest = async () => {
    if (!refModel) { showErr('请先构建参考模型'); return; }
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/octet-stream', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];
      const ext = asset.name?.split('.').pop()?.toLowerCase();
      if (!ext || !['rgb', 'raw'].includes(ext)) {
        showErr('测试图仅支持 .rgb / .raw 格式（需像素级解码）');
        return;
      }
      const buf = await readBuf(asset.uri);
      if (!buf) { showErr('文件读取失败'); return; }
      pendingTestBuf.current = { buf, name: asset.name ?? 'test.rgb' };
      setTestParams({ width: 0, height: 0, channels: 3, depth: 'uint8' });
      setShowTestParams(true);
    } catch { showErr('文件选取失败'); }
  };

  const handleConfirmTest = async () => {
    const pending = pendingTestBuf.current;
    if (!pending || !refModel) return;
    if (testParams.width <= 0 || testParams.height <= 0) { showErr('请输入有效宽高'); return; }
    const expected = testParams.width * testParams.height * testParams.channels *
      (testParams.depth === 'uint16' ? 2 : 1);
    if (pending.buf.byteLength < expected) {
      showErr(`文件大小与参数不匹配（需 ${expected} B）`);
      return;
    }
    setComparing(true);
    setShowTestParams(false);
    try {
      const rgba = parseRgbBuffer(pending.buf, testParams);
      if (!rgba) { showErr('测试图解析失败'); return; }
      const thumbUri = rgbaToBmpDataUri(
        rgba.slice(0, Math.min(rgba.length, 64 * 64 * 4)),
        Math.min(testParams.width, 64),
        Math.min(testParams.height, 64)
      );
      runComparison(rgba, testParams.width, testParams.height, thumbUri);
    } finally { setComparing(false); }
  };

  const runComparison = useCallback(
    (rgba: Uint8Array, w: number, h: number, thumbUri: string) => {
      if (!refModel) return;
      const result = compareImages(refModel, rgba, w, h, thumbUri, {
        diffThreshold,
        histWeight: 0.5,
        cosWeight: 0.5,
      });
      setLatestResult(result);
      setHistory(prev => [result, ...prev].slice(0, MAX_COMPARISON_HISTORY));
      setTrendScores(prev => [...prev.slice(-9), result.overallScore]);

      // 相似度骤降告警
      if (result.overallScore < alertThreshold) {
        showErr(`⚠ 相似度骤降：${result.overallScore} 分（阈值 ${alertThreshold}）`);
      }
    },
    [refModel, diffThreshold, alertThreshold]
  );

  const totalFeatureDim = refModel
    ? refModel.colorHistogram.length + refModel.statisticalMoments.length +
      refModel.lbpHistogram.length + refModel.gridFeatures.length
    : 0;

  const trendStats = calcTrendStats(trendScores);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>

        {/* ── 顶部标题栏 ── */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
          borderBottomWidth: 1, borderBottomColor: BORDER,
        }}>
          <View>
            <Text style={{ color: TEXT_PRI, fontSize: 15, fontWeight: '800', letterSpacing: 0.5 }}>模型比对</Text>
            <Text style={{ color: TEXT_MUT, fontSize: 10, marginTop: 1 }}>
              特征提取 · 相似度分析 · 异常检测
            </Text>
          </View>
          <Pressable cssInterop={false} onPress={() => setShowSettings(s => !s)}
            style={({ pressed }) => ({
              backgroundColor: showSettings ? `${ORANGE}20` : 'transparent',
              borderWidth: 1, borderColor: showSettings ? ORANGE : BORDER,
              borderRadius: 2, padding: 6, opacity: pressed ? 0.7 : 1,
            })}>
            <Ionicons name="settings-outline" size={16} color={showSettings ? ORANGE : TEXT_MUT} />
          </Pressable>
        </View>

        {/* ── 消息提示 ── */}
        {errMsg !== '' && (
          <View style={{ marginHorizontal: 16, marginTop: 10, backgroundColor: `${RED}15`, borderWidth: 1, borderColor: RED, borderRadius: 2, padding: 8 }}>
            <Text style={{ color: RED, fontSize: 11 }}>{errMsg}</Text>
          </View>
        )}
        {infoMsg !== '' && (
          <View style={{ marginHorizontal: 16, marginTop: 10, backgroundColor: `${GREEN}15`, borderWidth: 1, borderColor: GREEN, borderRadius: 2, padding: 8 }}>
            <Text style={{ color: GREEN, fontSize: 11 }}>{infoMsg}</Text>
          </View>
        )}

        {/* ── 设置面板 ── */}
        {showSettings && (
          <>
            <SectionHeader title="比对设置" />
            <View style={{ marginHorizontal: 16 }}>
              <View style={{ backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 2, padding: 12, gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ color: TEXT_MUT, fontSize: 11, flex: 1 }}>子块差异阈值（%）</Text>
                  <TextInput
                    style={{ backgroundColor: '#111', borderWidth: 1, borderColor: BORDER, borderRadius: 2, color: CYAN, fontFamily: 'monospace', fontSize: 12, paddingHorizontal: 8, paddingVertical: 4, width: 60, textAlign: 'center' }}
                    value={String(diffThreshold)} keyboardType="numeric"
                    onChangeText={v => { const n = parseInt(v); if (!isNaN(n) && n >= 0 && n <= 100) setDiffThreshold(n); }}
                  />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ color: TEXT_MUT, fontSize: 11, flex: 1 }}>相似度骤降告警阈值</Text>
                  <TextInput
                    style={{ backgroundColor: '#111', borderWidth: 1, borderColor: BORDER, borderRadius: 2, color: ORANGE, fontFamily: 'monospace', fontSize: 12, paddingHorizontal: 8, paddingVertical: 4, width: 60, textAlign: 'center' }}
                    value={String(alertThreshold)} keyboardType="numeric"
                    onChangeText={v => { const n = parseInt(v); if (!isNaN(n) && n >= 0 && n <= 100) setAlertThreshold(n); }}
                  />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ color: TEXT_MUT, fontSize: 11, flex: 1 }}>
                    自动模式（BLE 图传新帧自动比对）
                  </Text>
                  <Pressable cssInterop={false}
                    onPress={() => setAutoMode(m => !m)}
                    style={({ pressed }) => ({
                      backgroundColor: autoMode ? `${CYAN}20` : 'transparent',
                      borderWidth: 1, borderColor: autoMode ? CYAN : BORDER,
                      borderRadius: 2, paddingHorizontal: 10, paddingVertical: 4,
                      opacity: pressed ? 0.7 : 1,
                    })}>
                    <Text style={{ color: autoMode ? CYAN : TEXT_MUT, fontSize: 11, fontWeight: '700' }}>
                      {autoMode ? 'ON' : 'OFF'}
                    </Text>
                  </Pressable>
                </View>
                {autoMode && (
                  <View style={{ backgroundColor: `${ORANGE}10`, borderWidth: 1, borderColor: ORANGE, borderRadius: 2, padding: 8 }}>
                    <Text style={{ color: ORANGE, fontSize: 10 }}>
                      ⚠ 自动模式下，BLE 图传图像需为设备发送的 RGB/RAW 格式才能进行像素级比对。
                      JPEG 格式无法在纯 JS 中解码像素，将仅作提示。
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </>
        )}

        {/* ── 参考模型构建 ── */}
        <SectionHeader title="参考模型" />
        <View style={{ marginHorizontal: 16, gap: 8 }}>
          {refModel ? (
            <View style={{ backgroundColor: CARD_BG, borderWidth: 1, borderColor: GREEN, borderRadius: 2, padding: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Image source={{ uri: refModel.thumbUri }} style={{ width: 48, height: 48, borderRadius: 2, backgroundColor: '#000' }} contentFit="cover" />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={{ color: GREEN, fontSize: 11, fontFamily: 'monospace', fontWeight: '700' }} numberOfLines={1}>
                    ✓ {refModel.fileName}
                  </Text>
                  <Text style={{ color: TEXT_MUT, fontSize: 10, fontFamily: 'monospace' }}>
                    {refModel.width} × {refModel.height}  ·  {totalFeatureDim} 维特征
                  </Text>
                  <Text style={{ color: TEXT_MUT, fontSize: 9, fontFamily: 'monospace' }}>
                    构建于 {new Date(refModel.builtAt).toLocaleTimeString()}
                  </Text>
                </View>
                <Pressable cssInterop={false}
                  onPress={handleImportRef}
                  style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}>
                  <Ionicons name="refresh" size={16} color={TEXT_MUT} />
                </Pressable>
              </View>
              {/* 特征维度说明 */}
              <View style={{ flexDirection: 'row', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                {[
                  { label: '颜色直方图', dim: refModel.colorHistogram.length, color: CYAN },
                  { label: '统计矩', dim: refModel.statisticalMoments.length, color: ORANGE },
                  { label: 'LBP 纹理', dim: refModel.lbpHistogram.length, color: '#BB86FC' },
                  { label: '空间网格', dim: refModel.gridFeatures.length, color: GREEN },
                ].map(f => (
                  <View key={f.label} style={{
                    backgroundColor: `${f.color}15`, borderWidth: 1, borderColor: `${f.color}50`,
                    borderRadius: 2, paddingHorizontal: 6, paddingVertical: 3,
                  }}>
                    <Text style={{ color: f.color, fontSize: 9, fontFamily: 'monospace' }}>
                      {f.label} · {f.dim}D
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : (
            <View style={{
              backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
              borderRadius: 2, padding: 24, alignItems: 'center', gap: 8,
            }}>
              <Ionicons name="cube-outline" size={32} color={TEXT_MUT} />
              <Text style={{ color: TEXT_MUT, fontSize: 11, textAlign: 'center' }}>
                导入 RGB/RAW 原始文件构建参考模型{'\n'}
                支持：颜色直方图 + 统计矩 + LBP 纹理 + 空间网格
              </Text>
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable cssInterop={false}
              onPress={handleImportRef}
              disabled={buildingRef}
              style={({ pressed }) => ({
                flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
                backgroundColor: `${CYAN}15`, borderWidth: 1, borderColor: CYAN,
                borderRadius: 2, paddingVertical: 9, opacity: pressed || buildingRef ? 0.6 : 1,
              })}>
              {buildingRef
                ? <ActivityIndicator size="small" color={CYAN} />
                : <Ionicons name="document-attach-outline" size={14} color={CYAN} />}
              <Text style={{ color: CYAN, fontSize: 12, fontWeight: '700' }}>
                {buildingRef ? '构建中...' : '导入参考图'}
              </Text>
            </Pressable>
            <Pressable cssInterop={false}
              onPress={handleImportTest}
              disabled={comparing || !refModel}
              style={({ pressed }) => ({
                flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
                backgroundColor: refModel ? `${ORANGE}15` : 'transparent',
                borderWidth: 1, borderColor: refModel ? ORANGE : BORDER,
                borderRadius: 2, paddingVertical: 9,
                opacity: pressed || comparing || !refModel ? 0.5 : 1,
              })}>
              {comparing
                ? <ActivityIndicator size="small" color={ORANGE} />
                : <Ionicons name="analytics-outline" size={14} color={refModel ? ORANGE : TEXT_MUT} />}
              <Text style={{ color: refModel ? ORANGE : TEXT_MUT, fontSize: 12, fontWeight: '700' }}>
                {comparing ? '比对中...' : '导入测试图'}
              </Text>
            </Pressable>
          </View>

          {/* 参考图 RGB 参数面板 */}
          {showRefParams && (
            <View style={{ gap: 8 }}>
              <RgbParamsPanel params={refParams} onChange={setRefParams} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable cssInterop={false} onPress={() => { setShowRefParams(false); pendingRefBuf.current = null; }}
                  style={({ pressed }) => ({ flex: 1, borderWidth: 1, borderColor: BORDER, borderRadius: 2, paddingVertical: 8, alignItems: 'center', opacity: pressed ? 0.7 : 1 })}>
                  <Text style={{ color: TEXT_MUT, fontSize: 12 }}>取消</Text>
                </Pressable>
                <Pressable cssInterop={false} onPress={handleConfirmRef}
                  style={({ pressed }) => ({ flex: 2, backgroundColor: `${CYAN}20`, borderWidth: 1, borderColor: CYAN, borderRadius: 2, paddingVertical: 8, alignItems: 'center', opacity: pressed ? 0.7 : 1 })}>
                  <Text style={{ color: CYAN, fontSize: 12, fontWeight: '700' }}>确认构建模型</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* 测试图 RGB 参数面板 */}
          {showTestParams && (
            <View style={{ gap: 8 }}>
              <RgbParamsPanel params={testParams} onChange={setTestParams} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable cssInterop={false} onPress={() => { setShowTestParams(false); pendingTestBuf.current = null; }}
                  style={({ pressed }) => ({ flex: 1, borderWidth: 1, borderColor: BORDER, borderRadius: 2, paddingVertical: 8, alignItems: 'center', opacity: pressed ? 0.7 : 1 })}>
                  <Text style={{ color: TEXT_MUT, fontSize: 12 }}>取消</Text>
                </Pressable>
                <Pressable cssInterop={false} onPress={handleConfirmTest}
                  style={({ pressed }) => ({ flex: 2, backgroundColor: `${ORANGE}20`, borderWidth: 1, borderColor: ORANGE, borderRadius: 2, paddingVertical: 8, alignItems: 'center', opacity: pressed ? 0.7 : 1 })}>
                  <Text style={{ color: ORANGE, fontSize: 12, fontWeight: '700' }}>确认比对</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>

        {/* ── 比对结果 ── */}
        {latestResult && (
          <>
            <SectionHeader title="最新比对结果" />
            <View style={{ marginHorizontal: 16, gap: 8 }}>

              {/* 综合评分 + 分项 */}
              <View style={{
                backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
                borderRadius: 2, padding: 12, flexDirection: 'row', gap: 12, alignItems: 'flex-start',
              }}>
                <ScoreCard score={latestResult.overallScore} />
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Badge label="直方图相似度" value={latestResult.histIntersection.toFixed(3)} color={CYAN} />
                    <Badge label="余弦相似度" value={latestResult.cosineSimilarity.toFixed(3)} color='#BB86FC' />
                  </View>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Badge label="异常子块数" value={`${latestResult.anomalyBlocks.length}/${COMPARISON_GRID * COMPARISON_GRID}`}
                      color={latestResult.anomalyBlocks.length > 4 ? RED : latestResult.anomalyBlocks.length > 0 ? ORANGE : GREEN} />
                    <Badge label="比对时间" value={new Date(latestResult.comparedAt).toLocaleTimeString()} color={TEXT_MUT} />
                  </View>
                </View>
              </View>

              {/* 差异热图 + 参考图 + 测试图三联 */}
              <View style={{
                backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
                borderRadius: 2, padding: 10, gap: 6,
              }}>
                <Text style={{ color: TEXT_MUT, fontSize: 9, letterSpacing: 1 }}>DIFF VISUALIZATION</Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {[
                    { uri: refModel?.thumbUri, label: '参考图', color: GREEN },
                    { uri: latestResult.thumbUri, label: '测试图', color: ORANGE },
                    { uri: latestResult.diffMapUri, label: '差异热图', color: RED },
                  ].map(item => (
                    <View key={item.label} style={{ flex: 1, gap: 4 }}>
                      <Image
                        source={{ uri: item.uri }}
                        style={{ width: '100%', aspectRatio: 1, borderRadius: 2, backgroundColor: '#000', borderWidth: 1, borderColor: item.color + '50' }}
                        contentFit="cover"
                      />
                      <Text style={{ color: item.color, fontSize: 9, textAlign: 'center', fontWeight: '700' }}>
                        {item.label}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* 异常块网格 */}
              <View style={{
                backgroundColor: CARD_BG, borderWidth: 1,
                borderColor: latestResult.anomalyBlocks.length > 0 ? RED : BORDER,
                borderRadius: 2, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12,
              }}>
                <AnomalyGrid anomalyBlocks={latestResult.anomalyBlocks} size={88} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={{ color: latestResult.anomalyBlocks.length > 0 ? RED : GREEN, fontSize: 12, fontWeight: '800' }}>
                    {latestResult.anomalyBlocks.length > 0
                      ? `检测到 ${latestResult.anomalyBlocks.length} 个异常区域`
                      : '无明显异常区域'}
                  </Text>
                  <Text style={{ color: TEXT_MUT, fontSize: 10, lineHeight: 15 }}>
                    4×4 子块扫描{'\n'}
                    差异阈值：{diffThreshold}%{'\n'}
                    异常块索引：{latestResult.anomalyBlocks.length > 0
                      ? latestResult.anomalyBlocks.join(', ')
                      : '—'}
                  </Text>
                </View>
              </View>
            </View>
          </>
        )}

        {/* ── 实时数据流监控 ── */}
        {trendScores.length > 0 && (
          <>
            <SectionHeader title={`相似度趋势  (最近 ${trendScores.length} 帧)`} />
            <View style={{ marginHorizontal: 16 }}>
              <View style={{ backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 2, padding: 12, gap: 10 }}>
                <SparkLine scores={trendScores} h={44} />
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <Badge label="平均" value={String(trendStats.avg)} color={CYAN} />
                  <Badge label="最低" value={String(trendStats.min)} color={scoreColor(trendStats.min)} />
                  <Badge label="最高" value={String(trendStats.max)} color={GREEN} />
                  <Badge label="告警阈值" value={String(alertThreshold)} color={ORANGE} />
                </View>
              </View>
            </View>
          </>
        )}

        {/* ── 比对历史 ── */}
        {history.length > 0 && (
          <>
            <SectionHeader title={`比对历史  (${history.length}/${MAX_COMPARISON_HISTORY})`} />
            <View style={{ marginHorizontal: 16 }}>
              <View style={{ backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 2 }}>
                <FlatList
                  data={history}
                  keyExtractor={r => r.id}
                  scrollEnabled={false}
                  ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: BORDER }} />}
                  renderItem={({ item }) => (
                    <Pressable cssInterop={false}
                      onPress={() => setLatestResult(item)}
                      style={({ pressed }) => ({
                        flexDirection: 'row', alignItems: 'center', gap: 10,
                        paddingHorizontal: 12, paddingVertical: 9,
                        backgroundColor: latestResult?.id === item.id ? `${CYAN}08` : 'transparent',
                        opacity: pressed ? 0.7 : 1,
                      })}>
                      <Image source={{ uri: item.thumbUri }}
                        style={{ width: 32, height: 32, borderRadius: 2, backgroundColor: '#000' }} contentFit="cover" />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ color: TEXT_MUT, fontSize: 9, fontFamily: 'monospace' }}>
                          {new Date(item.comparedAt).toLocaleTimeString()}  ·  {item.width}×{item.height}
                        </Text>
                        <Text style={{ color: TEXT_MUT, fontSize: 9 }}>
                          直方图 {item.histIntersection.toFixed(3)}  余弦 {item.cosineSimilarity.toFixed(3)}
                          {'  '}异常 {item.anomalyBlocks.length}/{COMPARISON_GRID * COMPARISON_GRID}
                        </Text>
                      </View>
                      <View style={{
                        backgroundColor: scoreColor(item.overallScore) + '20',
                        borderWidth: 1, borderColor: scoreColor(item.overallScore),
                        borderRadius: 2, paddingHorizontal: 7, paddingVertical: 3,
                      }}>
                        <Text style={{ color: scoreColor(item.overallScore), fontSize: 13, fontWeight: '900', fontFamily: 'monospace' }}>
                          {item.overallScore}
                        </Text>
                      </View>
                    </Pressable>
                  )}
                />
              </View>
            </View>
          </>
        )}

        {/* 空状态 */}
        {!latestResult && !buildingRef && !comparing && (
          <View style={{
            marginHorizontal: 16, marginTop: 24,
            backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
            borderRadius: 2, padding: 28, alignItems: 'center', gap: 8,
          }}>
            <Ionicons name="analytics-outline" size={36} color={TEXT_MUT} />
            <Text style={{ color: TEXT_MUT, fontSize: 11, textAlign: 'center', lineHeight: 18 }}>
              ① 导入 RGB/RAW 参考图 → 自动提取特征模型{'\n'}
              ② 导入测试图 → 执行相似度比对{'\n'}
              ③ 查看评分、差异热图、异常区域
            </Text>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}
