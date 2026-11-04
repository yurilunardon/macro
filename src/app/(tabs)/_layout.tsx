import { Tabs } from 'expo-router/js-tabs';
import { useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabBar, TabBarInsetProvider, tabBarInset } from '@/components/tab-bar';

/** The two tabs in the capsule; the calendar is the third, behind the round button floating between them. */
const TABS = {
  '(diary)': { label: 'Alimentazione', icon: 'fork.knife' },
  training: { label: 'Allenamento', icon: 'dumbbell', selectedIcon: 'dumbbell.fill' },
} as const;

/** A moment after opening, the other tabs are built out of sight: built on the first tap, they held up the tab bar's movement. */
const BUILD_OTHERS_AFTER_MS = 1500;

export default function TabsLayout() {
  const [built, setBuilt] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setBuilt(true), BUILD_OTHERS_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  const insets = useSafeAreaInsets();
  const { width: screen } = useWindowDimensions();
  return (
    <TabBarInsetProvider value={tabBarInset(insets.bottom)}>
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={(props) => <TabBar {...props} screen={screen} safeBottom={insets.bottom} left="(diary)" right="training" center="calendar" tabs={TABS} />}>
        <Tabs.Screen name="(diary)" options={{ title: 'Alimentazione', lazy: !built }} />
        <Tabs.Screen name="calendar" options={{ title: 'Calendario', lazy: !built }} />
        <Tabs.Screen name="training" options={{ title: 'Allenamento', lazy: !built }} />
      </Tabs>
    </TabBarInsetProvider>
  );
}
