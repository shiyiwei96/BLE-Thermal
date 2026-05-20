/**
 * 热相录制管理页（Stack 级别）
 * 列表查看、导出（JSON/CSV/图像序列）、删除已完成录制
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { ThermalRecording } from '@/lib/types';
import {
  exportAsJson,
  exportAsCsv,
  exportImageSequence,
  formatDuration,
} from '@/lib/thermalRecording';

const BG     = '#121212';
const CARD   = '#1A1A1A';
const BORDER = '#2A2A2A';
const CYAN   = '#00E5FF';
const RED    = '#FF3366';
const GREEN  = '#00E676';
const ORANGE = '#FF9100';
const TEXT   = '#E8E8E8';
const MUTED  = '#666666';

// 模拟数据（实际使用时通过 navigation params 或全局 context 传入）
const EMPTY: ThermalRecording[] = [];

export default function ThermalRecordingsScreen() {
  const router = useRouter();
  // 本页面以 prop 的形式接收录制列表（通过 router.params 或全局 store）
  // 此处展示管理 UI，实际数据由 thermal.tsx 的 completedRecordings 传入
  const [recordings, setRecordings] = useState<ThermalRecording[]>(EMPTY);
  const [exporting, setExporting] = useState<string | null>(null); // recordingId_type
  const [msg, setMsg] = useState<{ text: string; isError: boolean } | null>(null);

  const handleExport = async (rec: ThermalRecording, type: 'json' | 'csv' | 'img') => {
    const key = `${rec.id}_${type}`;
    setExporting(key);
    setMsg(null);
    try {
      if (type === 'json') await exportAsJson(rec);
      else if (type === 'csv') await exportAsCsv(rec);
      else await exportImageSequence(rec);
      setMsg({ text: `导出成功（${type.toUpperCase()}）`, isError: false });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : '导出失败', isError: true });
    }
    setExporting(null);
  };

  const handleDelete = (id: string) => {
    setRecordings(prev => prev.filter(r => r.id !== id));
  };

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
        <Text style={{ color: ORANGE, fontSize: 15, fontWeight: '800', letterSpacing: 1, flex: 1 }}>
          录制管理
        </Text>
        <Text style={{ color: MUTED, fontSize: 11 }}>{recordings.length} 条</Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 14 }}
        showsVerticalScrollIndicator={false}
      >
        {/* 消息反馈 */}
        {msg && (
          <View style={{
            backgroundColor: msg.isError ? `${RED}18` : `${GREEN}18`,
            borderWidth: 1, borderColor: msg.isError ? `${RED}50` : `${GREEN}50`,
            borderRadius: 6, padding: 10, marginBottom: 12,
          }}>
            <Text style={{ color: msg.isError ? RED : GREEN, fontSize: 12 }}>{msg.text}</Text>
          </View>
        )}

        {/* 空态 */}
        {recordings.length === 0 && (
          <View style={{
            alignItems: 'center', paddingVertical: 64,
            borderWidth: 1, borderColor: BORDER, borderRadius: 8,
          }}>
            <Ionicons name="film-outline" size={48} color={MUTED} />
            <Text style={{ color: MUTED, fontSize: 14, marginTop: 14, fontWeight: '600' }}>
              暂无录制记录
            </Text>
            <Text style={{ color: MUTED, fontSize: 12, marginTop: 6, textAlign: 'center' }}>
              在热相页面点击「录制」按钮开始录制
            </Text>
          </View>
        )}

        {/* 录制列表 */}
        {recordings.map(rec => (
          <View key={rec.id} style={{
            backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
            borderRadius: 8, padding: 14, marginBottom: 10,
          }}>
            {/* 录制信息头 */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 }}>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={{ color: TEXT, fontSize: 14, fontWeight: '700' }}>{rec.name}</Text>
                <Text style={{ color: MUTED, fontSize: 11 }}>
                  设备：{rec.deviceName}
                </Text>
                <Text style={{ color: MUTED, fontSize: 11, fontFamily: 'monospace' }}>
                  {new Date(rec.createdAt).toLocaleString('zh-CN')}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <View style={{
                  backgroundColor: `${CYAN}20`, borderRadius: 4,
                  paddingHorizontal: 8, paddingVertical: 3,
                }}>
                  <Text style={{ color: CYAN, fontSize: 11, fontWeight: '700' }}>
                    {rec.frameCount} 帧
                  </Text>
                </View>
                <Text style={{ color: MUTED, fontSize: 11 }}>
                  {formatDuration(rec.durationMs)}
                </Text>
              </View>
            </View>

            {/* 温度范围摘要 */}
            {rec.frames.length > 0 && (() => {
              const maxT = Math.max(...rec.frames.map(f => f.maxTemp));
              const minT = Math.min(...rec.frames.map(f => f.minTemp));
              const avgT = rec.frames.reduce((s, f) => s + f.avgTemp, 0) / rec.frames.length;
              return (
                <View style={{
                  flexDirection: 'row', gap: 8, marginBottom: 12,
                  backgroundColor: '#0D0D0D', borderRadius: 6, padding: 10,
                }}>
                  <StatMini label="峰值最高" value={`${maxT.toFixed(1)}℃`} color={RED} />
                  <StatMini label="峰值最低" value={`${minT.toFixed(1)}℃`} color="#00BFFF" />
                  <StatMini label="全程均值" value={`${avgT.toFixed(1)}℃`} color={ORANGE} />
                </View>
              );
            })()}

            {/* 导出按钮 */}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['json', 'csv', 'img'] as const).map(type => {
                const key = `${rec.id}_${type}`;
                const isLoading = exporting === key;
                return (
                  <Pressable
                    key={type}
                    cssInterop={false}
                    disabled={!!exporting}
                    onPress={() => handleExport(rec, type)}
                    style={({ pressed }) => ({
                      flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: 'center',
                      borderWidth: 1,
                      borderColor: isLoading ? CYAN : `${BORDER}`,
                      backgroundColor: isLoading ? `${CYAN}15` : '#141414',
                      opacity: pressed || (!!exporting && !isLoading) ? 0.5 : 1,
                    })}
                  >
                    {isLoading
                      ? <ActivityIndicator size="small" color={CYAN} />
                      : <>
                          <Ionicons
                            name={type === 'img' ? 'images-outline' : 'document-text-outline'}
                            size={14} color={MUTED}
                          />
                          <Text style={{ color: MUTED, fontSize: 10, fontWeight: '700', marginTop: 3 }}>
                            {type === 'img' ? '图像序列' : type.toUpperCase()}
                          </Text>
                        </>
                    }
                  </Pressable>
                );
              })}
              <Pressable
                cssInterop={false}
                onPress={() => handleDelete(rec.id)}
                style={({ pressed }) => ({
                  paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6,
                  borderWidth: 1, borderColor: `${RED}40`,
                  backgroundColor: `${RED}10`,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Ionicons name="trash-outline" size={14} color={RED} />
              </Pressable>
            </View>
          </View>
        ))}

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function StatMini({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ color: MUTED, fontSize: 9, marginBottom: 2 }}>{label}</Text>
      <Text style={{ color, fontSize: 12, fontWeight: '700', fontFamily: 'monospace' }}>{value}</Text>
    </View>
  );
}
