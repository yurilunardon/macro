import { useRouter } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';

import { WorkoutAccessory } from '@/components/workout-accessory';
import { useLiveQuery } from '@/db/live';
import { getActiveWorkout } from '@/db/workouts';
import { useTheme } from '@/hooks/use-theme';

export default function TabsLayout() {
  const theme = useTheme();
  const router = useRouter();
  const { data: active } = useLiveQuery('active-workout', getActiveWorkout, ['training']);
  return (
    <NativeTabs tintColor={theme.accent}>
      {active ? (
        <NativeTabs.BottomAccessory>
          <WorkoutAccessory id={active.id} name={active.name} startedAt={active.startedAt} />
        </NativeTabs.BottomAccessory>
      ) : null}
      <NativeTabs.Trigger name="(diary)">
        <NativeTabs.Trigger.Label>Alimentazione</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="fork.knife" md="restaurant" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="training">
        <NativeTabs.Trigger.Label>Allenamento</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'dumbbell', selected: 'dumbbell.fill' }} md="fitness_center" />
      </NativeTabs.Trigger>
      {/*
        The calendar in a round button of its own at the end of the bar, where Photos and Music
        keep Search. It is never selected: a tap opens the calendar over the tabs.
      */}
      <NativeTabs.Trigger
        name="open-calendar"
        role="search"
        disabled
        accessibilityLabel="Calendario"
        listeners={{ tabPress: () => router.push('/calendar') }}>
        <NativeTabs.Trigger.Icon sf="calendar" md="calendar_month" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
