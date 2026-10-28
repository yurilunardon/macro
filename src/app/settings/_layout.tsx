import { Stack } from 'expo-router';

import { TAB_STACK_OPTIONS } from '@/constants/navigation';

export const unstable_settings = { anchor: 'index' };

/** A sheet of its own, opened from the calendar's ⋯ menu: what is set up once and rarely seen. */
export default function SettingsLayout() {
  return (
    <Stack screenOptions={TAB_STACK_OPTIONS}>
      <Stack.Screen name="index" options={{ title: 'Impostazioni' }} />
      <Stack.Screen name="reminders" options={{ title: 'Promemoria' }} />
    </Stack>
  );
}
