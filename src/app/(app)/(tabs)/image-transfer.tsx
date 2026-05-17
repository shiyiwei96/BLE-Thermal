/**
 * 蓝牙图传页
 * - 实时显示分包接收进度
 * - 接收完成后展示完整图片
 * - 历史图片列表（最多 50 张）
 * - 支持查看大图 / 保存到相册 / 删除
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  FlatList,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useBle } from '@/lib/bleContext';
import type { ImageTransferRecord } from '@/lib/types';

// ============ 颜色常量 ============
const DARK_BG      = '#121212';
const CARD_BG      = '#1A1A1A';
const BORDER       = '#333333';
const TEXT_PRIMARY = '#E0E0E0';
const TEXT_MUTED   = '#666666';
const CYAN         = '#00E5FF';
const RED          = '#FF3333';
const GREEN        = '#00E676';

// ============ 工具 ============
function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${formatTime(ts)}`;
}

// ============ 进度条 ============
function ProgressBar({ received, total }: { received: number; total: number }) {
  const pct = total > 0 ? received / total : 0;
  return (
    <View style={{ height: 4, backgroundColor: '#222', borderRadius: 2, overflow: 'hidden', marginTop: 6 }}>
      <View style={{ height: 4, width: `${Math.round(pct * 100)}%` as `${number}%`, backgroundColor: CYAN, borderRadius: 2 }} />
    </View>
  );
}

// ============ 历史缩略图卡片 ============
function ThumbCard({ item, onPress }: { item: ImageTransferRecord; onPress: () => void }) {
  return (
    <Pressable
      cssInterop={false}
      onPress={onPress}
      style={({ pressed }) => ({
        width: '48%' as '48%',
        backgroundColor: CARD_BG,
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 2,
        overflow: 'hidden',
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Image
        source={{ uri: item.dataUri }}
        style={{ width: '100%', aspectRatio: 1.6, backgroundColor: '#111' }}
        contentFit="cover"
      />
      <View style={{ padding: 6 }}>
        <Text style={{ color: TEXT_MUTED, fontSize: 10, fontFamily: 'monospace' }}>
          {formatDate(item.receivedAt)}
        </Text>
        <Text style={{ color: TEXT_MUTED, fontSize: 10, marginTop: 2 }}>
          {item.receivedChunks}/{item.totalChunks} 包
        </Text>
      </View>
    </Pressable>
  );
}

// ============ 大图预览 Modal ============
function ImagePreviewModal({
  record,
  onClose,
  onSave,
  onDelete,
}: {
  record: ImageTransferRecord | null;
  onClose: () => void;
  onSave: (record: ImageTransferRecord) => void;
  onDelete: (id: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  if (!record) return null;

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    await onSave(record);
    setSaveMsg('已保存到相册');
    setSaving(false);
  };

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' }}>
        {/* 工具栏 */}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 52, paddingBottom: 12, backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <Pressable cssInterop={false} onPress={onClose} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <Ionicons name="close" size={26} color={TEXT_PRIMARY} />
          </Pressable>
          <Text style={{ color: TEXT_MUTED, fontSize: 11, fontFamily: 'monospace' }}>
            {formatDate(record.receivedAt)}
          </Text>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            {saving
              ? <ActivityIndicator size="small" color={CYAN} />
              : (
                <Pressable cssInterop={false} onPress={handleSave} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                  <Ionicons name="download" size={24} color={CYAN} />
                </Pressable>
              )
            }
            <Pressable cssInterop={false} onPress={() => { onDelete(record.id); onClose(); }} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Ionicons name="trash" size={24} color={RED} />
            </Pressable>
          </View>
        </View>

        {/* 图片 */}
        <Image
          source={{ uri: record.dataUri }}
          style={{ width: '100%', aspectRatio: 1.6 }}
          contentFit="contain"
        />

        {/* 保存成功提示 */}
        {saveMsg && (
          <View style={{ marginTop: 16, paddingHorizontal: 16, paddingVertical: 6, backgroundColor: `${GREEN}20`, borderWidth: 1, borderColor: GREEN, borderRadius: 2 }}>
            <Text style={{ color: GREEN, fontSize: 12 }}>{saveMsg}</Text>
          </View>
        )}

        {/* 元信息 */}
        <View style={{ marginTop: 12, flexDirection: 'row', gap: 20 }}>
          <Text style={{ color: TEXT_MUTED, fontSize: 11, fontFamily: 'monospace' }}>
            包数 {record.receivedChunks}/{record.totalChunks}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

