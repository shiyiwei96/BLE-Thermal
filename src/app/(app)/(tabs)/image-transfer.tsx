/**
 * 蓝牙图传页
 * - 实时显示分包接收进度
 * - 接收完成后展示完整图片
 * - 流式模式：自动轮播最新图像帧（连续传输场景）
 * - 流录制：录制图像帧序列到本地
 * - 历史图片列表（最多 50 张）
 * - 支持查看大图 / 保存到相册 / 删除
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, Modal, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { useFocusEffect } from 'expo-router';
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

// ============ 进度条 ============
function ProgressBar({ received, total }: { received: number; total: number }) {
  const pct = total > 0 ? received / total : 0;
  return (
    <View style={{ height: 4, backgroundColor: '#222', borderRadius: 2, overflow: 'hidden', marginTop: 6 }}>
      <View style={{
        height: 4,
        width: `${Math.round(pct * 100)}%` as `${number}%`,
        backgroundColor: CYAN, borderRadius: 2,
      }} />
    </View>
  );
}

// ============ 大图预览 Modal ============
function ImagePreviewModal({
  record, onClose, onSave, onDelete,
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
      <View style={{
        flex: 1, backgroundColor: 'rgba(0,0,0,0.92)',
        justifyContent: 'center', alignItems: 'center',
      }}>
        <View style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
          paddingHorizontal: 16, paddingTop: 52, paddingBottom: 12,
          backgroundColor: 'rgba(0,0,0,0.6)',
        }}>
          <Pressable cssInterop={false} onPress={onClose} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <Ionicons name="close" size={26} color={TEXT_PRIMARY} />
          </Pressable>
          <Text style={{ color: TEXT_MUTED, fontSize: 11, fontFamily: 'monospace' }}>
            {formatTime(record.receivedAt)}
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
            <Pressable
              cssInterop={false}
              onPress={() => { onDelete(record.id); onClose(); }}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Ionicons name="trash" size={24} color={RED} />
            </Pressable>
          </View>
        </View>

        <Image
          source={{ uri: record.dataUri }}
          style={{ width: '100%', aspectRatio: 4 / 3 }}
          contentFit="contain"
        />

        {saveMsg && (
          <View style={{
            marginTop: 16, paddingHorizontal: 16, paddingVertical: 6,
            backgroundColor: `${GREEN}20`, borderWidth: 1, borderColor: GREEN, borderRadius: 2,
          }}>
            <Text style={{ color: GREEN, fontSize: 12 }}>{saveMsg}</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ============ 主页面 ============
export default function ImageTransferScreen() {
  // 👇 全部从 useBle 拿（和原版一样，不改引用）
  const {
    connectedDevice, imageHistory, imageProgress, clearImageHistory, settings,
    latestImageDataUri, imageStreamMode, setImageStreamMode,
  } = useBle();

  const [previewRecord, setPreviewRecord] = useState<ImageTransferRecord | null>(null);
  const [localHistory, setLocalHistory] = useState<ImageTransferRecord[]>([]);
  const [permError, setPermError] = useState<string | null>(null);

  // 流式录制
  const [streamRecording, setStreamRecording] = useState(false);
  const [streamRecordedFrames, setStreamRecordedFrames] = useState<ImageTransferRecord[]>([]);
  const [streamRecordMsg, setStreamRecordMsg] = useState<string | null>(null);
  const prevHistoryLen = React.useRef(0);

  const bufferSize = settings?.streamBufferSize ?? 3;
  const streamBuffer = localHistory.slice(0, bufferSize);

  // 焦点同步
  useFocusEffect(useCallback(() => {
    setLocalHistory(imageHistory);
    prevHistoryLen.current = imageHistory.length;
  }, [imageHistory]));

  // 同步历史 + 录制
  useEffect(() => {
    setLocalHistory(imageHistory);
    if (streamRecording && imageHistory.length > prevHistoryLen.current) {
      const newFrames = imageHistory.slice(0, imageHistory.length - prevHistoryLen.current);
      setStreamRecordedFrames(prev => [...newFrames, ...prev]);
    }
    prevHistoryLen.current = imageHistory.length;
  }, [imageHistory, streamRecording]);

  // 保存到相册
  const handleSave = async (record: ImageTransferRecord) => {
    setPermError(null);
    const { status } = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
    if (status !== 'granted') {
      setPermError('需要相册权限才能保存图片，请在系统设置中授权。');
      return;
    }
    try {
      const base64 = record.dataUri.replace(/^data:image\/\w+;base64,/, '');
      const ext = record.dataUri.startsWith('data:image/jpeg') ? 'jpg' : 'png';
      const localUri = `${FileSystem.cacheDirectory}img_${record.id}.${ext}`;
      await FileSystem.writeAsStringAsync(localUri, base64, { encoding: FileSystem.EncodingType.Base64 });
      await MediaLibrary.createAssetAsync(localUri);
    } catch (e) {
      setPermError('保存失败：' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleDelete = (id: string) => {
    setLocalHistory(prev => prev.filter(r => r.id !== id));
  };

  const handleToggleStreamRecord = () => {
    if (streamRecording) {
      setStreamRecording(false);
      setStreamRecordMsg(`录制完成，共 ${streamRecordedFrames.length} 帧`);
    } else {
      setStreamRecordedFrames([]);
      setStreamRecordMsg(null);
      setStreamRecording(true);
    }
  };

  const isConnected = !!connectedDevice;
  const pct = imageProgress
    ? Math.round((imageProgress.receivedChunks / imageProgress.totalChunks) * 100)
    : 0;

  // 当前实时帧（直接用 latestImageDataUri）
  const currentStreamFrame: ImageTransferRecord | null = imageStreamMode && latestImageDataUri
    ? {
        id: 'live',
        receivedAt: Date.now(),
        totalChunks: 1,
        receivedChunks: 1,
        dataUri: latestImageDataUri,
        isComplete: true,
      }
    : null;

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
            IMG TRANSFER
          </Text>
          <Text style={{ color: TEXT_MUTED, fontSize: 10, marginTop: 1 }}>
            {isConnected
              ? `已连接: ${connectedDevice.name ?? connectedDevice.address}`
              : '未连接设备'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Pressable
            cssInterop={false}
            onPress={() => setImageStreamMode(!imageStreamMode)}
            style={({ pressed }) => ({
              paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4,
              borderWidth: 1,
              borderColor: imageStreamMode ? GREEN : BORDER,
              backgroundColor: imageStreamMode ? `${GREEN}18` : 'transparent',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{
              color: imageStreamMode ? GREEN : TEXT_MUTED,
              fontSize: 10, fontWeight: '700',
            }}>
              {imageStreamMode ? '流式 ON' : '流式 OFF'}
            </Text>
          </Pressable>
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
      </View>

      <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }} contentInsetAdjustmentBehavior="automatic">

        {/* ===== 实时视窗 ===== */}
        {imageStreamMode && (
          <View style={{
            backgroundColor: CARD_BG, borderWidth: 1, borderColor: GREEN,
            borderRadius: 2, overflow: 'hidden',
          }}>
            <View style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingHorizontal: 12, paddingVertical: 8,
              borderBottomWidth: 1, borderBottomColor: BORDER,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: GREEN }} />
                <Text style={{ color: GREEN, fontSize: 11, fontWeight: '800' }}>
                  实时视窗 {latestImageDataUri ? '[实时]' : '[无帧]'}
                </Text>
              </View>
              <Pressable
                cssInterop={false}
                onPress={handleToggleStreamRecord}
                style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center', gap: 4,
                  paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, borderWidth: 1,
                  borderColor: streamRecording ? RED : BORDER,
                  backgroundColor: streamRecording ? `${RED}20` : 'transparent',
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: streamRecording ? RED : TEXT_MUTED }} />
                <Text style={{ color: streamRecording ? RED : TEXT_MUTED, fontSize: 10, fontWeight: '700' }}>
                  {streamRecording ? `录制 ${streamRecordedFrames.length}帧` : '录制'}
                </Text>
              </Pressable>
            </View>

            {currentStreamFrame ? (
              <Pressable onPress={() => setPreviewRecord(currentStreamFrame)}>
                <Image
                  source={{ uri: currentStreamFrame.dataUri }}
                  style={{ width: '100%', aspectRatio: 4 / 3 }}
                  contentFit="contain"
                />
                <View style={{
                  position: 'absolute', bottom: 6, right: 8,
                  backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4,
                  paddingHorizontal: 6, paddingVertical: 2,
                }}>
                  <Text style={{ color: GREEN, fontSize: 9, fontFamily: 'monospace' }}>
                    {formatTime(currentStreamFrame.receivedAt)}
                  </Text>
                </View>
              </Pressable>
            ) : (
              <View style={{ aspectRatio: 4 / 3, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="videocam-outline" size={40} color={TEXT_MUTED} />
                <Text style={{ color: TEXT_MUTED, fontSize: 12, marginTop: 8 }}>等待图像帧…</Text>
              </View>
            )}

            {streamRecordMsg && (
              <View style={{ padding: 8, borderTopWidth: 1, borderTopColor: BORDER }}>
                <Text style={{ color: GREEN, fontSize: 11 }}>{streamRecordMsg}</Text>
              </View>
            )}
          </View>
        )}

        {/* ===== 传输状态 ===== */}
        <View style={{
          backgroundColor: CARD_BG, borderWidth: 1, borderColor: imageProgress ? CYAN : BORDER,
          borderRadius: 2, padding: 12,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: TEXT_PRIMARY, fontSize: 12, fontWeight: '700' }}>当前传输状态</Text>
            {imageProgress && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <ActivityIndicator size="small" color={CYAN} />
                <Text style={{ color: CYAN, fontSize: 12, fontFamily: 'monospace' }}>
                  {imageProgress.receivedChunks}/{imageProgress.totalChunks} {pct}%
                </Text>
              </View>
            )}
          </View>
          {imageProgress ? (
            <ProgressBar received={imageProgress.receivedChunks} total={imageProgress.totalChunks} />
          ) : (
            <Text style={{ color: TEXT_MUTED, fontSize: 11, marginTop: 8 }}>
              {isConnected
                ? imageStreamMode ? '流式模式：实时刷新' : '等待设备发送图像数据包…'
                : '请先在"设备扫描"页连接蓝牙设备'}
            </Text>
          )}
        </View>

        {/* ===== 错误提示 ===== */}
        {permError && (
          <View style={{ backgroundColor: `${RED}15`, borderWidth: 1, borderColor: RED, borderRadius: 2, padding: 10 }}>
            <Text style={{ color: RED, fontSize: 11 }}>{permError}</Text>
          </View>
        )}

        {/* ===== 历史图片（横向滚动）===== */}
        <View style={{
          backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
          borderRadius: 2, padding: 12,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ color: TEXT_PRIMARY, fontSize: 12, fontWeight: '700' }}>历史图片</Text>
            <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>
              {localHistory.length} 张（最多 50 张）
            </Text>
          </View>

          {localHistory.length === 0 ? (
            <View style={{ paddingVertical: 30, alignItems: 'center', gap: 8 }}>
              <Ionicons name="images-outline" size={40} color={TEXT_MUTED} />
              <Text style={{ color: TEXT_MUTED, fontSize: 12 }}>暂无历史图片</Text>
              <Text style={{ color: TEXT_MUTED, fontSize: 10, textAlign: 'center' }}>
                连接设备后，图传数据接收完成将自动显示在这里
              </Text>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {localHistory.map(item => (
                  <Pressable
                    key={item.id}
                    cssInterop={false}
                    onPress={() => setPreviewRecord(item)}
                    style={{
                      width: 100, borderWidth: 1, borderColor: BORDER,
                      borderRadius: 2, overflow: 'hidden',
                    }}
                  >
                    <Image
                      source={{ uri: item.dataUri }}
                      style={{ width: 100, height: 75, backgroundColor: '#111' }}
                      contentFit="cover"
                    />
                    <View style={{ padding: 3, backgroundColor: '#0F0F0F' }}>
                      <Text style={{ color: TEXT_MUTED, fontSize: 8, fontFamily: 'monospace' }}>
                        {formatTime(item.receivedAt)}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          )}
        </View>

      </ScrollView>

      {/* ===== 大图预览 ===== */}
      <ImagePreviewModal
        record={previewRecord}
        onClose={() => setPreviewRecord(null)}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </SafeAreaView>
  );
}
