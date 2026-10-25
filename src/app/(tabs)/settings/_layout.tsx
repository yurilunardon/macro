import { Stack } from 'expo-router';

export const unstable_settings = { anchor: 'index' };

export default function SettingsLayout() {
  return (
    <Stack screenOptions={{ headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Screen name="index" options={{ title: 'Profilo', headerLargeTitle: true }} />
      <Stack.Screen name="goals" options={{ title: 'Obiettivi' }} />
      <Stack.Screen name="foods" options={{ title: 'I miei alimenti' }} />
      <Stack.Screen name="food-edit" options={{ title: 'Alimento' }} />
    </Stack>
  );
}
