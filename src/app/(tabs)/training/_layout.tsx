import { Stack } from 'expo-router';

import { LARGE_TITLE, TAB_STACK_OPTIONS } from '@/constants/navigation';

export const unstable_settings = { anchor: 'index' };

export default function TrainingLayout() {
  return (
    <Stack screenOptions={TAB_STACK_OPTIONS}>
      <Stack.Screen name="index" options={{ ...LARGE_TITLE, title: 'Allenamento' }} />
      <Stack.Screen name="new" options={{ title: 'Nuova scheda' }} />
      <Stack.Screen name="programs" options={{ title: 'Schede' }} />
      {/* No title in the bar: the page has its own, in large type, to rename it. */}
      <Stack.Screen name="program" options={{ title: '' }} />
      <Stack.Screen name="day" options={{ title: '' }} />
      <Stack.Screen name="exercises" options={{ title: 'Esercizi' }} />
      <Stack.Screen name="exercise" options={{ title: 'Esercizio' }} />
      <Stack.Screen name="history" options={{ title: 'Storico' }} />
      <Stack.Screen name="muscle" options={{ title: 'Muscolo' }} />
      <Stack.Screen name="session" options={{ title: 'Allenamento' }} />
    </Stack>
  );
}
