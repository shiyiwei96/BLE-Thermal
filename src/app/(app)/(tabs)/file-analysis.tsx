/**
 * 文件分析页 — RGB/RAW/JPG/PNG 导入与图像分析
 * 工业级暗色仪表盘风格
 */
import React, { useCallback, useRef, useState } from 'react';
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

import {
  analyzeImage,
  CHANNEL_COLORS,
  CHANNEL_LABELS,
  detectFileType,
  formatFileSize,
  genId,
  getPixel,
  getRgbaForView,
  isRawType,
  rgbaToBmpDataUri,
  type PixelInfo,
} from '@/lib/fileAnalysis';
import type {
  ChannelView,
  ImageAnalysisResult,
  ImportedFileRecord,
  RgbFileParams,
} from '@/lib/types';
import { MAX_FILE_HISTORY } from '@/lib/types';

// ─── 主题常量 ────────────────────────────────────────────────────────────────
const BG       = '#121212';
const CARD_BG  = '#1E1E1E';
const BORDER   = '#2A2A2A';
const CYAN     = '#00E5FF';
const GREEN    = '#00E676';
const RED      = '#FF3366';
const ORANGE   = '#FF9100';
const TEXT_PRIMARY = '#E0E0E0';
const TEXT_MUTED   = '#666666';

// ─── 辅助组件 ─────────────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 18, paddingBottom: 4 }}>
      <Text style={{ color: TEXT_MUTED, fontSize: 10, fontWeight: '700', letterSpacing: 1.2 }}>
        {title.toUpperCase()}
      </Text>
    </View>
  );
}

function StatCard({
  label, value, color = TEXT_PRIMARY,
}: { label: string; value: string; color?: string }) {
  return (
    <View style={{
      flex: 1, backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
      borderRadius: 2, padding: 8, alignItems: 'center', gap: 2,
    }}>
      <Text style={{ color: TEXT_MUTED, fontSize: 9 }}>{label}</Text>
      <Text style={{ color, fontSize: 13, fontFamily: 'monospace', fontWeight: '800' }}>{value}</Text>
    </View>
  );
}

/** 迷你柱状图（256 bins） */
function MiniHistogram({
  data, color, height: h = 40,
}: { data: number[]; color: string; height?: number }) {
  const max = Math.max(...data, 1);
  const barW = 1;
  const total = data.length; // 256
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: h, width: total * barW }}>
      {data.map((v, i) => (
        <View
          key={i}
          style={{
            width: barW,
            height: Math.max(1, Math.round((v / max) * h)),
            backgroundColor: color,
            opacity: 0.85,
          }}
        />
      ))}
    </View>
  );
}

