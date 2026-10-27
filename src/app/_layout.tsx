import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { Suspense } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { NotificationSync } from '@/components/notification-sync';
import { ToastHost } from '@/components/toast';
import { UpdateCheck } from '@/components/update-check';
import { TAB_STACK_OPTIONS } from '@/constants/navigation';
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
              {/*
                An opaque bar: the time and name in it are a custom title, which iOS does not set
                apart from the sets scrolling under a transparent bar.
              */}
              <Stack.Screen
                name="workout"
                options={{
                  ...TAB_STACK_OPTIONS,
                  headerTransparent: false,
                  headerBlurEffect: undefined,
                  headerStyle: { backgroundColor: theme.background },
                  presentation: 'modal',
                  title: 'Allenamento',
                }}
              />
              <Stack.Screen name="workout-summary" options={{ presentation: 'fullScreenModal', headerShown: false }} />
              <Stack.Screen
                name="exercise-picker"
                options={{ ...TAB_STACK_OPTIONS, presentation: 'modal', title: 'Esercizi' }}
              />
              <Stack.Screen
                name="exercise-new"
                options={{ presentation: 'formSheet', sheetAllowedDetents: [0.75, 1], sheetGrabberVisible: true, headerShown: false }}
              />
              <Stack.Screen
                name="plan-exercise"
                options={{ presentation: 'formSheet', sheetAllowedDetents: [0.75, 1], sheetGrabberVisible: true, headerShown: false }}
              />
              <Stack.Screen
                name="nutrients"
                options={{
                  presentation: 'formSheet',
                  sheetAllowedDetents: [0.7, 1],
                  sheetGrabberVisible: true,
                  headerShown: false,
                }}
              />
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
            <UpdateCheck />
            <ToastHost />
          </SQLiteProvider>
        </Suspense>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
