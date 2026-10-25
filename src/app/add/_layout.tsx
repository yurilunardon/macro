import { Stack } from 'expo-router';

export const unstable_settings = { anchor: 'index' };

export default function AddLayout() {
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal', headerShadowVisible: false }}>
      <Stack.Screen name="index" options={{ title: 'Aggiungi' }} />
      <Stack.Screen
        name="scan"
        options={{ title: 'Scansiona', headerTransparent: true, headerTintColor: '#FFFFFF', headerStyle: { backgroundColor: 'transparent' } }}
      />
      <Stack.Screen name="food" options={{ title: '' }} />
      <Stack.Screen name="custom" options={{ title: 'Nuovo alimento' }} />
      <Stack.Screen name="quick" options={{ title: 'Aggiunta rapida' }} />
    </Stack>
  );
}
