import { Stack, useRouter } from 'expo-router';

import { CalendarDay } from '@/components/calendar-day';
import { DayPager, useDayPager } from '@/components/day-pager';
import { PinnedStrip } from '@/components/pinned-strip';
import { activityName } from '@/components/plan-day';
import { ScreenScroll } from '@/components/screen';
import { WeekStrip, type DayMark } from '@/components/week-strip';
import { useActivityColors } from '@/hooks/use-activity-colors';
import { useAgenda } from '@/hooks/use-agenda';
import { useScrollTop } from '@/hooks/use-scroll-top';
import { useToday } from '@/hooks/use-today';
import { addDays, weekOf, type DateKey } from '@/lib/dates';

/**
 * The calendar, the tab behind the round button between the other two: one day at a time, as
 * pages under the week, like the food diary.
 */
export default function CalendarScreen() {
  const router = useRouter();
  const colors = useActivityColors();
  const today = useToday();
  const scroll = useScrollTop();
  const pager = useDayPager(today, null, scroll.scrollToTop);
  const { date } = pager;

  // Each day's main activity under it in the week: its colour, and its name for VoiceOver.
  const week = weekOf(date);
  const { data: calendar, agenda, types } = useAgenda(week[0], week[6], today);
  const gymTypeId = calendar?.gymTypeId ?? null;
  const dayNames = calendar?.dayNames ?? new Map<number, string>();
  const marks = new Map<DateKey, DayMark>();
  for (const day of week) {
    const first = (agenda.get(day) ?? []).find((i) => i.kind === 'workout' || i.status !== 'skipped');
    if (!first) continue;
    const typeId = first.kind === 'workout' ? gymTypeId : first.occurrence.typeId;
    const type = typeId === null ? undefined : types.get(typeId);
    marks.set(day, { color: colors[type?.color ?? 'green'], label: activityName(first, types, gymTypeId, dayNames) });
  }

  return (
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

      <PinnedStrip scroll={scroll}>
        <WeekStrip
          selected={date}
          today={today}
          marks={marks}
          pulse={pager.pulse}
          onSelect={pager.goTo}
          onChangeWeek={(direction) => pager.goTo(addDays(date, direction * 7))}
        />
      </PinnedStrip>

      <DayPager pager={pager} today={today} renderDay={(day, page) => <CalendarDay date={day} today={today} {...page} />} />
    </ScreenScroll>
  );
}