// ============ 主页面 ============
export default function ImageTransferScreen() {
  const { connectedDevice, imageHistory, imageProgress, clearImageHistory } = useBle();
  const [previewRecord, setPreviewRecord] = useState<ImageTransferRecord | null>(null);
  const [localHistory, setLocalHistory] = useState<ImageTransferRecord[]>([]);
  const [permError, setPermError] = useState<string | null>(null);

  // 每次获得焦点时同步历史
  useFocusEffect(useCallback(() => {
    setLocalHistory(imageHistory);
  }, [imageHistory]));

  // 同步全局 imageHistory 变化
  React.useEffect(() => {
    setLocalHistory(imageHistory);
  }, [imageHistory]);

  // ===== 保存到相册 =====
  const handleSave = async (record: ImageTransferRecord) => {
    setPermError(null);
    const { status } = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
    if (status !== 'granted') {
      setPermError('需要相册权限才能保存图片，请在系统设置中授权。');
      return;
    }
    try {
      // dataUri → 本地临时文件 → createAssetAsync
      const base64 = record.dataUri.replace(/^data:image\/\w+;base64,/, '');
      const ext = record.dataUri.startsWith('data:image/jpeg') ? 'jpg' : 'png';
      const localUri = `${FileSystem.cacheDirectory}img_${record.id}.${ext}`;
      await FileSystem.writeAsStringAsync(localUri, base64, { encoding: FileSystem.EncodingType.Base64 });
      await MediaLibrary.createAssetAsync(localUri);
    } catch (e) {
      setPermError('保存失败：' + (e instanceof Error ? e.message : String(e)));
    }
  };

  // ===== 删除单张 =====
  const handleDelete = (id: string) => {
    setLocalHistory(prev => prev.filter(r => r.id !== id));
  };

  const isConnected = !!connectedDevice;
  const pct = imageProgress
    ? Math.round((imageProgress.receivedChunks / imageProgress.totalChunks) * 100)
    : 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: DARK_BG }}>
      {/* ===== 顶部标题 ===== */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomColor: BORDER, borderBottomWidth: 1, backgroundColor: '#0F0F0F', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <Text style={{ color: CYAN, fontSize: 16, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1 }}>
            IMG TRANSFER
          </Text>
          <Text style={{ color: TEXT_MUTED, fontSize: 10, marginTop: 1 }}>
            {isConnected ? `已连接: ${connectedDevice.name ?? connectedDevice.address}` : '未连接设备'}
          </Text>
        </View>
        {localHistory.length > 0 && (
          <Pressable
            cssInterop={false}
            onPress={() => { clearImageHistory(); setLocalHistory([]); }}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 6 })}
          >
            <Ionicons name="trash-outline" size={18} color={TEXT_MUTED} />
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} contentInsetAdjustmentBehavior="automatic">

        {/* ===== 当前接收进度卡 ===== */}
        <View style={{ backgroundColor: CARD_BG, borderWidth: 1, borderColor: imageProgress ? CYAN : BORDER, borderRadius: 2, padding: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: TEXT_PRIMARY, fontSize: 12, fontWeight: '700' }}>当前传输状态</Text>
            {imageProgress && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <ActivityIndicator size="small" color={CYAN} />
                <Text style={{ color: CYAN, fontSize: 12, fontFamily: 'monospace' }}>
                  {imageProgress.receivedChunks}/{imageProgress.totalChunks}  {pct}%
                </Text>
              </View>
            )}
          </View>

          {imageProgress ? (
            <ProgressBar received={imageProgress.receivedChunks} total={imageProgress.totalChunks} />
          ) : (
            <Text style={{ color: TEXT_MUTED, fontSize: 11, marginTop: 8 }}>
              {isConnected ? '等待设备发送图像数据包…' : '请先在"设备扫描"页连接蓝牙设备'}
            </Text>
          )}

          {!isConnected && (
            <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: TEXT_MUTED }} />
              <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>设备未连接，图传功能不可用</Text>
            </View>
          )}
        </View>

        {/* ===== 权限错误提示 ===== */}
        {permError && (
          <View style={{ backgroundColor: `${RED}15`, borderWidth: 1, borderColor: RED, borderRadius: 2, padding: 10 }}>
            <Text style={{ color: RED, fontSize: 11 }}>{permError}</Text>
          </View>
        )}

        {/* ===== 历史图片列表 ===== */}
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ color: TEXT_PRIMARY, fontSize: 12, fontWeight: '700' }}>
              历史图片
            </Text>
            <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>
              {localHistory.length} 张（最多 50 张）
            </Text>
          </View>

          {localHistory.length === 0 ? (
            <View style={{ backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 2, padding: 32, alignItems: 'center', gap: 8 }}>
              <Ionicons name="images-outline" size={36} color={TEXT_MUTED} />
              <Text style={{ color: TEXT_MUTED, fontSize: 12 }}>暂无历史图片</Text>
              <Text style={{ color: TEXT_MUTED, fontSize: 10, textAlign: 'center' }}>
                连接设备后，图传数据接收完成将自动显示在这里
              </Text>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {localHistory.map(item => (
                <ThumbCard
                  key={item.id}
                  item={item}
                  onPress={() => setPreviewRecord(item)}
                />
              ))}
            </View>
          )}
        </View>

        {/* ===== 使用说明 ===== */}
        <View style={{ backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 2, padding: 12, gap: 6 }}>
          <Text style={{ color: TEXT_MUTED, fontSize: 11, fontWeight: '700', marginBottom: 2 }}>数据包格式说明</Text>
          {[
            'Byte 0-1：包序号（big-endian uint16，0-based）',
            'Byte 2-3：总包数（big-endian uint16）',
            'Byte 4+  ：JPEG / PNG 图像数据',
          ].map((line, i) => (
            <Text key={i} style={{ color: TEXT_MUTED, fontSize: 10, fontFamily: 'monospace' }}>
              {line}
            </Text>
          ))}
        </View>

      </ScrollView>

      {/* ===== 大图预览 Modal ===== */}
      <ImagePreviewModal
        record={previewRecord}
        onClose={() => setPreviewRecord(null)}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </SafeAreaView>
  );
}
