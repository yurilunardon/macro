import { Stack } from 'expo-router';

import { LARGE_TITLE, TAB_STACK_OPTIONS } from '@/constants/navigation';

export const unstable_settings = { anchor: 'index' };

export default function TrainingLayout() {
  return (
    <Stack screenOptions={TAB_STACK_OPTIONS}>
      <Stack.Screen name="index" options={{ ...LARGE_TITLE, title: 'Allenamento' }} />
      <Stack.Screen name="new" options={{ title: 'Nuova scheda' }} />
      <Stack.Screen name="programs" options={{ title: 'Schede' }} />
      <Stack.Screen name="program" options={{ title: 'Scheda' }} />
      <Stack.Screen name="day" options={{ title: 'Giorno' }} />
      <Stack.Screen name="exercises" options={{ title: 'Esercizi' }} />
      <Stack.Screen name="exercise" options={{ title: 'Esercizio' }} />
      <Stack.Screen name="history" options={{ title: 'Storico' }} />
      <Stack.Screen name="session" options={{ title: 'Allenamento' }} />
    </Stack>
  );
}
