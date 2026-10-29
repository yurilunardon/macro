import { Tabs } from 'expo-router/js-tabs';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabBar, TabBarInsetProvider, tabBarInset } from '@/components/tab-bar';
import { WorkoutAccessory } from '@/components/workout-accessory';
import { useLiveQuery } from '@/db/live';
import { getSetting } from '@/db/settings';
import { getActiveWorkout } from '@/db/workouts';

/** The calendar in the middle, where the app opens (see +native-intent); a tab on each side. */
const ROUTES = { left: '(diary)', center: 'calendar', right: 'training' } as const;
const TABS = {
  '(diary)': { label: 'Alimentazione', icon: 'fork.knife' },
  training: { label: 'Allenamento', icon: 'dumbbell', selectedIcon: 'dumbbell.fill' },
} as const;

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { width: screen } = useWindowDimensions();
  const { data: active } = useLiveQuery('active-workout', getActiveWorkout, ['training']);
  const { data: style } = useLiveQuery('tab-bar-style', (database) => getSetting(database, 'tabBarStyle'), ['settings']);
  const look = style ?? 'capsule';
  return (
    <TabBarInsetProvider value={tabBarInset(insets.bottom, Boolean(active), look, screen)}>
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={(props) => (
          <TabBar
            {...props}
            look={look}
            screen={screen}
            safeBottom={insets.bottom}
            routes={ROUTES}
            tabs={TABS}
            accessory={active ? <WorkoutAccessory id={active.id} name={active.name} startedAt={active.startedAt} /> : null}
          />
        )}>
        <Tabs.Screen name="(diary)" options={{ title: 'Alimentazione' }} />
        <Tabs.Screen name="calendar" options={{ title: 'Calendario' }} />
        <Tabs.Screen name="training" options={{ title: 'Allenamento' }} />
      </Tabs>
    </TabBarInsetProvider>
  );
}
