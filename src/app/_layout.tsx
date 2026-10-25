import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { Suspense } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { NotificationSync } from '@/components/notification-sync';
import { DATABASE_NAME, migrateDatabase } from '@/db/schema';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = { anchor: '(tabs)' };

function Loading() {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
      <ActivityIndicator />
    </View>
  );
}

export default function RootLayout() {
  const scheme = useColorScheme();
  const theme = useTheme();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...base,
    colors: { ...base.colors, primary: theme.accent, background: theme.background, card: theme.card, text: theme.text },
  };

  return (
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider value={navigationTheme}>
        <Suspense fallback={<Loading />}>
          <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrateDatabase} useSuspense>
            <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="add" options={{ presentation: 'modal', headerShown: false }} />
              <Stack.Screen
                name="entry/[id]"
                options={{
                  presentation: 'formSheet',
                  sheetAllowedDetents: [0.75, 1],
                  sheetGrabberVisible: true,
                  headerShown: false,
                }}
              />
            </Stack>
            <NotificationSync />
          </SQLiteProvider>
        </Suspense>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
