// ============ 通道类型 ============
export type ConnectionChannel = 'BLE' | 'SERIAL';

// ============ 串口设备信息 ============
export interface SerialDevice {
  deviceId: number;
  vendorId: number;
  productId: number;
  /** 用于展示的名称（vendorId:productId 格式，无法获取字符串名） */
  displayName: string;
  isConnected: boolean;
}

// 串口奇偶校验
export type SerialParity = 0 | 1 | 2 | 3 | 4; // None=0 Odd=1 Even=2 Mark=3 Space=4

// 串口配置
export interface SerialConfig {
  baudRate: number;    // 波特率，默认 9600
  dataBits: number;   // 数据位 5/6/7/8，默认 8
  stopBits: number;   // 停止位 1/2，默认 1
  parity: SerialParity; // 校验位，默认 0（None）
}

// 常用波特率列表
export const BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

// 默认串口配置（8N1）
export const DEFAULT_SERIAL_CONFIG: SerialConfig = {
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: 0,
};

// 校验位显示名称
export const PARITY_LABELS: Record<SerialParity, string> = {
  0: '无 (None)',
  1: '奇 (Odd)',
  2: '偶 (Even)',
  3: '标记 (Mark)',
  4: '空格 (Space)',
};

// 蓝牙设备信息
export interface BleDevice {
  id: string;
  name: string | null;
  rssi: number;
  isConnected: boolean;
  address: string; // iOS: UUID, Android: MAC 地址
}

// 数据方向
export type DataDirection = 'RX' | 'TX';

// 数据日志条目
export interface DataLogEntry {
  id: string;
  timestamp: number;
  direction: DataDirection;
  rawData: number[]; // 字节数组
  deviceId: string;
  channel?: ConnectionChannel; // 来源通道
  // 解析出的分组字段（仅 RX 方向）
  parsedFields?: Record<string, number>;
}

// 预警类型
export type AlertType = 'RSSI_WEAK' | 'DATA_TIMEOUT' | 'CONNECTION_LOST' | 'DATA_THRESHOLD' | 'SERIAL_DISCONNECTED';

// 预警记录条目
export interface AlertEntry {
  id: string;
  timestamp: number;
  type: AlertType;
  deviceId: string;
  deviceName: string | null;
  detail: string;
  channel?: ConnectionChannel; // 来源通道（BLE / SERIAL）
}

// ============ 数据内容报警规则 ============
export type ThresholdOperator = '>' | '<' | '>=' | '<=' | '==';

export interface DataAlertRule {
  id: string;
  fieldKey: string;           // 字段名，如 "T"
  operator: ThresholdOperator;
  value: number;              // 阈值数值
  enabled: boolean;
}

// ============ 字段映射配置 ============
export interface FieldMapping {
  fieldKey: string;   // 原始字段名，如 "T"
  label: string;      // 显示标签，如 "温度"
  unit: string;       // 单位，如 "℃"
}

// 字段历史数据点
export interface FieldHistoryPoint {
  timestamp: number;
  value: number;
}

// ============ BLE UUID 配置 ============
export interface BleUuidConfig {
  serviceUuid: string;    // 服务 UUID
  rxCharUuid: string;     // RX 特征值 UUID（通知订阅）
  txCharUuid: string;     // TX 特征值 UUID（写入）
}

// Nordic UART Service 默认 UUID
export const DEFAULT_BLE_UUID: BleUuidConfig = {
  serviceUuid: '6E400001-B5A3-F393-E0A9-E50E24DCCA9E',
  rxCharUuid:  '6E400003-B5A3-F393-E0A9-E50E24DCCA9E', // Notify
  txCharUuid:  '6E400002-B5A3-F393-E0A9-E50E24DCCA9E', // Write
};

// 应用设置
export interface AppSettings {
  rssiThreshold: number;       // RSSI低于此值触发预警，默认-80
  dataTimeoutSeconds: number;  // 数据超时秒数，默认10
  defaultFormat: 'HEX' | 'ASCII'; // 默认数据显示格式
  saveLog: boolean;            // 是否保存日志
  dataAlertRules: DataAlertRule[];   // 数据内容报警规则列表
  fieldMappings: FieldMapping[];     // 字段映射配置
  bleUuid: BleUuidConfig;            // BLE UUID 配置
  serialConfig: SerialConfig;        // 串口通信配置
  imgThermalUuid: ImgThermalUuidConfig; // 图传/热相 UUID 配置
  thermalColormap: ThermalColormap;  // 热相伪彩色方案
  thermalUnit: 'C' | 'F';           // 温度单位
}

