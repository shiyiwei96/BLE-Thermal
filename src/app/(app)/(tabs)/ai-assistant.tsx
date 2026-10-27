import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBle } from '@/lib/bleContext';
import { Ionicons } from '@expo/vector-icons';

// ⚠️ 替换为你电脑的局域网 IP
const PC_IP = '192.168.43.16';
const API_URL = `http://${PC_IP}:11434/api/generate`;
const MODEL_NAME = 'deepseek-r1:1.5b_m'; // 确保这是 ollama list 里的名字

export default function AIAssistantScreen() {
  const { connectedDevice, latestThermalFrame, thermalAiReport} = useBle();
  
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'ai'; text: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);

  // 1. 核心：把 App 的实时状态喂给大模型
  const generateContextPrompt = (userQuestion: string) => {
  let context = `你是一个冷峻、专业的工业蓝牙监测AI。请直接回答用户问题，不要输出任何思考过程。
  【规则】
  1. 环境温度在 15℃ ~ 35℃ 之间属于正常。
  2. 超过 45℃ 才算设备发热异常。
  3. 回答必须简短，不超过3句话，不要发散思考。

  【实时状态】
  - 蓝牙设备: ${connectedDevice ? (connectedDevice.name) : '未连接'}
  `;

  if (latestThermalFrame) {
    context += `- 热成像数据: 最高 ${latestThermalFrame.maxTemp.toFixed(1)}℃, 最低 ${latestThermalFrame.minTemp.toFixed(1)}℃, 平均 ${latestThermalFrame.avgTemp.toFixed(1)}℃\n`;
  }

  // 👇 新增：把刚才导出的 AI 报告塞进去！
  if (thermalAiReport) {
    context += `- 视觉识别结果: ${thermalAiReport}\n`;
  }

  context += `\n用户问: ${userQuestion}\n助理答:`;
  return context;
};

  // 2. 发送消息并处理流式响应
const sendMessage = async (overrideText?: string) => {
  const userText = overrideText || input;
  if (!userText.trim() || loading) return;

  if (!overrideText) setInput('');
  setMessages(prev => [...prev, { role: 'user', text: userText }]);
  setMessages(prev => [...prev, { role: 'ai', text: '思考中...' }]); // 占位
  setLoading(true);

  try {
    // 增加 15 秒超时机制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL_NAME,
        prompt: generateContextPrompt(userText),
        stream: false, // 👈 改成 false，一次性返回
        signal: controller.signal, // 👈 绑定超时
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();
    
    setMessages(prev => {
      const newMsgs = [...prev];
      // 直接替换最后一条 AI 的消息
      newMsgs[newMsgs.length - 1].text = data.response || '模型没有返回内容';
      return newMsgs;
    });

  } catch (error: any) {
    if (error.name === 'AbortError') {
       // 处理超时
       setMessages(prev => [...prev, { role: 'ai', text: '❌ 电脑端响应超时。可能是模型正在加载，请重试。' }]);
    } else {
       // 处理网络断开
       setMessages(prev => [...prev, { role: 'ai', text: '❌ 无法连接电脑端，请确保在同一个 WiFi 且 Ollama 在运行。' }]);
    }
  } finally {
    setLoading(false);
  }
};

  // 快捷提问指令
  const quickPrompts = [
    '帮我分析当前热相图的异常情况',
    '用一句话总结当前设备状态',
    '请结合当前的温度和视觉识别结果，帮我生成一份简短的巡检报告',
    '最高温超过了 35 度吗？如果超了建议我怎么做？'
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#121212' }}>
      {/* 顶部标题 */}
      <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: '#333', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Ionicons name="hardware-chip" size={24} color="#00E5FF" />
        <View>
          <Text style={{ color: '#00E5FF', fontSize: 18, fontWeight: 'bold' }}>AI 数据副驾驶</Text>
          <Text style={{ color: '#666', fontSize: 10 }}>DeepSeek-R1 本地驱动 · 已接入实时数据</Text>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
        >
          {/* 欢迎语或快捷指令 */}
          {messages.length === 0 && (
            <View style={{ marginTop: 20, gap: 10 }}>
              <Text style={{ color: '#888', textAlign: 'center', marginBottom: 10 }}>试试快捷指令：</Text>
              {quickPrompts.map((prompt, idx) => (
                <Pressable
                  key={idx}
                  onPress={() => sendMessage(prompt)}
                  style={{ backgroundColor: '#1A1A1A', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#333' }}
                >
                  <Text style={{ color: '#00E5FF', fontSize: 13 }}>💡 {prompt}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {/* 聊天列表 */}
          {messages.map((msg, idx) => (
            <View
              key={idx}
              style={{
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                backgroundColor: msg.role === 'user' ? '#00E5FF20' : '#1A1A1A',
                borderWidth: 1,
                borderColor: msg.role === 'user' ? '#00E5FF' : '#333',
                padding: 12, borderRadius: 8, maxWidth: '85%'
              }}
            >
              <Text style={{ color: msg.role === 'user' ? '#00E5FF' : '#E0E0E0', fontSize: 14, lineHeight: 20 }}>
                {msg.text}
                {/* 如果正在加载且是最后一条 AI 消息，显示光标 */}
                {loading && idx === messages.length - 1 && msg.role === 'ai' ? ' █' : ''}
              </Text>
            </View>
          ))}
        </ScrollView>

        {/* 底部输入框 */}
        <View style={{ flexDirection: 'row', padding: 16, borderTopWidth: 1, borderTopColor: '#333', gap: 8 }}>
          <TextInput
            style={{
              flex: 1, backgroundColor: '#1A1A1A', color: '#fff',
              paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#333',
              maxHeight: 100
            }}
            placeholder="问点什么..."
            placeholderTextColor="#666"
            value={input}
            onChangeText={setInput}
            multiline
            editable={!loading}
          />
          <Pressable
            onPress={() => sendMessage()}
            disabled={loading}
            style={{
              backgroundColor: loading ? '#333' : '#00E5FF',
              justifyContent: 'center', paddingHorizontal: 16, borderRadius: 8
            }}
          >
            {loading ? <ActivityIndicator color="#666" /> : <Text style={{ color: '#000', fontWeight: 'bold' }}>发送</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}