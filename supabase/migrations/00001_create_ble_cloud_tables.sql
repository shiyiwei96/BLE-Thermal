
-- 设备信息表
CREATE TABLE IF NOT EXISTS devices (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  address     text NOT NULL,
  color_label text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 数据收发日志表
CREATE TABLE IF NOT EXISTS data_logs (
  id          text PRIMARY KEY,
  device_id   text NOT NULL,
  direction   text NOT NULL CHECK (direction IN ('RX','TX')),
  raw_hex     text NOT NULL,
  timestamp   bigint NOT NULL
);

-- 预警记录表
CREATE TABLE IF NOT EXISTS alerts (
  id          text PRIMARY KEY,
  device_id   text NOT NULL,
  device_name text,
  type        text NOT NULL,
  detail      text,
  timestamp   bigint NOT NULL
);

-- 热相录制记录表
CREATE TABLE IF NOT EXISTS thermal_recordings (
  id          text PRIMARY KEY,
  device_id   text NOT NULL,
  device_name text,
  name        text NOT NULL,
  frame_count int  NOT NULL DEFAULT 0,
  duration_ms bigint NOT NULL DEFAULT 0,
  file_path   text,
  created_at  bigint NOT NULL
);

-- 热相帧数据表（附属于录制记录）
CREATE TABLE IF NOT EXISTS thermal_frames (
  id           text PRIMARY KEY,
  recording_id text NOT NULL REFERENCES thermal_recordings(id) ON DELETE CASCADE,
  frame_index  int  NOT NULL,
  temp_max     float,
  temp_min     float,
  temp_avg     float,
  matrix_json  text,
  timestamp    bigint NOT NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_data_logs_device   ON data_logs(device_id);
CREATE INDEX IF NOT EXISTS idx_alerts_device       ON alerts(device_id);
CREATE INDEX IF NOT EXISTS idx_thermal_rec_device  ON thermal_recordings(device_id);
CREATE INDEX IF NOT EXISTS idx_thermal_frames_rec  ON thermal_frames(recording_id, frame_index);
