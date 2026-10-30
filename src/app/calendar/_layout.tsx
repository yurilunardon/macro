import { Stack } from 'expo-router';

import { TAB_STACK_OPTIONS } from '@/constants/navigation';

export const unstable_settings = { anchor: 'index' };

/**
 * A sheet over the tabs, opened from the round button in the tab bar's cradle: it grows out of
 * the button and shrinks back into it, also when dragged down (see TabBar).
 */
export default function CalendarLayout() {
  return (
    <Stack screenOptions={TAB_STACK_OPTIONS}>
      {/* The day draws its own title, with how much of it is done beside it. */}
      <Stack.Screen name="index" options={{ title: '' }} />
      <Stack.Screen name="plan" options={{ title: 'Il piano' }} />
      <Stack.Screen name="plan-day" options={{ title: '' }} />
      <Stack.Screen name="moments" options={{ title: 'Orari della giornata' }} />
      <Stack.Screen name="weigh-in" options={{ title: 'Pesata' }} />
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
