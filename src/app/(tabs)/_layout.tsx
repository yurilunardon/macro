import { NativeTabs } from 'expo-router/native-tabs';
import type { SFSymbol } from 'expo-symbols';

import { WorkoutAccessory } from '@/components/workout-accessory';
import { useLiveQuery } from '@/db/live';
import { getActiveWorkout } from '@/db/workouts';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';

export default function TabsLayout() {
  const theme = useTheme();
  const today = useToday();
  const { data: active } = useLiveQuery('active-workout', getActiveWorkout, ['training']);
  // Today's date on the page, as on the Calendar app's icon.
  const calendarIcon = `${Number(today.slice(8))}.calendar` as SFSymbol;
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
      {/*
        In the middle, and where the app opens (see +native-intent). On iOS 27 it also gets a
        surface of its own, which stays when the bar shrinks while scrolling.
      */}
      <NativeTabs.Trigger name="calendar" prominent>
        <NativeTabs.Trigger.Label>Calendario</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={calendarIcon} md="calendar_month" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="training">
        <NativeTabs.Trigger.Label>Allenamento</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'dumbbell', selected: 'dumbbell.fill' }} md="fitness_center" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
