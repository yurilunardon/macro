import { Stack } from 'expo-router';

export const unstable_settings = { anchor: 'index' };

export default function ProgressLayout() {
  return (
    <Stack screenOptions={{ headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Screen name="index" options={{ title: 'Progressi', headerLargeTitle: true }} />
      <Stack.Screen name="measurements" options={{ title: 'Misure' }} />
    </Stack>
  );
}
