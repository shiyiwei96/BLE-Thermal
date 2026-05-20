/**
 * 全局通道模式 Context
 * 控制当前激活的通信通道：BLE 蓝牙 或 SERIAL 串口
 */
import React, { createContext, useCallback, useContext, useState } from 'react';
import type { ConnectionChannel } from './types';

interface ConnectionModeContextType {
  activeChannel: ConnectionChannel;
  setActiveChannel: (ch: ConnectionChannel) => void;
}

const ConnectionModeContext = createContext<ConnectionModeContextType>({
  activeChannel: 'BLE',
  setActiveChannel: () => {},
});

export function ConnectionModeProvider({ children }: { children: React.ReactNode }) {
  const [activeChannel, setChannelState] = useState<ConnectionChannel>('BLE');

  const setActiveChannel = useCallback((ch: ConnectionChannel) => {
    setChannelState(ch);
  }, []);

  return (
    <ConnectionModeContext.Provider value={{ activeChannel, setActiveChannel }}>
      {children}
    </ConnectionModeContext.Provider>
  );
}

export function useConnectionMode() {
  return useContext(ConnectionModeContext);
}
