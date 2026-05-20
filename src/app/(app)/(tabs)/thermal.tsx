/**
 * 热相分析页
 * - 实时显示伪彩色热成像图
 * - 最高/最低/平均温度标注
 * - 触摸框选区域温度分析
 * - 历史帧列表 + 回放
 * - 保存当前帧到相册
 * - 热相录制与导出（JSON/CSV/图像序列）
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  useWindowDimensions,
  GestureResponderEvent,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { useFocusEffect, useRouter } from 'expo-router';
import { useBle } from '@/lib/bleContext';
import {
  renderThermalPixels,
  pixelsToDataUri,
  calcRegionStats,
  toFahrenheit,
  COLORMAP_LABELS,
} from '@/lib/thermalAnalysis';
import type { ThermalColormap, ThermalFrame, ThermalRecording, ThermalRegionStats } from '@/lib/types';
import {
  createRecording,
  appendFrame,
  stopRecording,
  exportAsJson,
  exportAsCsv,
  exportImageSequence,
  formatDuration,
} from '@/lib/thermalRecording';

// ============ 颜色常量 ============
const DARK_BG      = '#121212';
const CARD_BG      = '#1A1A1A';
const BORDER       = '#333333';
const TEXT_PRIMARY = '#E0E0E0';
const TEXT_MUTED   = '#666666';
const CYAN         = '#00E5FF';
const RED          = '#FF3333';
const ORANGE       = '#FF6B00';
const GREEN        = '#00E676';
const BLUE_COLD    = '#00BFFF';

// ============ 工具 ============
function formatTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function tempStr(c: number, unit: 'C' | 'F'): string {
  if (unit === 'F') return `${toFahrenheit(c).toFixed(1)}°F`;
  return `${c.toFixed(1)}°C`;
}

// ============ 温度统计卡片 ============
function TempCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 2, padding: 10, alignItems: 'center', gap: 2 }}>
      <Text style={{ color: TEXT_MUTED, fontSize: 9 }}>{label}</Text>
      <Text style={{ color, fontSize: 16, fontWeight: '800', fontFamily: 'monospace' }}>{value}</Text>
    </View>
  );
}

// ============ 伪彩色色标带 ============
function ColormapLegend({ min, max, colormap, unit }: { min: number; max: number; colormap: ThermalColormap; unit: 'C' | 'F' }) {
  const steps = 20;
  return (
    <View style={{ marginTop: 8, gap: 4 }}>
      <View style={{ flexDirection: 'row', height: 12, borderRadius: 1, overflow: 'hidden', borderWidth: 1, borderColor: BORDER }}>
        {Array.from({ length: steps }, (_, i) => {
          const t = i / (steps - 1);
          // 近似色标（简化为 HSL 铁红/彩虹等）
          const hue = colormap === 'rainbow'
            ? Math.round((1 - t) * 240)
            : colormap === 'iron'
              ? Math.round(t * 60)
              : null;
          const bg = hue !== null
            ? `hsl(${hue},100%,${30 + t * 40}%)`
            : `rgb(${Math.round(t * 255)},${Math.round(t * 255)},${Math.round(t * 255)})`;
          return <View key={i} style={{ flex: 1, backgroundColor: bg }} />;
        })}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: TEXT_MUTED, fontSize: 9, fontFamily: 'monospace' }}>{tempStr(min, unit)}</Text>
        <Text style={{ color: TEXT_MUTED, fontSize: 9, fontFamily: 'monospace' }}>{tempStr((min + max) / 2, unit)}</Text>
        <Text style={{ color: TEXT_MUTED, fontSize: 9, fontFamily: 'monospace' }}>{tempStr(max, unit)}</Text>
      </View>
    </View>
  );
}

// ============ 历史帧缩略卡 ============
function FrameThumb({ frame, dataUri, isActive, onPress }: {
  frame: ThermalFrame;
  dataUri: string;
  isActive: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      cssInterop={false}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: isActive ? `${CYAN}18` : CARD_BG,
        borderWidth: 1,
        borderColor: isActive ? CYAN : BORDER,
        borderRadius: 2,
        overflow: 'hidden',
        width: 80,
        marginRight: 8,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Image source={{ uri: dataUri }} style={{ width: 80, height: 50, backgroundColor: '#111' }} contentFit="fill" />
      <View style={{ padding: 3 }}>
        <Text style={{ color: isActive ? CYAN : TEXT_MUTED, fontSize: 8, fontFamily: 'monospace' }}>
          {formatTime(frame.receivedAt)}
        </Text>
        <Text style={{ color: isActive ? CYAN : TEXT_MUTED, fontSize: 8 }}>
          {frame.maxTemp.toFixed(1)}°
        </Text>
      </View>
    </Pressable>
  );
}

// ============ 主页面 ============
export default function ThermalScreen() {
  const {
    connectedDevice,
    latestThermalFrame,
    latestThermalDataUri,
    thermalFrames,
    settings,
    updateSettings,
    clearThermalFrames,
  } = useBle();
  const router = useRouter();

  const { width } = useWindowDimensions();
  const imgWidth = width - 32;

  // 当前显示帧（null=实时最新）
  const [viewFrame, setViewFrame] = useState<ThermalFrame | null>(null);
  const [viewDataUri, setViewDataUri] = useState<string | null>(null);

  // 框选区域
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [regionStats, setRegionStats] = useState<ThermalRegionStats | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const imgContainerRef = useRef<View>(null);
  const [imgLayout, setImgLayout] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // 保存状态
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [permError, setPermError] = useState<string | null>(null);

  // 历史帧缓存的 dataUri（用于缩略图显示）
  const [frameUriCache, setFrameUriCache] = useState<Record<string, string>>({});

  // ===== 录制状态 =====
  const [recording, setRecording] = useState<ThermalRecording | null>(null);
  const recordingRef = useRef<ThermalRecording | null>(null);
  const [completedRecordings, setCompletedRecordings] = useState<ThermalRecording[]>([]);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null); // 'json'|'csv'|'img'

  const colormap = settings.thermalColormap;
  const unit = settings.thermalUnit;

  // 同步新帧到缓存（仅最新一帧）+ 追加到录制
  React.useEffect(() => {
    if (latestThermalFrame && latestThermalDataUri) {
      setFrameUriCache(prev => ({
        ...prev,
        [latestThermalFrame.id]: latestThermalDataUri,
      }));
      // 追加到录制中
      if (recordingRef.current) {
        const updated = appendFrame(recordingRef.current, latestThermalFrame, latestThermalDataUri);
        recordingRef.current = updated;
        setRecording({ ...updated });
      }
    }
  }, [latestThermalFrame, latestThermalDataUri]);

  // 获取缓存 dataUri 或实时渲染
  const getFrameUri = useCallback((frame: ThermalFrame): string => {
    if (frameUriCache[frame.id]) return frameUriCache[frame.id];
    const pixels = renderThermalPixels(frame, colormap);
    const uri = pixelsToDataUri(pixels, frame.width, frame.height);
    setFrameUriCache(prev => ({ ...prev, [frame.id]: uri }));
    return uri;
  }, [frameUriCache, colormap]);

  useFocusEffect(useCallback(() => {
    // 焦点切换时重置到实时模式
    setViewFrame(null);
    setViewDataUri(null);
    setSelectionBox(null);
    setRegionStats(null);
  }, []));

  // ===== 录制控制 =====
  const handleStartRecording = useCallback(() => {
    if (!connectedDevice) return;
    const rec = createRecording(connectedDevice.id, connectedDevice.name ?? connectedDevice.id);
    recordingRef.current = rec;
    setRecording(rec);
    setExportMsg(null);
    setExportError(null);
  }, [connectedDevice]);

  const handleStopRecording = useCallback(() => {
    if (!recordingRef.current) return;
    const stopped = stopRecording(recordingRef.current);
    recordingRef.current = null;
    setRecording(null);
    setCompletedRecordings(prev => [stopped, ...prev].slice(0, 10));
  }, []);

  const handleExport = useCallback(async (rec: ThermalRecording, type: 'json' | 'csv' | 'img') => {
    setExporting(type);
    setExportMsg(null);
    setExportError(null);
    try {
      if (type === 'json') await exportAsJson(rec);
      else if (type === 'csv') await exportAsCsv(rec);
      else await exportImageSequence(rec);
      setExportMsg(`导出成功（${type.toUpperCase()}）`);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : '导出失败');
    }
    setExporting(null);
  }, []);

  const displayFrame = viewFrame ?? latestThermalFrame;
  const displayUri   = viewDataUri ?? latestThermalDataUri;

  // ===== 计算图像在屏幕上实际显示高度 =====
  const imgHeight = displayFrame
    ? imgWidth * (displayFrame.height / Math.max(displayFrame.width, 1))
    : imgWidth * 0.75;

  // ===== 框选手势 =====
  const onTouchStart = (e: GestureResponderEvent) => {
    if (!imgLayout) return;
    const { locationX, locationY } = e.nativeEvent;
    dragStartRef.current = { x: locationX, y: locationY };
    setSelectionBox(null);
    setRegionStats(null);
  };

  const onTouchMove = (e: GestureResponderEvent) => {
    if (!dragStartRef.current || !imgLayout) return;
    const { locationX, locationY } = e.nativeEvent;
    const sx = Math.min(dragStartRef.current.x, locationX);
    const sy = Math.min(dragStartRef.current.y, locationY);
    const sw = Math.abs(locationX - dragStartRef.current.x);
    const sh = Math.abs(locationY - dragStartRef.current.y);
    setSelectionBox({ x: sx, y: sy, w: sw, h: sh });
  };

  const onTouchEnd = () => {
    if (!selectionBox || !displayFrame || !imgLayout) return;
    // 将像素坐标映射回帧坐标
    const scaleX = displayFrame.width  / imgLayout.w;
    const scaleY = displayFrame.height / imgLayout.h;
    const region = {
      x: Math.round(selectionBox.x * scaleX),
      y: Math.round(selectionBox.y * scaleY),
      w: Math.round(selectionBox.w * scaleX),
      h: Math.round(selectionBox.h * scaleY),
    };
    const stats = calcRegionStats(displayFrame, region);
    setRegionStats(stats);
    dragStartRef.current = null;
  };

  // ===== 保存到相册 =====
  const handleSave = async () => {
    if (!displayUri) return;
    setSaving(true);
    setSaveMsg(null);
    setPermError(null);
    const { status } = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
    if (status !== 'granted') {
      setPermError('需要相册权限，请在系统设置中授权。');
      setSaving(false);
      return;
    }
    try {
      const base64 = displayUri.replace(/^data:image\/\w+;base64,/, '');
      const localUri = `${FileSystem.cacheDirectory}thermal_${Date.now()}.bmp`;
      await FileSystem.writeAsStringAsync(localUri, base64, { encoding: FileSystem.EncodingType.Base64 });
      await MediaLibrary.createAssetAsync(localUri);
      setSaveMsg('热相图已保存到相册');
    } catch (e) {
      setPermError('保存失败：' + (e instanceof Error ? e.message : String(e)));
    }
    setSaving(false);
  };

  const isLive = !viewFrame;
  const isConnected = !!connectedDevice;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: DARK_BG }}>
      {/* ===== 顶部标题 ===== */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomColor: BORDER, borderBottomWidth: 1, backgroundColor: '#0F0F0F' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Text style={{ color: ORANGE, fontSize: 16, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1 }}>
              THERMAL
            </Text>
            <Text style={{ color: TEXT_MUTED, fontSize: 10, marginTop: 1 }}>
              {isConnected ? `已连接: ${connectedDevice.name ?? connectedDevice.address}` : '未连接设备'}
            </Text>
          </View>
          {/* 实时/历史切换指示 + 录制按钮 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {!isLive && (
              <Pressable
                cssInterop={false}
                onPress={() => { setViewFrame(null); setViewDataUri(null); setSelectionBox(null); setRegionStats(null); }}
                style={({ pressed }) => ({
                  paddingHorizontal: 10, paddingVertical: 4, borderRadius: 2, borderWidth: 1,
                  borderColor: CYAN, backgroundColor: `${CYAN}18`, opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ color: CYAN, fontSize: 10, fontWeight: '800' }}>回到实时</Text>
              </Pressable>
            )}
            {/* 录制按钮 */}
            {isConnected && (
              <Pressable
                cssInterop={false}
                onPress={recording ? handleStopRecording : handleStartRecording}
                style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center', gap: 4,
                  paddingHorizontal: 10, paddingVertical: 4, borderRadius: 2, borderWidth: 1,
                  borderColor: recording ? RED : GREEN,
                  backgroundColor: recording ? `${RED}20` : `${GREEN}15`,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View style={{
                  width: 6, height: 6, borderRadius: 3,
                  backgroundColor: recording ? RED : GREEN,
                }} />
                <Text style={{ color: recording ? RED : GREEN, fontSize: 10, fontWeight: '800' }}>
                  {recording ? `${recording.frameCount}帧` : '录制'}
                </Text>
              </Pressable>
            )}
            {/* 录制管理 */}
            {completedRecordings.length > 0 && (
              <Pressable
                cssInterop={false}
                onPress={() => router.push('/(app)/thermal-recordings')}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 4 })}
              >
                <Ionicons name="folder-open" size={16} color={ORANGE} />
              </Pressable>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: isLive && latestThermalFrame ? GREEN : TEXT_MUTED }} />
              <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>{isLive ? '实时' : '历史回放'}</Text>
            </View>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} contentInsetAdjustmentBehavior="automatic">

        {/* ===== 热成像图 ===== */}
        <View
          ref={imgContainerRef}
          onLayout={e => {
            const { width: w, height: h } = e.nativeEvent.layout;
            setImgLayout({ x: 0, y: 0, w, h });
          }}
          style={{ width: imgWidth, height: imgHeight, backgroundColor: '#111', borderWidth: 1, borderColor: BORDER, borderRadius: 2, overflow: 'hidden', position: 'relative' }}
          onStartShouldSetResponder={() => !!displayFrame}
          onResponderGrant={onTouchStart}
          onResponderMove={onTouchMove}
          onResponderRelease={onTouchEnd}
        >
          {displayUri ? (
            <Image source={{ uri: displayUri }} style={{ width: '100%', height: '100%' }} contentFit="fill" />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Ionicons name="thermometer-outline" size={40} color={TEXT_MUTED} />
              <Text style={{ color: TEXT_MUTED, fontSize: 12 }}>
                {isConnected ? '等待热相数据…' : '请先连接蓝牙设备'}
              </Text>
            </View>
          )}

          {/* 框选 overlay */}
          {selectionBox && (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: selectionBox.x,
                top: selectionBox.y,
                width: selectionBox.w,
                height: selectionBox.h,
                borderWidth: 1,
                borderColor: '#FFFFFF',
                borderStyle: 'dashed',
                backgroundColor: 'rgba(255,255,255,0.08)',
              }}
            />
          )}

          {/* 最高温标注 */}
          {displayFrame && imgLayout && (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: (displayFrame.maxPos.x / displayFrame.width) * imgLayout.w - 8,
                top:  (displayFrame.maxPos.y / displayFrame.height) * imgLayout.h - 8,
              }}
            >
              <Text style={{ color: RED, fontSize: 10, fontFamily: 'monospace', fontWeight: '800' }}>
                ⊕{displayFrame.maxTemp.toFixed(1)}°
              </Text>
            </View>
          )}

          {/* 最低温标注 */}
          {displayFrame && imgLayout && (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: (displayFrame.minPos.x / displayFrame.width) * imgLayout.w - 8,
                top:  (displayFrame.minPos.y / displayFrame.height) * imgLayout.h + 2,
              }}
            >
              <Text style={{ color: BLUE_COLD, fontSize: 10, fontFamily: 'monospace', fontWeight: '800' }}>
                ⊕{displayFrame.minTemp.toFixed(1)}°
              </Text>
            </View>
          )}

          {/* 时间戳 */}
          {displayFrame && (
            <View pointerEvents="none" style={{ position: 'absolute', bottom: 4, right: 6 }}>
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, fontFamily: 'monospace' }}>
                {formatTime(displayFrame.receivedAt)}
              </Text>
            </View>
          )}
        </View>

        {/* 触摸提示 */}
        {displayFrame && (
          <Text style={{ color: TEXT_MUTED, fontSize: 10, textAlign: 'center', marginTop: -6 }}>
            拖动图像可框选区域进行温度分析
          </Text>
        )}

        {/* ===== 温度统计 ===== */}
        {displayFrame ? (
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TempCard label="最高温度" value={tempStr(displayFrame.maxTemp, unit)} color={RED} />
            <TempCard label="平均温度" value={tempStr(displayFrame.avgTemp, unit)} color={ORANGE} />
            <TempCard label="最低温度" value={tempStr(displayFrame.minTemp, unit)} color={BLUE_COLD} />
          </View>
        ) : (
          <View style={{ backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 2, padding: 16, alignItems: 'center' }}>
            <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>连接设备并接收热相数据后显示温度统计</Text>
          </View>
        )}

        {/* ===== 框选区域统计 ===== */}
        {regionStats && (
          <View style={{ backgroundColor: CARD_BG, borderWidth: 1, borderColor: CYAN, borderRadius: 2, padding: 12 }}>
            <Text style={{ color: CYAN, fontSize: 11, fontWeight: '700', marginBottom: 8 }}>框选区域温度分析</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <TempCard label="区域最高" value={tempStr(regionStats.maxTemp, unit)} color={RED} />
              <TempCard label="区域平均" value={tempStr(regionStats.avgTemp, unit)} color={ORANGE} />
              <TempCard label="区域最低" value={tempStr(regionStats.minTemp, unit)} color={BLUE_COLD} />
            </View>
            <Pressable
              cssInterop={false}
              onPress={() => { setSelectionBox(null); setRegionStats(null); }}
              style={({ pressed }) => ({ marginTop: 8, alignSelf: 'flex-end', opacity: pressed ? 0.6 : 1 })}
            >
              <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>清除框选</Text>
            </Pressable>
          </View>
        )}

        {/* ===== 色标 + 伪彩色切换 ===== */}
        {displayFrame && (
          <View style={{ backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 2, padding: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <Text style={{ color: TEXT_PRIMARY, fontSize: 11, fontWeight: '700' }}>伪彩色映射</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {(['iron', 'rainbow', 'grayscale', 'plasma'] as ThermalColormap[]).map(c => (
                  <Pressable
                    key={c}
                    cssInterop={false}
                    onPress={() => updateSettings({ thermalColormap: c })}
                    style={({ pressed }) => ({
                      paddingHorizontal: 8, paddingVertical: 4, borderRadius: 2, borderWidth: 1,
                      borderColor: colormap === c ? ORANGE : BORDER,
                      backgroundColor: colormap === c ? `${ORANGE}20` : 'transparent',
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ color: colormap === c ? ORANGE : TEXT_MUTED, fontSize: 10, fontWeight: colormap === c ? '800' : '400' }}>
                      {COLORMAP_LABELS[c]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <ColormapLegend
              min={displayFrame.minTemp}
              max={displayFrame.maxTemp}
              colormap={colormap}
              unit={unit}
            />
          </View>
        )}

        {/* ===== 温度单位 + 操作按钮 ===== */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {/* 单位切换 */}
          <View style={{ flex: 1, backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 2, padding: 10 }}>
            <Text style={{ color: TEXT_MUTED, fontSize: 10, marginBottom: 6 }}>温度单位</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {(['C', 'F'] as const).map(u => (
                <Pressable
                  key={u}
                  cssInterop={false}
                  onPress={() => updateSettings({ thermalUnit: u })}
                  style={({ pressed }) => ({
                    flex: 1, paddingVertical: 6, borderRadius: 2, borderWidth: 1,
                    borderColor: unit === u ? CYAN : BORDER,
                    backgroundColor: unit === u ? `${CYAN}18` : 'transparent',
                    alignItems: 'center', opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ color: unit === u ? CYAN : TEXT_MUTED, fontSize: 13, fontWeight: '800' }}>
                    °{u}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* 保存按钮 */}
          <Pressable
            cssInterop={false}
            onPress={handleSave}
            disabled={!displayUri || saving}
            style={({ pressed }) => ({
              flex: 1, backgroundColor: CARD_BG, borderWidth: 1,
              borderColor: displayUri ? CYAN : BORDER,
              borderRadius: 2, padding: 10, alignItems: 'center', justifyContent: 'center',
              opacity: pressed || !displayUri ? 0.6 : 1,
            })}
          >
            {saving ? (
              <ActivityIndicator size="small" color={CYAN} />
            ) : (
              <View style={{ alignItems: 'center', gap: 4 }}>
                <Ionicons name="download" size={20} color={displayUri ? CYAN : TEXT_MUTED} />
                <Text style={{ color: displayUri ? CYAN : TEXT_MUTED, fontSize: 10 }}>保存图像</Text>
              </View>
            )}
          </Pressable>
        </View>

        {/* 权限/保存提示 */}
        {permError && (
          <View style={{ backgroundColor: `${RED}15`, borderWidth: 1, borderColor: RED, borderRadius: 2, padding: 8 }}>
            <Text style={{ color: RED, fontSize: 11 }}>{permError}</Text>
          </View>
        )}
        {saveMsg && (
          <View style={{ backgroundColor: `${GREEN}15`, borderWidth: 1, borderColor: GREEN, borderRadius: 2, padding: 8 }}>
            <Text style={{ color: GREEN, fontSize: 11 }}>{saveMsg}</Text>
          </View>
        )}

        {/* ===== 历史帧回放 ===== */}
        <View style={{ backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 2, padding: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ color: TEXT_PRIMARY, fontSize: 11, fontWeight: '700' }}>
              历史帧  <Text style={{ color: TEXT_MUTED, fontWeight: '400' }}>({thermalFrames.length}/100)</Text>
            </Text>
            {thermalFrames.length > 0 && (
              <Pressable
                cssInterop={false}
                onPress={() => { clearThermalFrames(); setViewFrame(null); setViewDataUri(null); }}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <Ionicons name="trash-outline" size={15} color={TEXT_MUTED} />
              </Pressable>
            )}
          </View>

          {thermalFrames.length === 0 ? (
            <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>暂无历史帧</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {thermalFrames.map(frame => {
                const uri = getFrameUri(frame);
                const isActive = viewFrame?.id === frame.id || (isLive && frame.id === latestThermalFrame?.id);
                return (
                  <FrameThumb
                    key={frame.id}
                    frame={frame}
                    dataUri={uri}
                    isActive={isActive}
                    onPress={() => {
                      setViewFrame(frame);
                      setViewDataUri(uri);
                      setSelectionBox(null);
                      setRegionStats(null);
                    }}
                  />
                );
              })}
            </ScrollView>
          )}
        </View>

        {/* ===== 分辨率信息 ===== */}
        {displayFrame && (
          <View style={{ backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 2, padding: 10 }}>
            <Text style={{ color: TEXT_MUTED, fontSize: 10, fontFamily: 'monospace' }}>
              分辨率: {displayFrame.width} × {displayFrame.height}  ·  像素数: {(displayFrame.width * displayFrame.height).toLocaleString()}  ·  {formatTime(displayFrame.receivedAt)}
            </Text>
          </View>
        )}

        {/* ===== 录制状态卡片 ===== */}
        {recording && (
          <View style={{
            backgroundColor: `${RED}12`, borderWidth: 1, borderColor: `${RED}60`,
            borderRadius: 2, padding: 12,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: RED }} />
              <Text style={{ color: RED, fontSize: 12, fontWeight: '800', flex: 1 }}>
                录制中：{recording.name}
              </Text>
              <Pressable
                cssInterop={false}
                onPress={handleStopRecording}
                style={({ pressed }) => ({
                  backgroundColor: `${RED}30`, borderRadius: 4,
                  paddingHorizontal: 12, paddingVertical: 5, opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ color: RED, fontSize: 11, fontWeight: '800' }}>停止</Text>
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>
                帧数: <Text style={{ color: TEXT_PRIMARY, fontWeight: '700' }}>{recording.frameCount}</Text>
              </Text>
              <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>
                时长: <Text style={{ color: TEXT_PRIMARY, fontWeight: '700' }}>{formatDuration(recording.durationMs)}</Text>
              </Text>
            </View>
          </View>
        )}

        {/* ===== 已完成录制列表 ===== */}
        {completedRecordings.length > 0 && (
          <View style={{ backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 2, padding: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <Text style={{ color: TEXT_PRIMARY, fontSize: 11, fontWeight: '700' }}>
                已完成录制 ({completedRecordings.length})
              </Text>
            </View>

            {exportMsg && (
              <View style={{ backgroundColor: `${GREEN}15`, borderRadius: 4, padding: 8, marginBottom: 8 }}>
                <Text style={{ color: GREEN, fontSize: 11 }}>{exportMsg}</Text>
              </View>
            )}
            {exportError && (
              <View style={{ backgroundColor: `${RED}15`, borderRadius: 4, padding: 8, marginBottom: 8 }}>
                <Text style={{ color: RED, fontSize: 11 }}>{exportError}</Text>
              </View>
            )}

            {completedRecordings.map(rec => (
              <View key={rec.id} style={{
                borderWidth: 1, borderColor: BORDER, borderRadius: 4,
                padding: 10, marginBottom: 8,
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={{ color: TEXT_PRIMARY, fontSize: 12, fontWeight: '700', flex: 1 }}>
                    {rec.name}
                  </Text>
                  <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>
                    {rec.frameCount} 帧 · {formatDuration(rec.durationMs)}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {(['json', 'csv', 'img'] as const).map(type => (
                    <Pressable
                      key={type}
                      cssInterop={false}
                      disabled={!!exporting}
                      onPress={() => handleExport(rec, type)}
                      style={({ pressed }) => ({
                        flex: 1, paddingVertical: 6, borderRadius: 4, alignItems: 'center',
                        borderWidth: 1,
                        borderColor: exporting === type ? CYAN : BORDER,
                        backgroundColor: exporting === type ? `${CYAN}20` : `${BORDER}30`,
                        opacity: pressed || (!!exporting && exporting !== type) ? 0.5 : 1,
                      })}
                    >
                      {exporting === type
                        ? <ActivityIndicator size="small" color={CYAN} />
                        : <Text style={{ color: TEXT_MUTED, fontSize: 10, fontWeight: '700' }}>
                            {type === 'img' ? '图像序列' : type.toUpperCase()}
                          </Text>
                      }
                    </Pressable>
                  ))}
                  <Pressable
                    cssInterop={false}
                    onPress={() => setCompletedRecordings(p => p.filter(r => r.id !== rec.id))}
                    style={({ pressed }) => ({
                      paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4,
                      borderWidth: 1, borderColor: `${RED}40`,
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <Ionicons name="trash-outline" size={13} color={RED} />
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}
