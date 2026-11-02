import { Tabs } from 'expo-router/js-tabs';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabBar, TabBarInsetProvider, tabBarInset } from '@/components/tab-bar';

/** The two tabs in the capsule; the calendar is the third, behind the round button floating between them. */
const TABS = {
  '(diary)': { label: 'Alimentazione', icon: 'fork.knife' },
  training: { label: 'Allenamento', icon: 'dumbbell', selectedIcon: 'dumbbell.fill' },
} as const;

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { width: screen } = useWindowDimensions();
  return (
    <TabBarInsetProvider value={tabBarInset(insets.bottom)}>
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={(props) => <TabBar {...props} screen={screen} safeBottom={insets.bottom} left="(diary)" right="training" center="calendar" tabs={TABS} />}>
        <Tabs.Screen name="(diary)" options={{ title: 'Alimentazione' }} />
        <Tabs.Screen name="calendar" options={{ title: 'Calendario' }} />
        <Tabs.Screen name="training" options={{ title: 'Allenamento' }} />
      </Tabs>
    </TabBarInsetProvider>
  );
}
