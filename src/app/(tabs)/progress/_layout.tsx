import { Stack } from 'expo-router';

import { LARGE_TITLE, TAB_STACK_OPTIONS } from '@/constants/navigation';

export const unstable_settings = { anchor: 'index' };

export default function ProgressLayout() {
  return (
    <Stack screenOptions={TAB_STACK_OPTIONS}>
      <Stack.Screen name="index" options={{ ...LARGE_TITLE, title: 'Progressi' }} />
      <Stack.Screen name="weights" options={{ title: 'Pesate' }} />
      <Stack.Screen name="measurements" options={{ title: 'Misure' }} />
    </Stack>
  );
}
