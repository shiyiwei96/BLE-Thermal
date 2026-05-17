/**
 * 设置页 - 配置预警阈值、数据报警规则、字段映射
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useBle } from '@/lib/bleContext';
import { useSerial } from '@/lib/serialContext';
import type { AppSettings, BleUuidConfig, DataAlertRule, FieldMapping, ThresholdOperator } from '@/lib/types';
import { DEFAULT_BLE_UUID, DEFAULT_IMG_THERMAL_UUID, BAUD_RATES, DEFAULT_SERIAL_CONFIG, PARITY_LABELS } from '@/lib/types';

const CYAN = '#00E5FF';
const RED = '#FF3333';
const GREEN = '#00E676';
const ORANGE = '#FF6B00';
const DARK_BG = '#121212';
const CARD_BG = '#1A1A1A';
const BORDER = '#333333';
const TEXT_PRIMARY = '#E0E0E0';
const TEXT_MUTED = '#666666';
const TEXT_SECONDARY = '#AAAAAA';

const OPERATORS: ThresholdOperator[] = ['>', '<', '>=', '<=', '=='];

// ============ 分区标题 ============
function SectionHeader({ title }: { title: string }) {
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
      <Text style={{ color: CYAN, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 }}>
        {title.toUpperCase()}
      </Text>
    </View>
  );
}

// ============ 设置行 ============
function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderBottomColor: '#1E1E1E',
        borderBottomWidth: 1,
        gap: 12,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: TEXT_PRIMARY, fontSize: 13, fontWeight: '600' }}>{label}</Text>
        {description && (
          <Text style={{ color: TEXT_MUTED, fontSize: 11, marginTop: 2, lineHeight: 15 }}>
            {description}
          </Text>
        )}
      </View>
      {children}
    </View>
  );
}

// ============ 数值输入框 ============
function NumberInput({
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  suffix?: string;
}) {
  const [text, setText] = useState(String(value));
  const [error, setError] = useState('');

  useEffect(() => { setText(String(value)); }, [value]);

  const handleBlur = useCallback(() => {
    const num = Number(text);
    if (isNaN(num)) { setError('请输入有效数字'); setText(String(value)); return; }
    if (num < min || num > max) { setError(`范围: ${min}~${max}`); setText(String(value)); return; }
    setError('');
    onChange(num);
  }, [text, value, min, max, onChange]);

  return (
    <View style={{ alignItems: 'flex-end' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <TextInput
          style={{
            backgroundColor: '#111111', borderColor: error ? RED : BORDER,
            borderWidth: 1, borderRadius: 2, paddingHorizontal: 10, paddingVertical: 6,
            color: TEXT_PRIMARY, fontSize: 13, fontFamily: 'monospace',
            textAlign: 'right', minWidth: 72,
          }}
          value={text}
          onChangeText={t => { setText(t); setError(''); }}
          onBlur={handleBlur}
          keyboardType="numbers-and-punctuation"
          returnKeyType="done"
        />
        {suffix && <Text style={{ color: TEXT_MUTED, fontSize: 12 }}>{suffix}</Text>}
      </View>
      {error ? <Text style={{ color: RED, fontSize: 10, marginTop: 2 }}>{error}</Text> : null}
    </View>
  );
}

// ============ 格式选择器 ============
function FormatSelector({ value, onChange }: { value: 'HEX' | 'ASCII'; onChange: (v: 'HEX' | 'ASCII') => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {(['HEX', 'ASCII'] as const).map(f => (
        <Pressable
          key={f} cssInterop={false} onPress={() => onChange(f)}
          style={({ pressed }) => ({
            borderColor: value === f ? CYAN : BORDER, borderWidth: 1, borderRadius: 2,
            paddingHorizontal: 12, paddingVertical: 7, opacity: pressed ? 0.7 : 1,
            backgroundColor: value === f ? `${CYAN}20` : 'transparent',
          })}
        >
          <Text style={{ color: value === f ? CYAN : TEXT_MUTED, fontSize: 12, fontWeight: '700' }}>{f}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ============ 操作符选择器 ============
function OperatorSelector({ value, onChange }: { value: ThresholdOperator; onChange: (v: ThresholdOperator) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
      {OPERATORS.map(op => (
        <Pressable
          key={op} cssInterop={false} onPress={() => onChange(op)}
          style={({ pressed }) => ({
            borderColor: value === op ? CYAN : BORDER, borderWidth: 1, borderRadius: 2,
            paddingHorizontal: 10, paddingVertical: 5, opacity: pressed ? 0.7 : 1,
            backgroundColor: value === op ? `${CYAN}20` : '#111',
          })}
        >
          <Text style={{ color: value === op ? CYAN : TEXT_MUTED, fontSize: 12, fontFamily: 'monospace', fontWeight: '700' }}>
            {op}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// ============ 报警规则编辑 Modal ============
interface RuleEditorProps {
  visible: boolean;
  initial?: DataAlertRule;
  onSave: (rule: Omit<DataAlertRule, 'id'>) => void;
  onClose: () => void;
}
function RuleEditorModal({ visible, initial, onSave, onClose }: RuleEditorProps) {
  const [fieldKey, setFieldKey] = useState(initial?.fieldKey ?? 'T');
  const [operator, setOperator] = useState<ThresholdOperator>(initial?.operator ?? '>');
  const [valueStr, setValueStr] = useState(String(initial?.value ?? ''));
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [error, setError] = useState('');

  // 每次打开都重置
  useEffect(() => {
    if (visible) {
      setFieldKey(initial?.fieldKey ?? 'T');
      setOperator(initial?.operator ?? '>');
      setValueStr(String(initial?.value ?? ''));
      setEnabled(initial?.enabled ?? true);
      setError('');
    }
  }, [visible, initial]);

  const handleSave = useCallback(() => {
    if (!fieldKey.trim()) { setError('字段名不能为空'); return; }
    const numVal = Number(valueStr);
    if (isNaN(numVal)) { setError('阈值必须为有效数字'); return; }
    onSave({ fieldKey: fieldKey.trim().toUpperCase(), operator, value: numVal, enabled });
  }, [fieldKey, operator, valueStr, enabled, onSave]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', padding: 20 }}>
        <View style={{ backgroundColor: '#1A1A1A', borderColor: BORDER, borderWidth: 1, borderRadius: 4, padding: 20, gap: 16 }}>
          {/* 标题 */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: CYAN, fontSize: 14, fontWeight: '800', letterSpacing: 1 }}>
              {initial ? '编辑规则' : '新增报警规则'}
            </Text>
            <Pressable cssInterop={false} onPress={onClose} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Ionicons name="close" size={20} color={TEXT_MUTED} />
            </Pressable>
          </View>

          {/* 字段名 */}
          <View style={{ gap: 6 }}>
            <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>字段名（如 T、D、S、H、V）</Text>
            <TextInput
              style={{
                backgroundColor: '#111', borderColor: BORDER, borderWidth: 1, borderRadius: 2,
                paddingHorizontal: 12, paddingVertical: 8, color: TEXT_PRIMARY,
                fontSize: 14, fontFamily: 'monospace',
              }}
              value={fieldKey}
              onChangeText={v => { setFieldKey(v.toUpperCase()); setError(''); }}
              placeholder="字段名（大写字母）"
              placeholderTextColor={TEXT_MUTED}
              autoCapitalize="characters"
              maxLength={8}
            />
          </View>

          {/* 运算符 */}
          <View style={{ gap: 6 }}>
            <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>触发条件（运算符）</Text>
            <OperatorSelector value={operator} onChange={setOperator} />
          </View>

          {/* 阈值 */}
          <View style={{ gap: 6 }}>
            <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>阈值数值</Text>
            <TextInput
              style={{
                backgroundColor: '#111', borderColor: error && !fieldKey ? RED : BORDER,
                borderWidth: 1, borderRadius: 2, paddingHorizontal: 12, paddingVertical: 8,
                color: TEXT_PRIMARY, fontSize: 14, fontFamily: 'monospace',
              }}
              value={valueStr}
              onChangeText={v => { setValueStr(v); setError(''); }}
              placeholder="输入数字（支持小数）"
              placeholderTextColor={TEXT_MUTED}
              keyboardType="numbers-and-punctuation"
            />
          </View>

          {/* 预览 */}
          <View style={{ backgroundColor: '#0D0D0D', borderColor: `${CYAN}30`, borderWidth: 1, borderRadius: 2, padding: 10 }}>
            <Text style={{ color: TEXT_MUTED, fontSize: 10, marginBottom: 4 }}>规则预览：</Text>
            <Text style={{ color: CYAN, fontSize: 13, fontFamily: 'monospace', fontWeight: '700' }}>
              当 {fieldKey || '?'} {operator} {valueStr || '?'} 时触发报警
            </Text>
          </View>

          {/* 启用开关 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: TEXT_PRIMARY, fontSize: 13 }}>启用此规则</Text>
            <Switch
              value={enabled}
              onValueChange={setEnabled}
              trackColor={{ false: BORDER, true: `${CYAN}60` }}
              thumbColor={enabled ? CYAN : TEXT_MUTED}
            />
          </View>

          {error ? <Text style={{ color: RED, fontSize: 11 }}>{error}</Text> : null}

          {/* 操作按钮 */}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              cssInterop={false} onPress={onClose}
              style={({ pressed }) => ({
                flex: 1, borderColor: BORDER, borderWidth: 1, borderRadius: 2,
                padding: 12, alignItems: 'center', opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: TEXT_MUTED, fontSize: 13, fontWeight: '700' }}>取消</Text>
            </Pressable>
            <Pressable
              cssInterop={false} onPress={handleSave}
              style={({ pressed }) => ({
                flex: 1, backgroundColor: CYAN, borderRadius: 2,
                padding: 12, alignItems: 'center', opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: '#121212', fontSize: 13, fontWeight: '800' }}>保存</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ============ 字段映射编辑 Modal ============
interface MappingEditorProps {
  visible: boolean;
  initial?: FieldMapping;
  onSave: (m: FieldMapping) => void;
  onClose: () => void;
}
function MappingEditorModal({ visible, initial, onSave, onClose }: MappingEditorProps) {
  const [fieldKey, setFieldKey] = useState(initial?.fieldKey ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [unit, setUnit] = useState(initial?.unit ?? '');
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setFieldKey(initial?.fieldKey ?? '');
      setLabel(initial?.label ?? '');
      setUnit(initial?.unit ?? '');
      setError('');
    }
  }, [visible, initial]);

  const handleSave = useCallback(() => {
    if (!fieldKey.trim()) { setError('字段名不能为空'); return; }
    if (!label.trim()) { setError('显示标签不能为空'); return; }
    onSave({ fieldKey: fieldKey.trim().toUpperCase(), label: label.trim(), unit: unit.trim() });
  }, [fieldKey, label, unit, onSave]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', padding: 20 }}>
        <View style={{ backgroundColor: '#1A1A1A', borderColor: BORDER, borderWidth: 1, borderRadius: 4, padding: 20, gap: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: CYAN, fontSize: 14, fontWeight: '800', letterSpacing: 1 }}>
              {initial ? '编辑字段映射' : '新增字段映射'}
            </Text>
            <Pressable cssInterop={false} onPress={onClose} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Ionicons name="close" size={20} color={TEXT_MUTED} />
            </Pressable>
          </View>

          {/* 字段名 */}
          <View style={{ gap: 6 }}>
            <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>原始字段名（数据包中的 Key，如 T）</Text>
            <TextInput
              style={{
                backgroundColor: '#111', borderColor: BORDER, borderWidth: 1, borderRadius: 2,
                paddingHorizontal: 12, paddingVertical: 8, color: TEXT_PRIMARY, fontSize: 14, fontFamily: 'monospace',
              }}
              value={fieldKey}
              onChangeText={v => { setFieldKey(v.toUpperCase()); setError(''); }}
              placeholder="如：T"
              placeholderTextColor={TEXT_MUTED}
              autoCapitalize="characters"
              maxLength={8}
              editable={!initial}
            />
          </View>

          {/* 显示标签 */}
          <View style={{ gap: 6 }}>
            <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>显示标签（界面中显示的名称）</Text>
            <TextInput
              style={{
                backgroundColor: '#111', borderColor: BORDER, borderWidth: 1, borderRadius: 2,
                paddingHorizontal: 12, paddingVertical: 8, color: TEXT_PRIMARY, fontSize: 14,
              }}
              value={label}
              onChangeText={v => { setLabel(v); setError(''); }}
              placeholder="如：温度"
              placeholderTextColor={TEXT_MUTED}
            />
          </View>

          {/* 单位 */}
          <View style={{ gap: 6 }}>
            <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>单位（可留空）</Text>
            <TextInput
              style={{
                backgroundColor: '#111', borderColor: BORDER, borderWidth: 1, borderRadius: 2,
                paddingHorizontal: 12, paddingVertical: 8, color: TEXT_PRIMARY, fontSize: 14,
              }}
              value={unit}
              onChangeText={setUnit}
              placeholder="如：℃"
              placeholderTextColor={TEXT_MUTED}
            />
          </View>

          {error ? <Text style={{ color: RED, fontSize: 11 }}>{error}</Text> : null}

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              cssInterop={false} onPress={onClose}
              style={({ pressed }) => ({
                flex: 1, borderColor: BORDER, borderWidth: 1, borderRadius: 2,
                padding: 12, alignItems: 'center', opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: TEXT_MUTED, fontSize: 13, fontWeight: '700' }}>取消</Text>
            </Pressable>
            <Pressable
              cssInterop={false} onPress={handleSave}
              style={({ pressed }) => ({
                flex: 1, backgroundColor: CYAN, borderRadius: 2,
                padding: 12, alignItems: 'center', opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: '#121212', fontSize: 13, fontWeight: '800' }}>保存</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ============ BLE UUID 配置编辑 Modal ============
interface UuidEditorProps {
  visible: boolean;
  initial: BleUuidConfig;
  onSave: (config: BleUuidConfig) => void;
  onClose: () => void;
}
function UuidEditorModal({ visible, initial, onSave, onClose }: UuidEditorProps) {
  const [serviceUuid, setServiceUuid] = useState(initial.serviceUuid);
  const [rxCharUuid, setRxCharUuid] = useState(initial.rxCharUuid);
  const [txCharUuid, setTxCharUuid] = useState(initial.txCharUuid);

  useEffect(() => {
    if (visible) {
      setServiceUuid(initial.serviceUuid);
      setRxCharUuid(initial.rxCharUuid);
      setTxCharUuid(initial.txCharUuid);
    }
  }, [visible, initial]);

  const handleSave = useCallback(() => {
    onSave({ serviceUuid: serviceUuid.trim(), rxCharUuid: rxCharUuid.trim(), txCharUuid: txCharUuid.trim() });
  }, [serviceUuid, rxCharUuid, txCharUuid, onSave]);

  const handleReset = useCallback(() => {
    setServiceUuid(DEFAULT_BLE_UUID.serviceUuid);
    setRxCharUuid(DEFAULT_BLE_UUID.rxCharUuid);
    setTxCharUuid(DEFAULT_BLE_UUID.txCharUuid);
  }, []);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 20 }}>
        <View style={{ backgroundColor: '#1A1A1A', borderColor: BORDER, borderWidth: 1, borderRadius: 4, padding: 20, gap: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: CYAN, fontSize: 14, fontWeight: '800' }}>BLE UUID 配置</Text>
            <Pressable cssInterop={false} onPress={onClose} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Ionicons name="close" size={20} color={TEXT_MUTED} />
            </Pressable>
          </View>

          {[
            { label: 'Service UUID', value: serviceUuid, onChange: setServiceUuid },
            { label: 'RX 特征值 UUID（Notify）', value: rxCharUuid, onChange: setRxCharUuid },
            { label: 'TX 特征值 UUID（Write）', value: txCharUuid, onChange: setTxCharUuid },
          ].map(({ label, value, onChange }) => (
            <View key={label} style={{ gap: 6 }}>
              <Text style={{ color: TEXT_SECONDARY, fontSize: 11 }}>{label}</Text>
              <TextInput
                style={{
                  backgroundColor: '#111', borderColor: BORDER, borderWidth: 1,
                  borderRadius: 2, paddingHorizontal: 10, paddingVertical: 8,
                  color: CYAN, fontSize: 11, fontFamily: 'monospace',
                }}
                value={value}
                onChangeText={onChange}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                placeholderTextColor={TEXT_MUTED}
              />
            </View>
          ))}

          {/* 重置按钮 */}
          <Pressable
            cssInterop={false} onPress={handleReset}
            style={({ pressed }) => ({
              alignItems: 'center', paddingVertical: 8,
              borderColor: BORDER, borderWidth: 1, borderRadius: 2, opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: TEXT_SECONDARY, fontSize: 12 }}>恢复默认（Nordic UART Service）</Text>
          </Pressable>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              cssInterop={false} onPress={onClose}
              style={({ pressed }) => ({
                flex: 1, borderColor: BORDER, borderWidth: 1, borderRadius: 2,
                padding: 12, alignItems: 'center', opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: TEXT_MUTED, fontSize: 13, fontWeight: '700' }}>取消</Text>
            </Pressable>
            <Pressable
              cssInterop={false} onPress={handleSave}
              style={({ pressed }) => ({
                flex: 1, backgroundColor: CYAN, borderRadius: 2,
                padding: 12, alignItems: 'center', opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: '#121212', fontSize: 13, fontWeight: '800' }}>保存</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ============ 主页面 ============
export default function SettingsScreen() {
  const {
    settings, updateSettings,
    addAlertRule, updateAlertRule, deleteAlertRule,
    addFieldMapping, updateFieldMapping, deleteFieldMapping,
    bleReady, bleError,
  } = useBle();

  const { connectedSerial, serialError } = useSerial();

  const [saved, setSaved] = useState(false);
  // 报警规则 Modal
  const [ruleModalVisible, setRuleModalVisible] = useState(false);
  const [editingRule, setEditingRule] = useState<DataAlertRule | undefined>();
  // 字段映射 Modal
  const [mappingModalVisible, setMappingModalVisible] = useState(false);
  const [editingMapping, setEditingMapping] = useState<FieldMapping | undefined>();
  // UUID 配置 Modal
  const [uuidModalVisible, setUuidModalVisible] = useState(false);
  // 串口参数展开
  const [serialExpanded, setSerialExpanded] = useState(false);

  const showSaved = useCallback(() => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }, []);

  const handleChange = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    updateSettings({ [key]: value });
    showSaved();
  }, [updateSettings, showSaved]);

  // ---------- 报警规则操作 ----------
  const openAddRule = useCallback(() => {
    setEditingRule(undefined);
    setRuleModalVisible(true);
  }, []);

  const openEditRule = useCallback((rule: DataAlertRule) => {
    setEditingRule(rule);
    setRuleModalVisible(true);
  }, []);

  const handleSaveRule = useCallback((ruleData: Omit<DataAlertRule, 'id'>) => {
    if (editingRule) {
      updateAlertRule(editingRule.id, ruleData);
    } else {
      addAlertRule(ruleData);
    }
    setRuleModalVisible(false);
    showSaved();
  }, [editingRule, updateAlertRule, addAlertRule, showSaved]);

  // ---------- 字段映射操作 ----------
  const openAddMapping = useCallback(() => {
    setEditingMapping(undefined);
    setMappingModalVisible(true);
  }, []);

  const openEditMapping = useCallback((m: FieldMapping) => {
    setEditingMapping(m);
    setMappingModalVisible(true);
  }, []);

  const handleSaveMapping = useCallback((m: FieldMapping) => {
    if (editingMapping) {
      updateFieldMapping(editingMapping.fieldKey, { label: m.label, unit: m.unit });
    } else {
      addFieldMapping(m);
    }
    setMappingModalVisible(false);
    showSaved();
  }, [editingMapping, updateFieldMapping, addFieldMapping, showSaved]);

  // ---------- BLE UUID 操作 ----------
  const handleSaveUuid = useCallback((config: BleUuidConfig) => {
    updateSettings({ bleUuid: config });
    setUuidModalVisible(false);
    showSaved();
  }, [updateSettings, showSaved]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: DARK_BG }}>
      {/* 标题栏 */}
      <View
        style={{
          paddingHorizontal: 16, paddingVertical: 12,
          borderBottomColor: BORDER, borderBottomWidth: 1,
          backgroundColor: '#0F0F0F',
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <Text style={{ color: CYAN, fontSize: 16, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1 }}>
          SETTINGS
        </Text>
        {saved && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="checkmark-circle" size={14} color={GREEN} />
            <Text style={{ color: GREEN, fontSize: 11 }}>已保存</Text>
          </View>
        )}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} contentInsetAdjustmentBehavior="automatic">

        {/* ======= BLE 设备配置 ======= */}
        <SectionHeader title="BLE 设备配置" />
        <View style={{ backgroundColor: CARD_BG, borderTopColor: BORDER, borderBottomColor: BORDER, borderTopWidth: 1, borderBottomWidth: 1 }}>
          {/* 蓝牙状态提示 */}
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            paddingHorizontal: 16, paddingVertical: 10, borderBottomColor: '#1E1E1E', borderBottomWidth: 1,
          }}>
            <View style={{
              width: 8, height: 8, borderRadius: 4,
              backgroundColor: bleReady ? '#00E676' : '#FF3333',
            }} />
            <Text style={{ color: bleReady ? '#00E676' : '#FF3333', fontSize: 11 }}>
              {bleReady ? '蓝牙适配器已就绪' : (bleError ?? '蓝牙未就绪')}
            </Text>
          </View>

          {/* UUID 配置行 */}
          <Pressable
            cssInterop={false} onPress={() => setUuidModalVisible(true)}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingHorizontal: 16, paddingVertical: 12, opacity: pressed ? 0.7 : 1,
              borderBottomColor: '#1E1E1E', borderBottomWidth: 1,
            })}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ color: TEXT_PRIMARY, fontSize: 13, fontWeight: '600' }}>Service / Characteristic UUID</Text>
              <Text style={{ color: TEXT_MUTED, fontSize: 10, fontFamily: 'monospace' }} numberOfLines={1}>
                SVC: {settings.bleUuid?.serviceUuid ?? DEFAULT_BLE_UUID.serviceUuid}
              </Text>
              <Text style={{ color: TEXT_MUTED, fontSize: 10, fontFamily: 'monospace' }} numberOfLines={1}>
                RX:  {settings.bleUuid?.rxCharUuid ?? DEFAULT_BLE_UUID.rxCharUuid}
              </Text>
              <Text style={{ color: TEXT_MUTED, fontSize: 10, fontFamily: 'monospace' }} numberOfLines={1}>
                TX:  {settings.bleUuid?.txCharUuid ?? DEFAULT_BLE_UUID.txCharUuid}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={TEXT_MUTED} />
          </Pressable>

          {/* 协议说明 */}
          <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
            <Text style={{ color: TEXT_MUTED, fontSize: 10, lineHeight: 16 }}>
              默认使用 Nordic UART Service（NUS）协议。如需连接其他 BLE 设备，请修改 UUID 为设备对应值。
            </Text>
          </View>
        </View>

        {/* ======= 图传 / 热相 UUID 配置 ======= */}
        <SectionHeader title="图传 / 热相 UUID" />
        <View style={{ backgroundColor: CARD_BG, borderTopColor: BORDER, borderBottomColor: BORDER, borderTopWidth: 1, borderBottomWidth: 1 }}>
          {/* 图传特征值 UUID */}
          <SettingRow label="图传特征值 UUID" description="接收分包图像数据的 BLE Notify 特征值">
            <TextInput
              value={settings.imgThermalUuid?.imageCharUuid ?? DEFAULT_IMG_THERMAL_UUID.imageCharUuid}
              onChangeText={v => {
                updateSettings({ imgThermalUuid: { ...(settings.imgThermalUuid ?? DEFAULT_IMG_THERMAL_UUID), imageCharUuid: v } });
                showSaved();
              }}
              placeholder={DEFAULT_IMG_THERMAL_UUID.imageCharUuid}
              placeholderTextColor={TEXT_MUTED}
              autoCapitalize="characters"
              style={{
                color: CYAN, fontSize: 10, fontFamily: 'monospace',
                backgroundColor: '#111', paddingHorizontal: 8, paddingVertical: 4,
                borderWidth: 1, borderColor: BORDER, borderRadius: 2, width: 260,
              }}
            />
          </SettingRow>

          {/* 热相特征值 UUID */}
          <SettingRow label="热相特征值 UUID" description="接收温度矩阵数据的 BLE Notify 特征值">
            <TextInput
              value={settings.imgThermalUuid?.thermalCharUuid ?? DEFAULT_IMG_THERMAL_UUID.thermalCharUuid}
              onChangeText={v => {
                updateSettings({ imgThermalUuid: { ...(settings.imgThermalUuid ?? DEFAULT_IMG_THERMAL_UUID), thermalCharUuid: v } });
                showSaved();
              }}
              placeholder={DEFAULT_IMG_THERMAL_UUID.thermalCharUuid}
              placeholderTextColor={TEXT_MUTED}
              autoCapitalize="characters"
              style={{
                color: ORANGE, fontSize: 10, fontFamily: 'monospace',
                backgroundColor: '#111', paddingHorizontal: 8, paddingVertical: 4,
                borderWidth: 1, borderColor: BORDER, borderRadius: 2, width: 260,
              }}
            />
          </SettingRow>

          {/* 重置默认 */}
          <Pressable
            cssInterop={false}
            onPress={() => { updateSettings({ imgThermalUuid: DEFAULT_IMG_THERMAL_UUID }); showSaved(); }}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', gap: 6,
              paddingHorizontal: 16, paddingVertical: 10,
              borderTopColor: '#1E1E1E', borderTopWidth: 1,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name="refresh" size={13} color={TEXT_MUTED} />
            <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>重置为默认 UUID</Text>
          </Pressable>
        </View>
        <SectionHeader title="USB 串口配置" />
        <View style={{ backgroundColor: CARD_BG, borderTopColor: BORDER, borderBottomColor: BORDER, borderTopWidth: 1, borderBottomWidth: 1 }}>
          {/* 串口连接状态 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderBottomColor: '#1E1E1E', borderBottomWidth: 1 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: connectedSerial ? '#00E676' : (serialError ? '#FF3333' : '#444444') }} />
            <Text style={{ color: connectedSerial ? '#00E676' : (serialError ? '#FF3333' : TEXT_MUTED), fontSize: 11 }}>
              {connectedSerial
                ? `已连接: ${connectedSerial.displayName}`
                : (serialError ?? '未连接串口设备（仅 Android 支持）')}
            </Text>
          </View>

          {/* 波特率 */}
          <SettingRow label="波特率" description="数据传输速率，需与设备端一致">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: 6 }}>
              {BAUD_RATES.map(rate => {
                const active = (settings.serialConfig?.baudRate ?? DEFAULT_SERIAL_CONFIG.baudRate) === rate;
                return (
                  <Pressable
                    key={rate} cssInterop={false}
                    onPress={() => {
                      updateSettings({ serialConfig: { ...(settings.serialConfig ?? DEFAULT_SERIAL_CONFIG), baudRate: rate } });
                      showSaved();
                    }}
                    style={({ pressed }) => ({
                      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 2, borderWidth: 1,
                      borderColor: active ? ORANGE : BORDER,
                      backgroundColor: active ? `${ORANGE}20` : 'transparent',
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ color: active ? ORANGE : TEXT_MUTED, fontSize: 11, fontWeight: active ? '800' : '400', fontFamily: 'monospace' }}>
                      {rate}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </SettingRow>

          {/* 数据位 */}
          <SettingRow label="数据位" description="每帧数据的比特数（通常为 8）">
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {[5, 6, 7, 8].map(bits => {
                const active = (settings.serialConfig?.dataBits ?? DEFAULT_SERIAL_CONFIG.dataBits) === bits;
                return (
                  <Pressable
                    key={bits} cssInterop={false}
                    onPress={() => {
                      updateSettings({ serialConfig: { ...(settings.serialConfig ?? DEFAULT_SERIAL_CONFIG), dataBits: bits as 5 | 6 | 7 | 8 } });
                      showSaved();
                    }}
                    style={({ pressed }) => ({
                      paddingHorizontal: 12, paddingVertical: 5, borderRadius: 2, borderWidth: 1,
                      borderColor: active ? ORANGE : BORDER,
                      backgroundColor: active ? `${ORANGE}20` : 'transparent',
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ color: active ? ORANGE : TEXT_MUTED, fontSize: 12, fontWeight: active ? '800' : '400' }}>{bits}</Text>
                  </Pressable>
                );
              })}
            </View>
          </SettingRow>

          {/* 停止位 */}
          <SettingRow label="停止位" description="帧尾停止位数（通常为 1）">
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {([1, 2] as const).map(bits => {
                const active = (settings.serialConfig?.stopBits ?? DEFAULT_SERIAL_CONFIG.stopBits) === bits;
                return (
                  <Pressable
                    key={bits} cssInterop={false}
                    onPress={() => {
                      updateSettings({ serialConfig: { ...(settings.serialConfig ?? DEFAULT_SERIAL_CONFIG), stopBits: bits } });
                      showSaved();
                    }}
                    style={({ pressed }) => ({
                      paddingHorizontal: 16, paddingVertical: 5, borderRadius: 2, borderWidth: 1,
                      borderColor: active ? ORANGE : BORDER,
                      backgroundColor: active ? `${ORANGE}20` : 'transparent',
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ color: active ? ORANGE : TEXT_MUTED, fontSize: 12, fontWeight: active ? '800' : '400' }}>{bits}</Text>
                  </Pressable>
                );
              })}
            </View>
          </SettingRow>

          {/* 校验位 */}
          <SettingRow label="校验位" description="奇偶校验方式（通常为 None）">
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {([0, 1, 2, 3, 4] as const).map(parity => {
                const active = (settings.serialConfig?.parity ?? DEFAULT_SERIAL_CONFIG.parity) === parity;
                return (
                  <Pressable
                    key={parity} cssInterop={false}
                    onPress={() => {
                      updateSettings({ serialConfig: { ...(settings.serialConfig ?? DEFAULT_SERIAL_CONFIG), parity } });
                      showSaved();
                    }}
                    style={({ pressed }) => ({
                      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 2, borderWidth: 1,
                      borderColor: active ? ORANGE : BORDER,
                      backgroundColor: active ? `${ORANGE}20` : 'transparent',
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ color: active ? ORANGE : TEXT_MUTED, fontSize: 11, fontWeight: active ? '800' : '400' }}>
                      {PARITY_LABELS[parity]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </SettingRow>

          {/* 当前串口参数摘要 */}
          <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderTopColor: '#1E1E1E', borderTopWidth: 1 }}>
            <Text style={{ color: TEXT_MUTED, fontSize: 10, fontFamily: 'monospace' }}>
              当前: {settings.serialConfig?.baudRate ?? DEFAULT_SERIAL_CONFIG.baudRate} baud  ·  {settings.serialConfig?.dataBits ?? DEFAULT_SERIAL_CONFIG.dataBits}-{PARITY_LABELS[settings.serialConfig?.parity ?? DEFAULT_SERIAL_CONFIG.parity]}-{settings.serialConfig?.stopBits ?? DEFAULT_SERIAL_CONFIG.stopBits}
            </Text>
            <Text style={{ color: TEXT_MUTED, fontSize: 10, marginTop: 3 }}>
              参数更改后，下次连接设备时生效。
            </Text>
          </View>
        </View>

        {/* ======= 预警阈值设置 ======= */}
        <SectionHeader title="基础预警阈值" />
        <View style={{ backgroundColor: CARD_BG, borderTopColor: BORDER, borderBottomColor: BORDER, borderTopWidth: 1, borderBottomWidth: 1 }}>
          <SettingRow
            label="RSSI 信号强度阈值"
            description={`低于此值将触发信号预警\n当前: ${settings.rssiThreshold} dBm`}
          >
            <NumberInput
              value={settings.rssiThreshold}
              onChange={v => handleChange('rssiThreshold', v)}
              min={-100} max={-30} suffix="dBm"
            />
          </SettingRow>
          <SettingRow
            label="数据超时时长"
            description={`超过此时间未收到数据触发预警\n当前: ${settings.dataTimeoutSeconds} 秒`}
          >
            <NumberInput
              value={settings.dataTimeoutSeconds}
              onChange={v => handleChange('dataTimeoutSeconds', v)}
              min={3} max={120} suffix="秒"
            />
          </SettingRow>
        </View>

        {/* ======= 数据内容报警规则 ======= */}
        <SectionHeader title="数据内容报警规则" />
        <View style={{ backgroundColor: CARD_BG, borderTopColor: BORDER, borderBottomColor: BORDER, borderTopWidth: 1, borderBottomWidth: 1 }}>
          {/* 说明 */}
          <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderBottomColor: '#1E1E1E', borderBottomWidth: 1 }}>
            <Text style={{ color: TEXT_MUTED, fontSize: 11, lineHeight: 17 }}>
              针对解析字段设置阈值报警规则。当收到的数据包含对应字段（如 T:25.3）且满足条件时，触发「数据报警」预警。
            </Text>
          </View>

          {/* 规则列表 */}
          {settings.dataAlertRules.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 20, gap: 6 }}>
              <Ionicons name="warning-outline" size={24} color={TEXT_MUTED} />
              <Text style={{ color: TEXT_MUTED, fontSize: 12 }}>暂无报警规则</Text>
              <Text style={{ color: TEXT_MUTED, fontSize: 11 }}>点击下方「+」添加</Text>
            </View>
          ) : (
            settings.dataAlertRules.map(rule => (
              <View
                key={rule.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 16, paddingVertical: 12,
                  borderBottomColor: '#1E1E1E', borderBottomWidth: 1,
                  gap: 10,
                }}
              >
                {/* 启用开关 */}
                <Switch
                  value={rule.enabled}
                  onValueChange={v => { updateAlertRule(rule.id, { enabled: v }); showSaved(); }}
                  trackColor={{ false: BORDER, true: `${CYAN}60` }}
                  thumbColor={rule.enabled ? CYAN : TEXT_MUTED}
                  style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                />

                {/* 规则内容 */}
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: rule.enabled ? TEXT_PRIMARY : TEXT_MUTED, fontSize: 13, fontFamily: 'monospace', fontWeight: '700' }}>
                    {rule.fieldKey}
                    <Text style={{ color: CYAN }}> {rule.operator} </Text>
                    <Text style={{ color: TEXT_PRIMARY }}>{rule.value}</Text>
                  </Text>
                  <Text style={{ color: TEXT_MUTED, fontSize: 10 }}>
                    字段 {rule.fieldKey} 满足条件时触发
                  </Text>
                </View>

                {/* 编辑按钮 */}
                <Pressable
                  cssInterop={false} onPress={() => openEditRule(rule)}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 6 })}
                >
                  <Ionicons name="create-outline" size={16} color={CYAN} />
                </Pressable>
                {/* 删除按钮 */}
                <Pressable
                  cssInterop={false} onPress={() => { deleteAlertRule(rule.id); showSaved(); }}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 6 })}
                >
                  <Ionicons name="trash-outline" size={16} color={RED} />
                </Pressable>
              </View>
            ))
          )}

          {/* 新增按钮 */}
          <Pressable
            cssInterop={false} onPress={openAddRule}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              gap: 6, padding: 14, opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name="add-circle-outline" size={16} color={CYAN} />
            <Text style={{ color: CYAN, fontSize: 12, fontWeight: '700' }}>新增报警规则</Text>
          </Pressable>
        </View>

        {/* ======= 字段映射配置 ======= */}
        <SectionHeader title="字段映射配置" />
        <View style={{ backgroundColor: CARD_BG, borderTopColor: BORDER, borderBottomColor: BORDER, borderTopWidth: 1, borderBottomWidth: 1 }}>
          {/* 说明 */}
          <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderBottomColor: '#1E1E1E', borderBottomWidth: 1 }}>
            <Text style={{ color: TEXT_MUTED, fontSize: 11, lineHeight: 17 }}>
              为数据包中的原始字段名配置显示标签和单位，使解析视图和趋势图更直观（如将 T 显示为「温度 ℃」）。
            </Text>
          </View>

          {/* 映射列表 */}
          {settings.fieldMappings.map(m => (
            <View
              key={m.fieldKey}
              style={{
                flexDirection: 'row', alignItems: 'center',
                paddingHorizontal: 16, paddingVertical: 12,
                borderBottomColor: '#1E1E1E', borderBottomWidth: 1,
                gap: 12,
              }}
            >
              {/* 字段 Key */}
              <View style={{
                borderColor: `${CYAN}60`, borderWidth: 1, borderRadius: 2,
                paddingHorizontal: 8, paddingVertical: 4, minWidth: 32, alignItems: 'center',
                backgroundColor: `${CYAN}10`,
              }}>
                <Text style={{ color: CYAN, fontSize: 12, fontWeight: '800', fontFamily: 'monospace' }}>
                  {m.fieldKey}
                </Text>
              </View>

              {/* 映射内容 */}
              <View style={{ flex: 1, gap: 1 }}>
                <Text style={{ color: TEXT_PRIMARY, fontSize: 13, fontWeight: '600' }}>
                  {m.label}
                </Text>
                <Text style={{ color: TEXT_MUTED, fontSize: 10, fontFamily: 'monospace' }}>
                  单位: {m.unit || '—'}
                </Text>
              </View>

              {/* 编辑 */}
              <Pressable
                cssInterop={false} onPress={() => openEditMapping(m)}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 6 })}
              >
                <Ionicons name="create-outline" size={16} color={CYAN} />
              </Pressable>
              {/* 删除 */}
              <Pressable
                cssInterop={false} onPress={() => { deleteFieldMapping(m.fieldKey); showSaved(); }}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 6 })}
              >
                <Ionicons name="trash-outline" size={16} color={RED} />
              </Pressable>
            </View>
          ))}

          {settings.fieldMappings.length === 0 && (
            <View style={{ alignItems: 'center', paddingVertical: 20, gap: 6 }}>
              <Text style={{ color: TEXT_MUTED, fontSize: 12 }}>暂无字段映射配置</Text>
            </View>
          )}

          {/* 新增按钮 */}
          <Pressable
            cssInterop={false} onPress={openAddMapping}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              gap: 6, padding: 14, opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name="add-circle-outline" size={16} color={CYAN} />
            <Text style={{ color: CYAN, fontSize: 12, fontWeight: '700' }}>新增字段映射</Text>
          </Pressable>
        </View>

        {/* ======= 信号强度参考 ======= */}
        <SectionHeader title="信号强度参考" />
        <View style={{ backgroundColor: CARD_BG, borderTopColor: BORDER, borderBottomColor: BORDER, borderTopWidth: 1, borderBottomWidth: 1 }}>
          {[
            { range: '≥ -50 dBm', label: '极强', color: '#00E5FF' },
            { range: '-50 ~ -60 dBm', label: '良好', color: '#00B4CC' },
            { range: '-60 ~ -70 dBm', label: '一般', color: '#FFB300' },
            { range: '-70 ~ -80 dBm', label: '较弱', color: '#FF6B00' },
            { range: '< -80 dBm', label: '极弱（建议预警）', color: '#FF3333' },
          ].map(({ range, label, color }) => (
            <View
              key={range}
              style={{
                flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                paddingVertical: 9, paddingHorizontal: 16,
                borderBottomColor: '#1E1E1E', borderBottomWidth: 1,
              }}
            >
              <Text style={{ color: TEXT_SECONDARY, fontSize: 12, fontFamily: 'monospace' }}>{range}</Text>
              <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{label}</Text>
            </View>
          ))}
        </View>

        {/* ======= 显示设置 ======= */}
        <SectionHeader title="显示设置" />
        <View style={{ backgroundColor: CARD_BG, borderTopColor: BORDER, borderBottomColor: BORDER, borderTopWidth: 1, borderBottomWidth: 1 }}>
          <SettingRow label="默认数据格式" description="数据监测页默认显示格式">
            <FormatSelector value={settings.defaultFormat} onChange={v => handleChange('defaultFormat', v)} />
          </SettingRow>
        </View>

        {/* ======= 日志设置 ======= */}
        <SectionHeader title="日志设置" />
        <View style={{ backgroundColor: CARD_BG, borderTopColor: BORDER, borderBottomColor: BORDER, borderTopWidth: 1, borderBottomWidth: 1 }}>
          <SettingRow label="自动保存日志" description="记录所有数据收发日志（最多1000条）">
            <Switch
              value={settings.saveLog}
              onValueChange={v => handleChange('saveLog', v)}
              trackColor={{ false: BORDER, true: `${CYAN}60` }}
              thumbColor={settings.saveLog ? CYAN : TEXT_MUTED}
            />
          </SettingRow>
        </View>

        {/* ======= 关于 ======= */}
        <SectionHeader title="关于" />
        <View style={{ backgroundColor: CARD_BG, borderTopColor: BORDER, borderBottomColor: BORDER, borderTopWidth: 1, borderBottomWidth: 1 }}>
          <View style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 8 }}>
            {[
              { label: '应用名称', value: '蓝牙数据监测预警', color: TEXT_SECONDARY },
              { label: '版本', value: '2.0.0', color: TEXT_SECONDARY },
              { label: '模式', value: '真实 BLE 模式', color: CYAN },
              { label: '蓝牙协议', value: 'BLE (GATT)', color: TEXT_SECONDARY },
              { label: '报警规则', value: `${settings.dataAlertRules.length} 条`, color: settings.dataAlertRules.length > 0 ? CYAN : TEXT_MUTED },
              { label: '字段映射', value: `${settings.fieldMappings.length} 项`, color: settings.fieldMappings.length > 0 ? CYAN : TEXT_MUTED },
            ].map(item => (
              <View key={item.label} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: TEXT_MUTED, fontSize: 12 }}>{item.label}</Text>
                <Text style={{ color: item.color, fontSize: 12, fontFamily: 'monospace' }}>{item.value}</Text>
              </View>
            ))}
          </View>
        </View>

      </ScrollView>

      {/* 报警规则编辑 Modal */}
      <RuleEditorModal
        visible={ruleModalVisible}
        initial={editingRule}
        onSave={handleSaveRule}
        onClose={() => setRuleModalVisible(false)}
      />

      {/* 字段映射编辑 Modal */}
      <MappingEditorModal
        visible={mappingModalVisible}
        initial={editingMapping}
        onSave={handleSaveMapping}
        onClose={() => setMappingModalVisible(false)}
      />

      {/* BLE UUID 配置 Modal */}
      <UuidEditorModal
        visible={uuidModalVisible}
        initial={settings.bleUuid ?? DEFAULT_BLE_UUID}
        onSave={handleSaveUuid}
        onClose={() => setUuidModalVisible(false)}
      />
    </SafeAreaView>
  );
}
