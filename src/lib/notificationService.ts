/**
 * 本地推送通知服务（expo-notifications）
 * - 权限申请
 * - 发送预警通知
 */
import * as Notifications from 'expo-notifications';
import type { AlertType } from './types';

// 通知前台展示策略
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function requestNotificationPermission(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function checkNotificationPermission(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted';
}

const ALERT_TITLES: Record<AlertType, string> = {
  RSSI_WEAK:           '信号强度预警',
  DATA_TIMEOUT:        '数据超时预警',
  CONNECTION_LOST:     '连接断开预警',
  DATA_THRESHOLD:      '数据内容报警',
  SERIAL_DISCONNECTED: '串口断开预警',
  SIMILARITY_DROP:     '相似度骤降告警',
  TEMPERATURE_HIGH:    '温度超限预警',
};

/** 发送一条预警本地通知 */
export async function sendAlertNotification(
  type: AlertType,
  deviceName: string | null,
  detail: string
): Promise<void> {
  try {
    const granted = await checkNotificationPermission();
    if (!granted) return;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: ALERT_TITLES[type] ?? '预警',
        body: `${deviceName ? `[${deviceName}] ` : ''}${detail}`,
        data: { type, deviceName },
        sound: true,
      },
      trigger: null, // 立即发送
    });
  } catch { /* 通知发送失败不影响主流程 */ }
}
