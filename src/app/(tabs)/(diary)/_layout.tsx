import { Stack } from 'expo-router';

import { LARGE_TITLE, TAB_STACK_OPTIONS } from '@/constants/navigation';

export default function DiaryLayout() {
  return (
    <Stack screenOptions={TAB_STACK_OPTIONS}>
      <Stack.Screen name="index" options={{ ...LARGE_TITLE, title: 'Diario' }} />
    </Stack>
  );
}
