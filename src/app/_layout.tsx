import * as Sentry from '@sentry/react-native';
import { Stack } from 'expo-router';
import { PortalHost } from '@rn-primitives/portal';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';

import { BleProvider, useBle } from '@/lib/bleContext';
import { SerialProvider } from '@/lib/serialContext';
import { ConnectionModeProvider } from '@/lib/connectionMode';
import "../global.css";

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
});

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(app)" />
    </Stack>
  );
}

/** SerialProvider 需要 settings，从 BleProvider 内读取 */
function InnerProviders({ children }: { children: React.ReactNode }) {
  const { settings } = useBle();
  return (
    <SerialProvider settings={settings}>
      <ConnectionModeProvider>
        {children}
      </ConnectionModeProvider>
    </SerialProvider>
  );
}

const RootLayout: React.FC = () => {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#121212' }}>
      <StatusBar style="light" backgroundColor="#121212" />
      <BleProvider>
        <InnerProviders>
          <RootLayoutNav />
          <PortalHost />
        </InnerProviders>
      </BleProvider>
    </GestureHandlerRootView>
  );
};

export default Sentry.wrap(RootLayout);