/** RGB文件参数输入对话框内嵌面板 */
function RgbParamsPanel({
  params, onChange,
}: {
  params: RgbFileParams;
  onChange: (p: RgbFileParams) => void;
}) {
  const inputStyle = {
    flex: 1, backgroundColor: '#111', borderWidth: 1, borderColor: BORDER,
    borderRadius: 2, paddingHorizontal: 8, paddingVertical: 5,
    color: CYAN, fontSize: 12, fontFamily: 'monospace',
  };
  return (
    <View style={{
      backgroundColor: CARD_BG, borderWidth: 1, borderColor: CYAN,
      borderRadius: 2, padding: 12, gap: 8,
    }}>
      <Text style={{ color: CYAN, fontSize: 11, fontWeight: '700', marginBottom: 2 }}>
        RGB / RAW 文件参数
      </Text>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: TEXT_MUTED, fontSize: 9, marginBottom: 3 }}>宽度（px）</Text>
          <TextInput
            style={inputStyle}
            value={params.width > 0 ? String(params.width) : ''}
            onChangeText={v => onChange({ ...params, width: parseInt(v) || 0 })}
            keyboardType="numeric"
            placeholder="如 640"
            placeholderTextColor={TEXT_MUTED}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: TEXT_MUTED, fontSize: 9, marginBottom: 3 }}>高度（px）</Text>
          <TextInput
            style={inputStyle}
            value={params.height > 0 ? String(params.height) : ''}
            onChangeText={v => onChange({ ...params, height: parseInt(v) || 0 })}
            keyboardType="numeric"
            placeholder="如 480"
            placeholderTextColor={TEXT_MUTED}
          />
        </View>
      </View>

      {/* 通道数 */}
      <View>
        <Text style={{ color: TEXT_MUTED, fontSize: 9, marginBottom: 4 }}>通道数</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {([1, 3, 4] as const).map(ch => (
            <Pressable
              key={ch}
              cssInterop={false}
              onPress={() => onChange({ ...params, channels: ch })}
              style={({ pressed }) => ({
                flex: 1, paddingVertical: 5, borderRadius: 2, borderWidth: 1,
                borderColor: params.channels === ch ? CYAN : BORDER,
                backgroundColor: params.channels === ch ? `${CYAN}15` : 'transparent',
                alignItems: 'center', opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: params.channels === ch ? CYAN : TEXT_MUTED, fontSize: 11, fontWeight: '700' }}>
                {ch === 1 ? '灰度' : ch === 3 ? 'RGB' : 'RGBA'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* 像素深度 */}
      <View>
        <Text style={{ color: TEXT_MUTED, fontSize: 9, marginBottom: 4 }}>像素深度</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {(['uint8', 'uint16'] as const).map(d => (
            <Pressable
              key={d}
              cssInterop={false}
              onPress={() => onChange({ ...params, depth: d })}
              style={({ pressed }) => ({
                flex: 1, paddingVertical: 5, borderRadius: 2, borderWidth: 1,
                borderColor: params.depth === d ? ORANGE : BORDER,
                backgroundColor: params.depth === d ? `${ORANGE}15` : 'transparent',
                alignItems: 'center', opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: params.depth === d ? ORANGE : TEXT_MUTED, fontSize: 11, fontWeight: '700' }}>
                {d}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

// ─── 主页面 ──────────────────────────────────────────────────────────────────

export default function FileAnalysisScreen() {
  // ── 状态 ──
  const [history, setHistory] = useState<ImportedFileRecord[]>([]);
  const [current, setCurrent] = useState<ImportedFileRecord | null>(null);
  const [channelView, setChannelView] = useState<ChannelView>(null);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [pixelInfo, setPixelInfo] = useState<PixelInfo | null>(null);
  const [showParams, setShowParams] = useState(false);
  const [rgbParams, setRgbParams] = useState<RgbFileParams>({
    width: 0, height: 0, channels: 3, depth: 'uint8',
  });
  // 暂存待解析的 rgb 文件
  const pendingRgbRef = useRef<{ name: string; buf: ArrayBuffer; size: number } | null>(null);
  // 当前图像像素缓存（用于通道切换和像素查询）
  const rgbaRef = useRef<Uint8Array | null>(null);

  // ── 每次进入页面都无需重新加载（状态已在内存）──
  useFocusEffect(useCallback(() => { /* nothing */ }, []));

  // ─── 消息提示 ───────────────────────────────────────────────────────────────
  const showErr = (msg: string) => {
    setErrMsg(msg);
    setTimeout(() => setErrMsg(''), 3500);
  };
  const showInfo = (msg: string) => {
    setInfoMsg(msg);
    setTimeout(() => setInfoMsg(''), 2500);
  };

  // ─── 导入文件 ───────────────────────────────────────────────────────────────
  const handleImport = async () => {
    setErrMsg('');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'application/octet-stream', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      const fileName = asset.name ?? 'unknown';
      const fileType = detectFileType(fileName);

      if (!fileType) {
        showErr('不支持的文件格式，仅支持 .rgb / .raw / .jpg / .jpeg / .png');
        return;
      }

      if (isRawType(fileType)) {
        // 需要用户输入参数后再解析
        const buf = await readFileAsArrayBuffer(asset.uri);
        if (!buf) { showErr('文件读取失败'); return; }
        pendingRgbRef.current = { name: fileName, buf, size: buf.byteLength };
        setRgbParams({ width: 0, height: 0, channels: 3, depth: 'uint8' });
        setShowParams(true);
      } else {
        // JPG/PNG — 直接作为图像 data URI 显示
        await importImageFile(asset.uri, fileName, fileType, asset.size ?? 0);
      }
    } catch {
      showErr('文件选取失败，请重试');
    }
  };

  /** 读取文件为 ArrayBuffer（通过 base64 转换） */
  const readFileAsArrayBuffer = async (uri: string): Promise<ArrayBuffer | null> => {
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const binary = atob(b64);
      const buf = new ArrayBuffer(binary.length);
      const view = new Uint8Array(buf);
      for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
      return buf;
    } catch {
      return null;
    }
  };

  /** JPG/PNG 图像文件导入并分析 */
  const importImageFile = async (
    uri: string,
    fileName: string,
    fileType: 'jpg' | 'jpeg' | 'png',
    fileSize: number
  ) => {
    setLoading(true);
    try {
      // 读取文件为 base64 data URI
      const b64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const mime = fileType === 'png' ? 'image/png' : 'image/jpeg';
      const dataUri = `data:${mime};base64,${b64}`;

      // 对于 JPG/PNG，无法在纯 JS 中轻松解码像素，
      // 用 expo-image 显示即可，分析结果显示占位说明
      const record: ImportedFileRecord = {
        id: genId(),
        importedAt: Date.now(),
        fileName,
        fileSize: fileSize || b64.length * 0.75,
        fileType,
        width: 0,
        height: 0,
        channels: 3,
        dataUri,
      };

      pushHistory(record);
      setCurrent(record);
      setChannelView(null);
      rgbaRef.current = null;
      showInfo('图像导入成功');
    } finally {
      setLoading(false);
    }
  };

  /** 确认 RGB 参数并解析 */
  const handleConfirmRgb = async () => {
    const pending = pendingRgbRef.current;
    if (!pending) return;

    if (rgbParams.width <= 0 || rgbParams.height <= 0) {
      showErr('请输入有效的宽度和高度');
      return;
    }
    const expectedBytes =
      rgbParams.width * rgbParams.height * rgbParams.channels *
      (rgbParams.depth === 'uint16' ? 2 : 1);
    if (pending.buf.byteLength < expectedBytes) {
      showErr(
        `文件大小（${pending.buf.byteLength} B）与参数不匹配（需 ${expectedBytes} B）`
      );
      return;
    }

    setLoading(true);
    setShowParams(false);
    try {
      const { parseRgbBuffer } = await import('@/lib/fileAnalysis');
      const rgba = parseRgbBuffer(pending.buf, rgbParams);
      if (!rgba) { showErr('RGB 数据解析失败，请检查参数'); setLoading(false); return; }

      rgbaRef.current = rgba;
      const analysis = analyzeImage(rgba, rgbParams.width, rgbParams.height, rgbParams.channels);
      const dataUri = rgbaToBmpDataUri(rgba, rgbParams.width, rgbParams.height);

      const record: ImportedFileRecord = {
        id: genId(),
        importedAt: Date.now(),
        fileName: pending.name,
        fileSize: pending.size,
        fileType: detectFileType(pending.name) ?? 'rgb',
        width: rgbParams.width,
        height: rgbParams.height,
        channels: rgbParams.channels,
        dataUri,
        analysis,
        rgbParams: { ...rgbParams },
      };

      pushHistory(record);
      setCurrent(record);
      setChannelView(null);
      pendingRgbRef.current = null;
      showInfo('RGB 文件解析成功');
    } finally {
      setLoading(false);
    }
  };

  /** 当查看历史记录时，如果是 rgb 类型则重新解析通道图 */
  const handleSelectHistory = (rec: ImportedFileRecord) => {
    setCurrent(rec);
    setChannelView(null);
    setPixelInfo(null);
    rgbaRef.current = null;

    if (rec.rgbParams) {
      // 重新解析通道数据（异步，不阻塞 UI）
      (async () => {
        const b64 = rec.dataUri.split(',')[1];
        if (!b64 || !rec.rgbParams) return;
        // BMP dataUri 不能直接还原原始 RGB 字节，只展示已渲染图
        // 通道视图在历史回放时不可用
        rgbaRef.current = null;
      })();
    }
  };

  // 切换通道视图（仅对有 RGBA 缓存的 RGB 文件可用）
  const handleChannelView = (ch: ChannelView) => {
    setChannelView(ch);
    setPixelInfo(null);
    if (current && rgbaRef.current) {
      const pixels = getRgbaForView(
        rgbaRef.current,
        current.width * current.height,
        ch
      );
      const uri = rgbaToBmpDataUri(pixels, current.width, current.height);
      setCurrent(prev => prev ? { ...prev, _viewDataUri: uri } as ImportedFileRecord & { _viewDataUri: string } : prev);
    }
  };

  // 删除历史记录
  const handleDelete = (id: string) => {
    setHistory(prev => prev.filter(r => r.id !== id));
    if (current?.id === id) { setCurrent(null); rgbaRef.current = null; }
  };

  const pushHistory = (rec: ImportedFileRecord) => {
    setHistory(prev => {
      const next = [rec, ...prev].slice(0, MAX_FILE_HISTORY);
      return next;
    });
  };

  // 显示的图像 URI（通道视图 or 原始）
  const displayUri =
    (current && (current as unknown as Record<string, unknown>)['_viewDataUri'] as string | undefined)
    ?? current?.dataUri;

  const canSplitChannel = !!(current?.rgbParams && rgbaRef.current);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 顶部标题栏 ── */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
          borderBottomWidth: 1, borderBottomColor: BORDER,
        }}>
          <View>
            <Text style={{ color: TEXT_PRIMARY, fontSize: 15, fontWeight: '800', letterSpacing: 0.5 }}>
              文件分析
            </Text>
            <Text style={{ color: TEXT_MUTED, fontSize: 10, marginTop: 1 }}>
              RGB / RAW / JPG / PNG 导入与图像分析
            </Text>
          </View>
          <Pressable
            cssInterop={false}
            onPress={handleImport}
            disabled={loading}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', gap: 5,
              backgroundColor: `${CYAN}18`, borderWidth: 1, borderColor: CYAN,
              borderRadius: 2, paddingHorizontal: 12, paddingVertical: 7,
              opacity: pressed || loading ? 0.6 : 1,
            })}
          >
            {loading
              ? <ActivityIndicator size="small" color={CYAN} />
              : <Ionicons name="document-attach" size={14} color={CYAN} />
            }
            <Text style={{ color: CYAN, fontSize: 11, fontWeight: '700' }}>导入文件</Text>
          </Pressable>
        </View>

        {/* ── RGB 参数面板 ── */}
        {showParams && (
          <View style={{ marginHorizontal: 16, marginTop: 12 }}>
            <RgbParamsPanel params={rgbParams} onChange={setRgbParams} />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <Pressable
                cssInterop={false}
                onPress={() => { setShowParams(false); pendingRgbRef.current = null; }}
                style={({ pressed }) => ({
                  flex: 1, borderWidth: 1, borderColor: BORDER, borderRadius: 2,
                  paddingVertical: 8, alignItems: 'center', opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ color: TEXT_MUTED, fontSize: 12 }}>取消</Text>
              </Pressable>
              <Pressable
                cssInterop={false}
                onPress={handleConfirmRgb}
                style={({ pressed }) => ({
                  flex: 2, backgroundColor: `${CYAN}20`, borderWidth: 1, borderColor: CYAN,
                  borderRadius: 2, paddingVertical: 8, alignItems: 'center', opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ color: CYAN, fontSize: 12, fontWeight: '700' }}>确认解析</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* ── 消息提示 ── */}
        {errMsg !== '' && (
          <View style={{
            marginHorizontal: 16, marginTop: 10, backgroundColor: `${RED}15`,
            borderWidth: 1, borderColor: RED, borderRadius: 2, padding: 8,
          }}>
            <Text style={{ color: RED, fontSize: 11 }}>{errMsg}</Text>
          </View>
        )}
        {infoMsg !== '' && (
          <View style={{
            marginHorizontal: 16, marginTop: 10, backgroundColor: `${GREEN}15`,
            borderWidth: 1, borderColor: GREEN, borderRadius: 2, padding: 8,
          }}>
            <Text style={{ color: GREEN, fontSize: 11 }}>{infoMsg}</Text>
          </View>
        )}

        {/* ── 当前图像显示 ── */}
        {current ? (
          <>
            <SectionHeader title="图像预览" />
            <View style={{ marginHorizontal: 16 }}>
              <View style={{
                backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
                borderRadius: 2, overflow: 'hidden',
              }}>
                {/* 图像 */}
                <Image
                  source={{ uri: displayUri }}
                  style={{ width: '100%', aspectRatio: current.width > 0 && current.height > 0
                    ? current.width / current.height
                    : 4 / 3,
                    backgroundColor: '#000',
                  }}
                  contentFit="contain"
                />

                {/* 像素信息悬浮 */}
                {pixelInfo && (
                  <View style={{
                    position: 'absolute', top: 8, right: 8,
                    backgroundColor: 'rgba(0,0,0,0.75)', borderWidth: 1, borderColor: CYAN,
                    borderRadius: 2, padding: 6,
                  }}>
                    <Text style={{ color: CYAN, fontSize: 10, fontFamily: 'monospace' }}>
                      ({pixelInfo.x},{pixelInfo.y})
                    </Text>
                    <Text style={{ color: '#FF6666', fontSize: 10, fontFamily: 'monospace' }}>R:{pixelInfo.r}</Text>
                    <Text style={{ color: '#66FF66', fontSize: 10, fontFamily: 'monospace' }}>G:{pixelInfo.g}</Text>
                    <Text style={{ color: '#6699FF', fontSize: 10, fontFamily: 'monospace' }}>B:{pixelInfo.b}</Text>
                  </View>
                )}
              </View>

              {/* 文件信息 */}
              <View style={{
                backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
                borderRadius: 2, padding: 10, marginTop: 6,
              }}>
                <Text style={{ color: TEXT_PRIMARY, fontSize: 11, fontFamily: 'monospace', fontWeight: '700' }}>
                  {current.fileName}
                </Text>
                <Text style={{ color: TEXT_MUTED, fontSize: 10, marginTop: 3, fontFamily: 'monospace' }}>
                  {current.width > 0 ? `${current.width} × ${current.height}` : '尺寸未知'}
                  {'  ·  '}
                  {formatFileSize(current.fileSize)}
                  {'  ·  '}
                  {current.fileType.toUpperCase()}
                  {'  ·  '}
                  {new Date(current.importedAt).toLocaleTimeString()}
                </Text>
              </View>
            </View>

            {/* ── 通道分离视图（仅 RGB 文件） ── */}
            {canSplitChannel && (
              <>
                <SectionHeader title="通道分离" />
                <View style={{ marginHorizontal: 16 }}>
                  <View style={{
                    backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
                    borderRadius: 2, padding: 10,
                  }}>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {([null, 0, 1, 2] as ChannelView[]).map((ch, idx) => {
                        const labels = CHANNEL_LABELS[current.channels] ?? ['R','G','B'];
                        const label = ch === null ? '合成' : (labels[ch] ?? `CH${ch}`);
                        const color = ch === null ? TEXT_PRIMARY : CHANNEL_COLORS[ch as number];
                        return (
                          <Pressable
                            key={idx}
                            cssInterop={false}
                            disabled={ch !== null && (current.channels === 1)}
                            onPress={() => handleChannelView(ch)}
                            style={({ pressed }) => ({
                              flex: 1, paddingVertical: 6, borderRadius: 2, borderWidth: 1,
                              borderColor: channelView === ch ? color : BORDER,
                              backgroundColor: channelView === ch ? `${color}20` : 'transparent',
                              alignItems: 'center',
                              opacity: (pressed || (ch !== null && current.channels === 1)) ? 0.4 : 1,
                            })}
                          >
                            <Text style={{ color: channelView === ch ? color : TEXT_MUTED, fontSize: 10, fontWeight: '700' }}>
                              {label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={{ color: TEXT_MUTED, fontSize: 9, marginTop: 6 }}>
                      * 通道分离仅对本次导入的 RGB/RAW 文件有效
                    </Text>
                  </View>
                </View>
              </>
            )}

            {/* ── 图像分析结果 ── */}
            {current.analysis ? (
              <AnalysisPanel analysis={current.analysis} />
            ) : (
              <View style={{ marginHorizontal: 16, marginTop: 12 }}>
                <View style={{
                  backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
                  borderRadius: 2, padding: 14, alignItems: 'center',
                }}>
                  <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>
                    JPG/PNG 文件无法在纯 JS 环境中像素级解码，请导入 .rgb/.raw 原始文件以获取完整分析结果。
                  </Text>
                </View>
              </View>
            )}
          </>
        ) : (
          /* 空状态 */
          <View style={{
            marginHorizontal: 16, marginTop: 32,
            backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
            borderRadius: 2, padding: 32, alignItems: 'center', gap: 8,
          }}>
            <Ionicons name="document-attach-outline" size={36} color={TEXT_MUTED} />
            <Text style={{ color: TEXT_MUTED, fontSize: 12, textAlign: 'center', lineHeight: 18 }}>
              点击右上角「导入文件」{'\n'}选择 RGB / RAW / JPG / PNG 图像
            </Text>
          </View>
        )}

        {/* ── 导入历史 ── */}
        {history.length > 0 && (
          <>
            <SectionHeader title={`导入历史  (${history.length}/${MAX_FILE_HISTORY})`} />
            <View style={{ marginHorizontal: 16 }}>
              <View style={{
                backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 2,
              }}>
                <FlatList
                  data={history}
                  keyExtractor={r => r.id}
                  scrollEnabled={false}
                  ItemSeparatorComponent={() => (
                    <View style={{ height: 1, backgroundColor: BORDER }} />
                  )}
                  renderItem={({ item }) => (
                    <Pressable
                      cssInterop={false}
                      onPress={() => handleSelectHistory(item)}
                      style={({ pressed }) => ({
                        flexDirection: 'row', alignItems: 'center', gap: 10,
                        paddingHorizontal: 12, paddingVertical: 10,
                        backgroundColor: current?.id === item.id ? `${CYAN}10` : 'transparent',
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      {/* 缩略图 */}
                      <Image
                        source={{ uri: item.dataUri }}
                        style={{ width: 36, height: 36, borderRadius: 2, backgroundColor: '#000' }}
                        contentFit="cover"
                      />
                      {/* 信息 */}
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text
                          style={{ color: current?.id === item.id ? CYAN : TEXT_PRIMARY, fontSize: 11, fontFamily: 'monospace' }}
                          numberOfLines={1}
                        >
                          {item.fileName}
                        </Text>
                        <Text style={{ color: TEXT_MUTED, fontSize: 9, fontFamily: 'monospace' }}>
                          {item.width > 0 ? `${item.width}×${item.height}  ·  ` : ''}
                          {formatFileSize(item.fileSize)}  ·  
                          {new Date(item.importedAt).toLocaleTimeString()}
                        </Text>
                      </View>
                      {/* 质量评分 */}
                      {item.analysis && (
                        <View style={{
                          backgroundColor: scoreColor(item.analysis.qualityScore) + '20',
                          borderWidth: 1, borderColor: scoreColor(item.analysis.qualityScore),
                          borderRadius: 2, paddingHorizontal: 6, paddingVertical: 2,
                        }}>
                          <Text style={{ color: scoreColor(item.analysis.qualityScore), fontSize: 11, fontWeight: '800' }}>
                            {item.analysis.qualityScore}
                          </Text>
                        </View>
                      )}
                      {/* 删除 */}
                      <Pressable
                        cssInterop={false}
                        onPress={() => handleDelete(item.id)}
                        style={({ pressed }) => ({ padding: 4, opacity: pressed ? 0.5 : 1 })}
                      >
                        <Ionicons name="trash-outline" size={14} color={TEXT_MUTED} />
                      </Pressable>
                    </Pressable>
                  )}
                />
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── 分析结果面板 ─────────────────────────────────────────────────────────────

function AnalysisPanel({ analysis }: { analysis: ImageAnalysisResult }) {
  const { channelStats, brightnessStats, rmsContrast, qualityScore } = analysis;
  const channelNames = CHANNEL_LABELS[analysis.channels] ?? ['R', 'G', 'B'];
  const score = qualityScore;
  const scoreC = scoreColor(score);

  return (
    <>
      {/* 质量评分 */}
      <SectionHeader title="图像质量评分" />
      <View style={{ marginHorizontal: 16 }}>
        <View style={{
          backgroundColor: CARD_BG, borderWidth: 1, borderColor: scoreC,
          borderRadius: 2, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 14,
        }}>
          <View style={{ alignItems: 'center', width: 60 }}>
            <Text style={{ color: scoreC, fontSize: 32, fontWeight: '900', fontFamily: 'monospace' }}>
              {score}
            </Text>
            <Text style={{ color: scoreC, fontSize: 9, letterSpacing: 1 }}>/ 100</Text>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <ScoreBar label="亮度" value={brightnessStats.mean} max={255} color={ORANGE} />
            <ScoreBar label="对比度" value={rmsContrast * 100} max={50} color={CYAN} />
            <ScoreBar label="过曝占比" value={brightnessStats.overexposedRatio * 100} max={10} color={RED} invert />
            <ScoreBar label="欠曝占比" value={brightnessStats.underexposedRatio * 100} max={10} color={RED} invert />
          </View>
        </View>
      </View>

      {/* 基础统计 */}
      <SectionHeader title="通道统计" />
      <View style={{ marginHorizontal: 16, gap: 8 }}>
        {channelStats.map((cs, idx) => (
          <View key={idx} style={{
            backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 2, padding: 10,
          }}>
            <Text style={{ color: CHANNEL_COLORS[idx] ?? TEXT_PRIMARY, fontSize: 10, fontWeight: '700', marginBottom: 6 }}>
              {channelNames[idx] ?? `CH${idx}`}
            </Text>
            <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
              <StatCard label="均值" value={cs.mean.toFixed(1)} color={CHANNEL_COLORS[idx] ?? CYAN} />
              <StatCard label="方差" value={cs.variance.toFixed(1)} color={TEXT_PRIMARY} />
              <StatCard label="最小" value={String(cs.min)} color={TEXT_PRIMARY} />
              <StatCard label="最大" value={String(cs.max)} color={TEXT_PRIMARY} />
            </View>
            {/* 直方图 */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <MiniHistogram data={cs.histogram} color={CHANNEL_COLORS[idx] ?? CYAN} height={36} />
            </ScrollView>
          </View>
        ))}
      </View>

      {/* 亮度分析 */}
      <SectionHeader title="亮度分析" />
      <View style={{ marginHorizontal: 16 }}>
        <View style={{
          backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 2, padding: 10,
        }}>
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
            <StatCard label="亮度均值" value={brightnessStats.mean.toFixed(1)} color={ORANGE} />
            <StatCard
              label="过曝占比"
              value={`${(brightnessStats.overexposedRatio * 100).toFixed(2)}%`}
              color={brightnessStats.overexposedRatio > 0.05 ? RED : GREEN}
            />
            <StatCard
              label="欠曝占比"
              value={`${(brightnessStats.underexposedRatio * 100).toFixed(2)}%`}
              color={brightnessStats.underexposedRatio > 0.05 ? RED : GREEN}
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <MiniHistogram data={brightnessStats.histogram} color={ORANGE} height={40} />
          </ScrollView>
        </View>
      </View>

      {/* 对比度 */}
      <SectionHeader title="对比度分析" />
      <View style={{ marginHorizontal: 16 }}>
        <View style={{
          backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 2, padding: 12,
          flexDirection: 'row', alignItems: 'center', gap: 12,
        }}>
          <View>
            <Text style={{ color: TEXT_MUTED, fontSize: 9 }}>RMS 对比度</Text>
            <Text style={{ color: CYAN, fontSize: 22, fontFamily: 'monospace', fontWeight: '900' }}>
              {rmsContrast.toFixed(4)}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <ContrastBar value={rmsContrast} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 }}>
              <Text style={{ color: TEXT_MUTED, fontSize: 8 }}>0 (低)</Text>
              <Text style={{ color: TEXT_MUTED, fontSize: 8 }}>0.35 (优)</Text>
              <Text style={{ color: TEXT_MUTED, fontSize: 8 }}>1.0 (高)</Text>
            </View>
          </View>
        </View>
      </View>
    </>
  );
}

// ─── 辅助 UI ─────────────────────────────────────────────────────────────────

function ScoreBar({
  label, value, max, color, invert = false,
}: { label: string; value: number; max: number; color: string; invert?: boolean }) {
  const ratio = Math.min(1, value / max);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Text style={{ color: TEXT_MUTED, fontSize: 9, width: 44 }}>{label}</Text>
      <View style={{ flex: 1, height: 4, backgroundColor: BORDER, borderRadius: 1 }}>
        <View style={{
          width: `${ratio * 100}%`,
          height: '100%',
          backgroundColor: invert ? (ratio > 0.5 ? RED : GREEN) : color,
          borderRadius: 1,
        }} />
      </View>
      <Text style={{ color, fontSize: 9, fontFamily: 'monospace', width: 36, textAlign: 'right' }}>
        {invert ? `${value.toFixed(2)}%` : value.toFixed(1)}
      </Text>
    </View>
  );
}

function ContrastBar({ value }: { value: number }) {
  const ratio = Math.min(1, value);
  const good = value >= 0.05 && value <= 0.45;
  const color = good ? GREEN : value < 0.05 ? ORANGE : RED;
  return (
    <View style={{ height: 8, backgroundColor: BORDER, borderRadius: 1 }}>
      <View style={{
        width: `${ratio * 100}%`, height: '100%',
        backgroundColor: color, borderRadius: 1,
      }} />
    </View>
  );
}

function scoreColor(score: number) {
  if (score >= 70) return GREEN;
  if (score >= 40) return ORANGE;
  return RED;
}
