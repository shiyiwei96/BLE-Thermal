/**
 * 热相页 - 实时热成像 + 温度分析 + AI 手势识别（TFLite 端侧推理）
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, ActivityIndicator, Alert, Modal,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { useFocusEffect } from 'expo-router';

import { useBle } from '@/lib/bleContext';
import { useSerial } from '@/lib/serialContext';
import {
  renderThermalPixels,
  renderThermalPixelsBilinear,
  pixelsToDataUri,
  drawHotspotMarkers,
} from '@/lib/thermalAnalysis';
import { loadModel, runThermalInference } from '@/lib/thermalModel';
import type { ThermalFrame, ThermalColormap } from '@/lib/types';

// ============ 颜色常量 ============
const DARK_BG = '#121212';
const CARD_BG = '#1A1A1A';
const BORDER = '#333333';
const TEXT_PRIMARY = '#E0E0E0';
const TEXT_MUTED = '#666666';
const CYAN = '#00E5FF';
const RED = '#FF3333';
const ORANGE = '#FF6B00';
const BLUE = '#3B82F6';
const GREEN = '#00E676';

// ============ 手势名称 ============
const GESTURE_NAMES: Record<number, string> = {
  0: '无手势',
  1: '手势 1',
  2: '手势 2',
  3: '手势 3',
  4: '手势 4',
  5: '手势 5',
};

// ============ 工具 ============
function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ============ 温度分析卡片 ============
function AnalysisCard({ frame }: { frame: ThermalFrame }) {
  const a = frame.analysis;
  if (!a) return null;

  return (
    <View style={{
      backgroundColor: CARD_BG, borderColor: BORDER, borderWidth: 1,
      borderRadius: 2, padding: 12, marginBottom: 12, gap: 8,
    }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: TEXT_PRIMARY, fontSize: 12, fontWeight: '700' }}>温度分析</Text>
        <Text style={{ color: TEXT_MUTED, fontSize: 10, fontFamily: 'monospace' }}>
          {formatTime(frame.receivedAt)}
        </Text>
      </View>

      <View style={{
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        backgroundColor: `${CYAN}10`, padding: 8, borderRadius: 2,
      }}>
        <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>全局温差 ΔT</Text>
        <Text style={{ color: CYAN, fontSize: 16, fontWeight: '800', fontFamily: 'monospace' }}>
          {a.deltaT.toFixed(2)} ℃
        </Text>
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>
          全局 Max: <Text style={{ color: RED }}>{a.globalMax.toFixed(1)}℃</Text>
        </Text>
        <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>
          全局 Min: <Text style={{ color: BLUE }}>{a.globalMin.toFixed(1)}℃</Text>
        </Text>
        <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>
          Avg: <Text style={{ color: ORANGE }}>{a.globalAvg.toFixed(1)}℃</Text>
        </Text>
      </View>

      {a.hotspots.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text style={{ color: RED, fontSize: 11, fontWeight: '700' }}>
            热点区域 ({a.hotspots.length})
          </Text>
          {a.hotspots.map((h, i) => (
            <View key={i} style={{
              flexDirection: 'row', justifyContent: 'space-between',
              backgroundColor: `${RED}10`, padding: 6, borderRadius: 2,
            }}>
              <Text style={{ color: TEXT_MUTED, fontSize: 10, fontFamily: 'monospace' }}>
                #{i + 1}  ({h.centerX.toFixed(0)},{h.centerY.toFixed(0)})  {h.pixelCount}px
              </Text>
              <Text style={{ color: RED, fontSize: 11, fontWeight: '700', fontFamily: 'monospace' }}>
                {h.maxTemp.toFixed(1)}℃  Δ{(h.maxTemp - h.minTemp).toFixed(1)}℃
              </Text>
            </View>
          ))}
        </View>
      )}

      {a.coldspots.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text style={{ color: BLUE, fontSize: 11, fontWeight: '700' }}>
            冷点区域 ({a.coldspots.length})
          </Text>
          {a.coldspots.map((c, i) => (
            <View key={i} style={{
              flexDirection: 'row', justifyContent: 'space-between',
              backgroundColor: `${BLUE}10`, padding: 6, borderRadius: 2,
            }}>
              <Text style={{ color: TEXT_MUTED, fontSize: 10, fontFamily: 'monospace' }}>
                #{i + 1}  ({c.centerX.toFixed(0)},{c.centerY.toFixed(0)})  {c.pixelCount}px
              </Text>
              <Text style={{ color: BLUE, fontSize: 11, fontWeight: '700', fontFamily: 'monospace' }}>
                {c.minTemp.toFixed(1)}℃
              </Text>
            </View>
          ))}
        </View>
      )}

      {a.hotspots.length === 0 && a.coldspots.length === 0 && (
        <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>
          无显著热点 / 冷点（ΔT {'<'} 3℃）
        </Text>
      )}
    </View>
  );
}

// ============ AI 结果卡片 ============
function AiResultCard({
  result, loading, error, modelReady,
}: {
  result: { label: number; confidence: number } | null;
  loading: boolean;
  error: string | null;
  modelReady: boolean;
}) {
  return (
    <View style={{
      backgroundColor: CARD_BG, borderColor: CYAN, borderWidth: 1,
      borderRadius: 2, padding: 12, marginBottom: 12,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="hardware-chip-outline" size={18} color={CYAN} />
          <Text style={{ color: TEXT_MUTED, fontSize: 12 }}>AI 识别（TFLite 端侧）</Text>
        </View>
        {loading && <ActivityIndicator size="small" color={CYAN} />}
      </View>

      {!modelReady && !error && (
        <Text style={{ color: TEXT_MUTED, fontSize: 11, marginTop: 8 }}>
          模型加载中…
        </Text>
      )}

      {error && (
        <Text style={{ color: RED, fontSize: 11, marginTop: 8 }}>{error}</Text>
      )}

      {modelReady && result && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <Text style={{ color: TEXT_MUTED, fontSize: 12 }}>识别结果</Text>
          <Text style={{ color: CYAN, fontSize: 22, fontWeight: '800', fontFamily: 'monospace' }}>
            {GESTURE_NAMES[result.label] ?? `手势 ${result.label}`}
          </Text>
        </View>
      )}

      {modelReady && result && (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 }}>
          <Text style={{ color: TEXT_MUTED, fontSize: 10, fontFamily: 'monospace' }}>
            置信度 {(result.confidence * 100).toFixed(1)}%
          </Text>
        </View>
      )}
    </View>
  );
}

// ============ 主页面 ============
export default function ThermalScreen() {
  // 同时支持 BLE / USB
  const ble = useBle();
  const serial = useSerial();

  const latestThermalFrame = serial.isConnected
    ? serial.latestThermalFrame
    : ble.latestThermalFrame;
  const latestThermalDataUri = serial.isConnected
    ? serial.latestThermalDataUri
    : ble.latestThermalDataUri;
  const thermalFrames = serial.isConnected
    ? serial.thermalFrames
    : ble.thermalFrames;

  // 本地状态
  const [viewFrame, setViewFrame] = useState<ThermalFrame | null>(null);
  const [viewDataUri, setViewDataUri] = useState<string | null>(null);
  const [frameUriCache, setFrameUriCache] = useState<Record<string, string>>({});
  const [unit, setUnit] = useState<'C' | 'F'>('C');
  const [colormap, setColormap] = useState<ThermalColormap>('iron');
  const [saving, setSaving] = useState(false);

  // AI 相关
  const [aiResult, setAiResult] = useState<{ label: number; confidence: number } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [modelReady, setModelReady] = useState(false);
  const lastInferRef = useRef(0);
  const inferInFlightRef = useRef(false);

  // 帧率
  const [fps, setFps] = useState(0);
  const lastFrameTimeRef = useRef(0);
  const frameCountRef = useRef(0);

  // ============ 加载 TFLite 模型 ============
  useEffect(() => {
    loadModel()
      .then(() => {
        setModelReady(true);
        console.log('[TFLite] 模型就绪');
      })
      .catch(e => {
        setAiError('模型加载失败: ' + (e instanceof Error ? e.message : String(e)));
        console.error('[TFLite] 加载失败:', e);
      });
  }, []);

  // ============ 每收到新帧，节流推理一次 ============
  useEffect(() => {
    if (!modelReady || !latestThermalFrame) return;

    const now = Date.now();
    // 节流：最少间隔 500ms
    if (now - lastInferRef.current < 500) return;
    // 防止并发（上一帧还没跑完就跳过）
    if (inferInFlightRef.current) return;
    lastInferRef.current = now;
    inferInFlightRef.current = true;
    setAiLoading(true);

    runThermalInference(latestThermalFrame.tempData)
      .then(res => {
        setAiResult({ label: res.label, confidence: res.confidence });
        setAiError(null);
      })
      .catch(e => {
        setAiError('推理失败: ' + (e instanceof Error ? e.message : String(e)));
      })
      .finally(() => {
        setAiLoading(false);
        inferInFlightRef.current = false;
      });
  }, [latestThermalFrame, modelReady]);

  // ============ 缓存 + 帧率 ============
  useEffect(() => {
    if (!latestThermalFrame || !latestThermalDataUri) return;
    setFrameUriCache(prev => {
      if (prev[latestThermalFrame.id]) return prev;
      const next = { ...prev, [latestThermalFrame.id]: latestThermalDataUri };
      const keys = Object.keys(next);
      if (keys.length > 20) {
        const trimmed: Record<string, string> = {};
        for (const k of keys.slice(-20)) trimmed[k] = next[k];
        return trimmed;
      }
      return next;
    });

    const now = Date.now();
    frameCountRef.current++;
    if (now - lastFrameTimeRef.current >= 1000) {
      setFps(frameCountRef.current);
      frameCountRef.current = 0;
      lastFrameTimeRef.current = now;
    }
  }, [latestThermalFrame, latestThermalDataUri]);

  // ============ 页面聚焦重置 ============
  useFocusEffect(useCallback(() => {
    setViewFrame(null);
    setViewDataUri(null);
  }, []));

  // ============ 渲染历史帧 URI ============
  const getFrameUri = useCallback((frame: ThermalFrame): string => {
    const cached = frameUriCache[frame.id];
    if (cached) return cached;
    const { pixels, width, height } = renderThermalPixelsBilinear(frame, colormap, 4);
    return pixelsToDataUri(pixels, width, height);
  }, [frameUriCache, colormap]);

  const displayFrame = viewFrame ?? latestThermalFrame;
  const displayUri = viewFrame ? (viewDataUri ?? getFrameUri(viewFrame)) : latestThermalDataUri;

  const toDisplayTemp = (c: number) => unit === 'C' ? c : c * 9 / 5 + 32;
  const unitLabel = unit === 'C' ? '℃' : '℉';

  // ============ 保存图像 ============
  const handleSaveImage = async () => {
    if (!displayUri) return;
    setSaving(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
      if (status !== 'granted') {
        Alert.alert('需要相册权限', '请在系统设置中授权');
        setSaving(false);
        return;
      }
      const base64 = displayUri.replace(/^data:image\/\w+;base64,/, '');
      const ext = displayUri.startsWith('data:image/jpeg') ? 'jpg' : 'png';
      const localUri = `${FileSystem.cacheDirectory}thermal_${Date.now()}.${ext}`;
      await FileSystem.writeAsStringAsync(localUri, base64, { encoding: FileSystem.EncodingType.Base64 });
      await MediaLibrary.createAssetAsync(localUri);
      Alert.alert('已保存到相册');
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: DARK_BG }}>
      {/* ===== 顶部标题栏 ===== */}
      <View style={{
        paddingHorizontal: 16, paddingVertical: 12,
        borderBottomColor: BORDER, borderBottomWidth: 1,
        backgroundColor: '#0F0F0F',
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <View>
          <Text style={{ color: ORANGE, fontSize: 16, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1 }}>
            THERMAL
          </Text>
          <Text style={{ color: TEXT_MUTED, fontSize: 10, marginTop: 1 }}>
            {serial.isConnected
              ? `串口: ${serial.connectedSerial?.displayName ?? '已连接'}`
              : ble.connectedDevice
                ? `BLE: ${ble.connectedDevice.name ?? ble.connectedDevice.address}`
                : '未连接设备'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {latestThermalFrame && (
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 4,
              paddingHorizontal: 8, paddingVertical: 4,
              backgroundColor: `${GREEN}15`, borderRadius: 2,
            }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: GREEN }} />
              <Text style={{ color: GREEN, fontSize: 10, fontWeight: '700', fontFamily: 'monospace' }}>
                {fps} fps
              </Text>
            </View>
          )}
          {viewFrame && (
            <Pressable
              cssInterop={false}
              onPress={() => { setViewFrame(null); setViewDataUri(null); }}
              style={({ pressed }) => ({
                borderColor: CYAN, borderWidth: 1, borderRadius: 2,
                paddingHorizontal: 8, paddingVertical: 4, opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: CYAN, fontSize: 10, fontWeight: '700' }}>实时</Text>
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 12 }} contentInsetAdjustmentBehavior="automatic">

        {/* ===== AI 识别卡片 ===== */}
        <AiResultCard
          result={aiResult}
          loading={aiLoading}
          error={aiError}
          modelReady={modelReady}
        />

        {/* ===== 热相图 ===== */}
        <View style={{
          backgroundColor: CARD_BG, borderColor: BORDER, borderWidth: 1,
          borderRadius: 2, overflow: 'hidden', marginBottom: 12,
        }}>
          {displayUri ? (
            <View>
              <Image
                source={{ uri: displayUri }}
                style={{ width: '100%', aspectRatio: 32 / 24 }}
                contentFit="contain"
              />
              {displayFrame && (
                <View style={{
                  position: 'absolute', bottom: 6, right: 8,
                  backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4,
                  paddingHorizontal: 6, paddingVertical: 2,
                }}>
                  <Text style={{ color: TEXT_MUTED, fontSize: 9, fontFamily: 'monospace' }}>
                    {formatTime(displayFrame.receivedAt)}
                  </Text>
                </View>
              )}
              {viewFrame && (
                <View style={{
                  position: 'absolute', top: 6, left: 8,
                  backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4,
                  paddingHorizontal: 6, paddingVertical: 2,
                }}>
                  <Text style={{ color: ORANGE, fontSize: 9, fontFamily: 'monospace' }}>
                    历史帧
                  </Text>
                </View>
              )}
            </View>
          ) : (
            <View style={{ aspectRatio: 32 / 24, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="thermometer-outline" size={40} color={TEXT_MUTED} />
              <Text style={{ color: TEXT_MUTED, fontSize: 12, marginTop: 8 }}>
                等待热相数据…
              </Text>
            </View>
          )}
        </View>

        {/* ===== 温度统计 ===== */}
        {displayFrame && (
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            <View style={{
              flex: 1, backgroundColor: CARD_BG, borderColor: BORDER, borderWidth: 1,
              borderRadius: 2, padding: 10, alignItems: 'center', gap: 4,
            }}>
              <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>最高温度</Text>
              <Text style={{ color: RED, fontSize: 18, fontWeight: '800', fontFamily: 'monospace' }}>
                {toDisplayTemp(displayFrame.maxTemp).toFixed(1)}°
              </Text>
              <Text style={{ color: TEXT_MUTED, fontSize: 9 }}>{unitLabel}</Text>
            </View>
            <View style={{
              flex: 1, backgroundColor: CARD_BG, borderColor: BORDER, borderWidth: 1,
              borderRadius: 2, padding: 10, alignItems: 'center', gap: 4,
            }}>
              <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>平均温度</Text>
              <Text style={{ color: ORANGE, fontSize: 18, fontWeight: '800', fontFamily: 'monospace' }}>
                {toDisplayTemp(displayFrame.avgTemp).toFixed(1)}°
              </Text>
              <Text style={{ color: TEXT_MUTED, fontSize: 9 }}>{unitLabel}</Text>
            </View>
            <View style={{
              flex: 1, backgroundColor: CARD_BG, borderColor: BORDER, borderWidth: 1,
              borderRadius: 2, padding: 10, alignItems: 'center', gap: 4,
            }}>
              <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>最低温度</Text>
              <Text style={{ color: BLUE, fontSize: 18, fontWeight: '800', fontFamily: 'monospace' }}>
                {toDisplayTemp(displayFrame.minTemp).toFixed(1)}°
              </Text>
              <Text style={{ color: TEXT_MUTED, fontSize: 9 }}>{unitLabel}</Text>
            </View>
          </View>
        )}

        {/* ===== 温度分析 ===== */}
        {displayFrame?.analysis && <AnalysisCard frame={displayFrame} />}

        {/* ===== 伪彩映射 ===== */}
        <View style={{
          backgroundColor: CARD_BG, borderColor: BORDER, borderWidth: 1,
          borderRadius: 2, padding: 12, marginBottom: 12, gap: 8,
        }}>
          <Text style={{ color: TEXT_PRIMARY, fontSize: 12, fontWeight: '700' }}>伪彩色映射</Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {(['iron', 'rainbow', 'gray', 'plasma'] as ThermalColormap[]).map(c => (
              <Pressable
                key={c}
                cssInterop={false}
                onPress={() => setColormap(c)}
                style={({ pressed }) => ({
                  paddingHorizontal: 12, paddingVertical: 5, borderRadius: 2, borderWidth: 1,
                  borderColor: colormap === c ? ORANGE : BORDER,
                  backgroundColor: colormap === c ? `${ORANGE}20` : 'transparent',
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{
                  color: colormap === c ? ORANGE : TEXT_MUTED,
                  fontSize: 11, fontWeight: colormap === c ? '800' : '400',
                }}>
                  {c === 'iron' ? '铁红' : c === 'rainbow' ? '彩虹' : c === 'grayscale' ? '灰度' : '等离子'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* ===== 温度单位 + 保存 ===== */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          <View style={{
            flex: 1, backgroundColor: CARD_BG, borderColor: BORDER, borderWidth: 1,
            borderRadius: 2, padding: 12, gap: 6,
          }}>
            <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>温度单位</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {(['C', 'F'] as const).map(u => (
                <Pressable
                  key={u}
                  cssInterop={false}
                  onPress={() => setUnit(u)}
                  style={({ pressed }) => ({
                    flex: 1, alignItems: 'center', paddingVertical: 6,
                    borderWidth: 1, borderRadius: 2,
                    borderColor: unit === u ? CYAN : BORDER,
                    backgroundColor: unit === u ? `${CYAN}15` : 'transparent',
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{
                    color: unit === u ? CYAN : TEXT_MUTED,
                    fontSize: 12, fontWeight: '700',
                  }}>°{u}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <Pressable
            cssInterop={false}
            onPress={handleSaveImage}
            disabled={!displayUri || saving}
            style={({ pressed }) => ({
              flex: 1, backgroundColor: CARD_BG, borderColor: CYAN, borderWidth: 1,
              borderRadius: 2, padding: 12, alignItems: 'center', justifyContent: 'center', gap: 6,
              opacity: !displayUri || saving || pressed ? 0.6 : 1,
            })}
          >
            {saving ? <ActivityIndicator size="small" color={CYAN} /> : (
              <>
                <Ionicons name="download-outline" size={18} color={CYAN} />
                <Text style={{ color: CYAN, fontSize: 11, fontWeight: '700' }}>保存图像</Text>
              </>
            )}
          </Pressable>
        </View>

        {/* ===== 历史帧 ===== */}
        <View style={{
          backgroundColor: CARD_BG, borderColor: BORDER, borderWidth: 1,
          borderRadius: 2, padding: 12, marginBottom: 12,
        }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={{ color: TEXT_PRIMARY, fontSize: 12, fontWeight: '700' }}>
              历史帧 ({thermalFrames.length}/20)
            </Text>
            {thermalFrames.length > 0 && (
              <Pressable
                cssInterop={false}
                onPress={() => setFrameUriCache({})}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 4 })}
              >
                <Ionicons name="trash-outline" size={16} color={TEXT_MUTED} />
              </Pressable>
            )}
          </View>

          {thermalFrames.length === 0 ? (
            <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>暂无历史帧</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {thermalFrames.map(frame => {
                const uri = frameUriCache[frame.id] ?? '';
                const isActive = displayFrame?.id === frame.id;
                return (
                  <Pressable
                    key={frame.id}
                    cssInterop={false}
                    onPress={() => {
                      setViewFrame(frame);
                      setViewDataUri(uri);
                    }}
                    style={{
                      marginRight: 8, borderWidth: 1,
                      borderColor: isActive ? ORANGE : BORDER,
                      borderRadius: 2, overflow: 'hidden',
                    }}
                  >
                    {uri ? (
                      <Image source={{ uri }} style={{ width: 80, height: 60 }} contentFit="cover" />
                    ) : (
                      <View style={{ width: 80, height: 60, backgroundColor: '#111' }} />
                    )}
                    <View style={{ padding: 3, backgroundColor: '#0F0F0F' }}>
                      <Text style={{ color: TEXT_MUTED, fontSize: 8, fontFamily: 'monospace' }}>
                        {formatTime(frame.receivedAt)}
                      </Text>
                      <Text style={{ color: RED, fontSize: 8, fontFamily: 'monospace' }}>
                        {frame.maxTemp.toFixed(1)}°
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>

        {/* ===== 底部信息 ===== */}
        {displayFrame && (
          <View style={{
            backgroundColor: CARD_BG, borderColor: BORDER, borderWidth: 1,
            borderRadius: 2, padding: 10,
          }}>
            <Text style={{ color: TEXT_MUTED, fontSize: 10, fontFamily: 'monospace' }}>
              分辨率: {displayFrame.width} × {displayFrame.height}  ·  像素数: {displayFrame.width * displayFrame.height}  ·  {formatTime(displayFrame.receivedAt)}
            </Text>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}