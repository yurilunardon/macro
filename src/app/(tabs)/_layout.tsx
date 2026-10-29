import { Tabs } from 'expo-router/js-tabs';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabBar, TabBarInsetProvider, tabBarInset } from '@/components/tab-bar';
import { WorkoutAccessory } from '@/components/workout-accessory';
import { useLiveQuery } from '@/db/live';
import { getActiveWorkout } from '@/db/workouts';

/** The two tabs; the calendar opens from the round button floating between them. */
const TABS = {
  '(diary)': { label: 'Alimentazione', icon: 'fork.knife' },
  training: { label: 'Allenamento', icon: 'dumbbell', selectedIcon: 'dumbbell.fill' },
} as const;

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { width: screen } = useWindowDimensions();
  const { data: active } = useLiveQuery('active-workout', getActiveWorkout, ['training']);
  return (
    <TabBarInsetProvider value={tabBarInset(insets.bottom, Boolean(active))}>
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={(props) => (
          <TabBar
            {...props}
            screen={screen}
            safeBottom={insets.bottom}
            left="(diary)"
            right="training"
            tabs={TABS}
            accessory={active ? <WorkoutAccessory id={active.id} name={active.name} startedAt={active.startedAt} /> : null}
          />
        )}>
        <Tabs.Screen name="(diary)" options={{ title: 'Alimentazione' }} />
        <Tabs.Screen name="training" options={{ title: 'Allenamento' }} />
      </Tabs>
    </TabBarInsetProvider>
  );
}
