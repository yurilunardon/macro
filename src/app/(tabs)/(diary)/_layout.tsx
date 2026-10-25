import { Stack } from 'expo-router';

export default function DiaryLayout() {
  return (
    <Stack screenOptions={{ headerLargeTitle: true, headerShadowVisible: false, headerTransparent: false }}>
      <Stack.Screen name="index" options={{ title: 'Diario' }} />
    </Stack>
  );
}
