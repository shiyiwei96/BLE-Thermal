import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="temp-comparison" />
      <Stack.Screen name="thermal-recordings" />
    </Stack>
  );
}
