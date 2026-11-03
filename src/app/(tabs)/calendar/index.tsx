import { Stack, useRouter } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';

import { CalendarDay } from '@/components/calendar-day';
import { DayPager, useDayPager } from '@/components/day-pager';
import { MonthGrid } from '@/components/month-grid';
import { activityName } from '@/components/plan-day';
import { ScreenScroll } from '@/components/screen';
import type { DaySymbol } from '@/components/week-strip';
import { useAgenda } from '@/hooks/use-agenda';
import { useScrollTop } from '@/hooks/use-scroll-top';
import { useToday } from '@/hooks/use-today';
import { addMonths, monthGrid, monthOf, monthRange, type DateKey } from '@/lib/dates';

/** The same day of another month, or its last day when that month is shorter; today in today's month. */
function dayInMonth(date: DateKey, direction: number, today: DateKey): DateKey {
  const month = addMonths(monthOf(date), direction);
  if (month === monthOf(today)) return today;
  const last = monthRange(month).to;
  const day = `${month}-${date.slice(8)}`;
  return day > last ? last : day;
}

/**
 * The calendar, the tab behind the round button between the other two: the month, and under it one
 * day at a time, by the hour, as pages to swipe like the food diary's.
 */
export default function CalendarScreen() {
  const router = useRouter();
  const today = useToday();
  const scroll = useScrollTop();
  const pager = useDayPager(today, null, scroll.scrollToTop);
  const { date } = pager;

  // Each day's main activity under it in the month: its symbol, and its name for VoiceOver.
  const month = monthOf(date);
  const days = monthGrid(month);
  const { data: calendar, agenda, types } = useAgenda(days[0], days[days.length - 1], today);
  const gymTypeId = calendar?.gymTypeId ?? null;
  const dayNames = calendar?.dayNames ?? new Map<number, string>();
  const symbols = new Map<DateKey, DaySymbol>();
  for (const day of days) {
    const first = (agenda.get(day) ?? []).find((i) => i.kind === 'workout' || i.status !== 'skipped');
    if (!first) continue;
    const typeId = first.kind === 'workout' ? gymTypeId : first.occurrence.typeId;
    const type = typeId === null ? undefined : types.get(typeId);
    symbols.set(day, { symbol: (type?.symbol ?? 'dumbbell.fill') as SFSymbol, label: activityName(first, types, gymTypeId, dayNames) });
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

      <MonthGrid
        month={month}
        selected={date}
        today={today}
        symbols={symbols}
        scroll={scroll}
        pulse={pager.pulse}
        onSelect={pager.goTo}
        onChangeMonth={(direction) => pager.goTo(dayInMonth(date, direction, today))}
      />

      <DayPager pager={pager} today={today} renderDay={(day, page) => <CalendarDay date={day} today={today} {...page} />} />
    </ScreenScroll>
  );
}
