import { Tabs } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabBar, TabBarInsetProvider, tabBarInset } from '@/components/tab-bar';
import { WorkoutAccessory } from '@/components/workout-accessory';
import { useLiveQuery } from '@/db/live';
import { getActiveWorkout } from '@/db/workouts';

/** The side tabs; the calendar is the round button between them. */
const SIDES = {
  '(diary)': { label: 'Alimentazione', icon: 'fork.knife' },
  training: { label: 'Allenamento', icon: 'dumbbell', selectedIcon: 'dumbbell.fill' },
} as const;

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { data: active } = useLiveQuery('active-workout', getActiveWorkout, ['training']);
  return (
    <TabBarInsetProvider value={tabBarInset(insets.bottom, Boolean(active))}>
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={(props) => (
          <TabBar
            {...props}
            center="calendar"
            sides={SIDES}
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
