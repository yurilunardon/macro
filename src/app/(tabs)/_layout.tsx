import { Tabs } from 'expo-router/js-tabs';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabBar, TabBarInsetProvider, tabBarInset } from '@/components/tab-bar';
import { WorkoutAccessory } from '@/components/workout-accessory';
import { useLiveQuery } from '@/db/live';
import { getActiveWorkout } from '@/db/workouts';
import { useWorkoutStarting } from '@/services/start-workout';

/** The two tabs in the capsule; the calendar is the third, behind the round button floating between them. */
const TABS = {
  '(diary)': { label: 'Alimentazione', icon: 'fork.knife' },
  training: { label: 'Allenamento', icon: 'dumbbell', selectedIcon: 'dumbbell.fill' },
} as const;

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { width: screen } = useWindowDimensions();
  const { data: running } = useLiveQuery('active-workout', getActiveWorkout, ['training']);
  // It appears once the workout's sheet covers the bar, not as the sheet starts to rise.
  const starting = useWorkoutStarting();
  const active = starting ? null : running;
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
            center="calendar"
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