// 数据统计信息
export interface DataStats {
  totalRxBytes: number;
  totalTxBytes: number;
  rxRate: number;   // bytes/s
  txRate: number;   // bytes/s
  rssiHistory: Array<{ timestamp: number; value: number }>;
}

// 字段实时值（解析视图展示用）
export interface ParsedFieldState {
  key: string;
  value: number;
  timestamp: number;
  history: FieldHistoryPoint[]; // 最近 60 个数据点
}

// ============ 蓝牙图传 ============

/** 单次图传接收记录 */
export interface ImageTransferRecord {
  id: string;
  receivedAt: number;       // 时间戳 ms
  totalChunks: number;
  receivedChunks: number;
  dataUri: string;          // "data:image/jpeg;base64,..." 完成后填入
  isComplete: boolean;
  width?: number;
  height?: number;
}

/** 图传进度（接收中状态） */
export interface ImageTransferProgress {
  totalChunks: number;
  receivedChunks: number;
  chunks: Record<number, Uint8Array>; // index -> chunk bytes
}

// ============ 热相分析 ============

/** 伪彩色映射方案 */
export type ThermalColormap = 'iron' | 'rainbow' | 'grayscale' | 'plasma';

/** 单帧热成像数据 */
export interface ThermalFrame {
  id: string;
  receivedAt: number;
  width: number;
  height: number;
  /** 温度值数组（单位 0.1℃，即实际℃ = value / 10），长度 = width * height */
  tempData: number[];
  maxTemp: number;   // 最高温度 ℃
  minTemp: number;   // 最低温度 ℃
  avgTemp: number;   // 平均温度 ℃
  maxPos: { x: number; y: number };
  minPos: { x: number; y: number };
}

/** 框选区域温度统计 */
export interface ThermalRegionStats {
  maxTemp: number;
  minTemp: number;
  avgTemp: number;
}

// ============ 图传/热相 UUID 配置 ============
export interface ImgThermalUuidConfig {
  imageCharUuid: string;    // 图像数据特征值 UUID
  thermalCharUuid: string;  // 热相数据特征值 UUID
}

export const DEFAULT_IMG_THERMAL_UUID: ImgThermalUuidConfig = {
  imageCharUuid:   '6E400004-B5A3-F393-E0A9-E50E24DCCA9E',
  thermalCharUuid: '6E400005-B5A3-F393-E0A9-E50E24DCCA9E',
};

// ============ 文件分析 ============

/** 支持的文件类型 */
export type ImportedFileType = 'rgb' | 'raw' | 'jpg' | 'jpeg' | 'png';

/** RGB 原始文件解析参数 */
export interface RgbFileParams {
  width: number;
  height: number;
  channels: 1 | 3 | 4;        // 1=灰度, 3=RGB, 4=RGBA
  depth: 'uint8' | 'uint16';   // 像素深度
}

/** 单通道统计 */
export interface ChannelStats {
  mean: number;
  variance: number;
  min: number;
  max: number;
  histogram: number[];   // 256 个 bin
}

/** 图像分析结果 */
export interface ImageAnalysisResult {
  width: number;
  height: number;
  channels: number;
  /** 各通道统计（灰度图只有 index 0）*/
  channelStats: ChannelStats[];
  /** 亮度统计 */
  brightnessStats: {
    mean: number;
    overexposedRatio: number;   // 亮度>250 像素占比 [0,1]
    underexposedRatio: number;  // 亮度<5  像素占比 [0,1]
    histogram: number[];        // 256 bin 亮度直方图
  };
  /** RMS 对比度 */
  rmsContrast: number;
  /** 综合质量评分 [0,100] */
  qualityScore: number;
}

/** 导入历史记录 */
export interface ImportedFileRecord {
  id: string;
  importedAt: number;           // 时间戳 ms
  fileName: string;
  fileSize: number;             // bytes
  fileType: ImportedFileType;
  /** 解析结果尺寸 */
  width: number;
  height: number;
  channels: number;
  /** 图像 dataURI (data:image/png;base64,...) */
  dataUri: string;
  /** 分析结果（可能异步填入）*/
  analysis?: ImageAnalysisResult;
  /** RGB 文件的用户参数 */
  rgbParams?: RgbFileParams;
}

/** 当前选中查看的通道（null=合成图）*/
export type ChannelView = null | 0 | 1 | 2;

export const MAX_FILE_HISTORY = 20;

// 蓝牙全局状态
export interface BleState {
  isScanning: boolean;
  devices: BleDevice[];
  connectedDevice: BleDevice | null;
  dataLogs: DataLogEntry[];
  alerts: AlertEntry[];
  stats: DataStats;
  settings: AppSettings;
  // 解析字段实时状态
  parsedFields: Record<string, ParsedFieldState>;
}

