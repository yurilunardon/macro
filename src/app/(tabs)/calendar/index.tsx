import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, type ComponentRef } from 'react';
import type { View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { CalendarDay } from '@/components/calendar-day';
import { useCalendarDrag } from '@/components/calendar-drag';
import { DayPager, useDayPager } from '@/components/day-pager';
import { MonthGrid, monthGridLift } from '@/components/month-grid';
import { ScreenScroll } from '@/components/screen';
import { VolleyBanner } from '@/components/volley-banner';
import { useScrollTop } from '@/hooks/use-scroll-top';
import { useToday } from '@/hooks/use-today';
import { dayInMonth, monthOf } from '@/lib/dates';
import { calendarDrag } from '@/services/calendar-drag';

/**
 * The calendar, the tab behind the round button between the other two: the month, and under it one
 * day at a time, by the hour, as pages to swipe like the food diary's.
 */
export default function CalendarScreen() {
  const router = useRouter();
  const today = useToday();
  const scroll = useScrollTop();
  const pager = useDayPager(today, null, scroll);
  const { date } = pager;

  // A month of fewer weeks leaves room: what is under it comes up, with the finger as months turn.
  const lift = useSharedValue(monthGridLift(monthOf(date)));
  const below = useAnimatedStyle(() => ({ transform: [{ translateY: lift.get() }] }));

  const geometry = { pinnedRow: useSharedValue(0), weeks: useSharedValue(5), gridTop: useSharedValue(0) };
  const monthView = useRef<ComponentRef<typeof View>>(null);
  const drag = useCalendarDrag({ scroll, date, today, goTo: pager.goTo, month: geometry, monthView });

  // Back from the sheet that asks what "Nuovo" is: it was either made into something, or nothing.
  useFocusEffect(
    useCallback(() => {
      calendarDrag.set({ draft: null });
    }, []),
  );

  return (
    <>
    <ScreenScroll scroll={scroll}>
      <Stack.Toolbar placement="left">
        {/* As in Calendar and in Alimentazione: always in the bar. */}
        <Stack.Toolbar.Button accessibilityLabel="Torna a oggi" onPress={pager.showToday}>
          Oggi
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button accessibilityLabel="Il piano" onPress={() => router.push('/calendar/plan')}>
          Il piano
        </Stack.Toolbar.Button>
        <Stack.Toolbar.Menu separateBackground icon="ellipsis" accessibilityLabel="Altro">
          <Stack.Toolbar.MenuAction icon="calendar.badge.plus" onPress={() => router.push({ pathname: '/activity', params: { date } })}>
            Aggiungi un’attività
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="scalemass" onPress={() => router.push('/calendar/weight')}>
            Peso e misure
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            icon="chart.bar.xaxis"
            onPress={() => router.push({ pathname: '/calendar/report', params: { period: 'month', anchor: `${date.slice(0, 7)}-01` } })}>
            Report
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="figure.volleyball" onPress={() => router.push('/calendar/activity-types')}>
            Tipi di attività
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="gearshape" onPress={() => router.push('/settings')}>
            Impostazioni
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      <VolleyBanner today={today} />

      <MonthGrid
        view={monthView}
        geometry={geometry}
        selected={date}
        today={today}
        scroll={scroll}
        pulse={pager.pulse}
        lift={lift}
        onSelect={pager.goTo}
        onChangeMonth={(direction) => pager.goTo(dayInMonth(date, direction, today))}
      />

      <GestureDetector gesture={drag.gesture} userSelect="none">
        <Animated.View style={below}>
          <DayPager pager={pager} today={today} renderDay={(day, page) => <CalendarDay date={day} today={today} {...page} />} />
        </Animated.View>
      </GestureDetector>
    </ScreenScroll>
    {drag.overlay}
    </>
  );
}
