import { Stack } from 'expo-router';

import { LARGE_TITLE, TAB_STACK_OPTIONS } from '@/constants/navigation';

export const unstable_settings = { anchor: 'index' };

export default function SettingsLayout() {
  return (
    <Stack screenOptions={TAB_STACK_OPTIONS}>
      <Stack.Screen name="index" options={{ ...LARGE_TITLE, title: 'Profilo' }} />
      <Stack.Screen name="goals" options={{ title: 'Obiettivi' }} />
      <Stack.Screen name="foods" options={{ title: 'I miei alimenti' }} />
      <Stack.Screen name="food-edit" options={{ title: 'Alimento' }} />
      <Stack.Screen name="recipes" options={{ title: 'Ricette e pasti salvati' }} />
      <Stack.Screen name="recipe" options={{ title: 'Ricetta' }} />
      <Stack.Screen name="saved-meal" options={{ title: 'Pasto salvato' }} />
      <Stack.Screen name="reminders" options={{ title: 'Promemoria' }} />
      <Stack.Screen name="label" options={{ title: 'Leggi etichetta', headerTransparent: true, headerBlurEffect: undefined, headerTintColor: '#FFFFFF' }} />
    </Stack>
  );
}
