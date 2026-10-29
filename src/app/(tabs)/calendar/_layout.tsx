import { Stack } from 'expo-router';

import { LARGE_TITLE, TAB_STACK_OPTIONS } from '@/constants/navigation';

export const unstable_settings = { anchor: 'index' };

/** The tab in the middle, where the app opens: the day, the week and everything planned. */
export default function CalendarLayout() {
  return (
    <Stack screenOptions={TAB_STACK_OPTIONS}>
      <Stack.Screen name="index" options={{ ...LARGE_TITLE, title: 'Calendario' }} />
      <Stack.Screen name="supplements" options={{ title: 'Integratori' }} />
      <Stack.Screen name="activity-types" options={{ title: 'Tipi di attività' }} />
      <Stack.Screen name="report" options={{ title: 'Report' }} />
      <Stack.Screen name="weight" options={{ title: 'Peso' }} />
      <Stack.Screen name="weights" options={{ title: 'Pesate' }} />
      <Stack.Screen name="measurements" options={{ title: 'Misure' }} />
      <Stack.Screen name="day" options={{ title: '' }} />
      <Stack.Screen name="session" options={{ title: 'Allenamento' }} />
      <Stack.Screen name="history" options={{ title: 'Storico' }} />
    </Stack>
  );
}
