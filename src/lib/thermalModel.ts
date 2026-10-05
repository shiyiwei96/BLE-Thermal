import { loadTensorflowModel, type TfliteModel } from 'react-native-fast-tflite';

// 模型单例
let model: TfliteModel | null = null;
let loading: Promise<TfliteModel> | null = null;

/**
 * 加载 TFLite 模型（只加载一次）
 */
export async function loadModel(): Promise<TfliteModel> {
  if (model) return model;
  if (loading) return loading;

  loading = (async () => {
    console.log('[TFLite] 开始加载模型...');
    const m = await loadTensorflowModel(
      require('@/assets/models/gesture.tflite'),
      []   // 👈 空数组 = 默认 CPU delegate
    );
    console.log('[TFLite] 模型加载完成, 输入:', m.inputs[0]?.shape, '输出:', m.outputs[0]?.shape);
    model = m;
    loading = null;
    return m;
  })();

  return loading;
}

/**
 * 热相温度矩阵推理
 */
export async function runThermalInference(tempData: number[]): Promise<{
  label: number;
  confidence: number;
  probs: number[];
}> {
  const m = await loadModel();

  const TRAIN_MIN = 23.0;
  const TRAIN_MAX = 37.9;
  const range = TRAIN_MAX - TRAIN_MIN;

  // 输入：Float32Array(768) → ArrayBuffer
  const input = new Float32Array(768);
  for (let i = 0; i < 768; i++) {
    let v = (tempData[i] - TRAIN_MIN) / range;
    if (v < 0) v = 0;
    if (v > 1) v = 1;
    input[i] = v;
  }

  // 推理：输入必须是 ArrayBuffer[]
  const outputs = await m.run([input.buffer]);

  // 输出：ArrayBuffer[] → Float32Array
  const probs = Array.from(new Float32Array(outputs[0]));

  let label = 0;
  let maxProb = probs[0];
  for (let i = 1; i < probs.length; i++) {
    if (probs[i] > maxProb) {
      maxProb = probs[i];
      label = i;
    }
  }

  return { label, confidence: maxProb, probs };
}