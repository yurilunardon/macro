import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { DayPage } from '@/components/day-page';
import { DayPager, useDayPager } from '@/components/day-pager';
import { PinnedStrip } from '@/components/pinned-strip';
import { ScreenScroll } from '@/components/screen';
import { WeekStrip, type DayProgress } from '@/components/week-strip';
import { getDayPlans } from '@/db/days';
import { getEntriesForDate } from '@/db/entries';
import { useLiveQuery } from '@/db/live';
import { useScrollTop } from '@/hooks/use-scroll-top';
import { useToday } from '@/hooks/use-today';
import { addDays, isDateKey, weekOf, type DateKey } from '@/lib/dates';
import { formatKcal } from '@/lib/format';
import { mealForTime } from '@/lib/meals';
import { CLEAR_MS, useDrainingDay } from '@/services/draining-day';
import { usePendingDeletes } from '@/services/undo';

/** UIBarButtonItem's width: passed through to the native button, though not in the props' type. */
const WIDE: object = { width: 64 };

/**
 * For each day, how much of its calorie goal was eaten. It counts what the day's page counts, so
 * the two go down together when a food is deleted and back up together on "Annulla".
 */
function useCalorieProgress(date: DateKey): Map<DateKey, DayProgress> {
  const days = weekOf(date);
  const hidden = usePendingDeletes();
  const draining = useDrainingDay();
  const { data } = useLiveQuery(`week:${days[0]}`, async (database) => {
    const [entries, plans] = await Promise.all([Promise.all(days.map((day) => getEntriesForDate(database, day))), getDayPlans(database, days)]);
    return { entries, plans };
  }, ['food', 'settings']);
  const progress = new Map<DateKey, DayProgress>();
  days.forEach((day, index) => {
    const kcal = (data?.entries[index] ?? []).reduce((sum, e) => (hidden.has(`entry:${e.id}`) ? sum : sum + e.totals.kcal), 0);
    const target = data?.plans.get(day)?.targets.kcal ?? 0;
    const label = `${formatKcal(kcal)} kcal`;
    if (day === draining) progress.set(day, { progress: 0, label, slowMs: CLEAR_MS });
    else if (kcal > 0) progress.set(day, { progress: target > 0 ? kcal / target : 0, label });
  });
  return progress;
}

export default function NutritionScreen() {
  const router = useRouter();
  const today = useToday();
  // A day opened from elsewhere, such as the calendar.
  const params = useLocalSearchParams<{ date?: string }>();
  const asked = isDateKey(params.date) ? params.date : null;

  // Back to the top of the page, where the day's ring is, e.g. to watch it empty.
  const scroll = useScrollTop();
  const { scrollToTop } = scroll;
  // The pages around the one on screen are kept ready; see DayPage for why they cost little.
  const pager = useDayPager(today, asked, scroll);
  const { date } = pager;
  const calories = useCalorieProgress(date);

  // Opened on a day from the calendar: slide to it as if it were picked above, then forget it, so
  // the same day can be asked for again.
  useEffect(() => {
    if (asked === null) return;
    pager.goTo(asked);
    router.setParams({ date: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);

  return (
    <ScreenScroll scroll={scroll}>
      {/* As in Calendar: always in the bar. */}
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button accessibilityLabel="Torna a oggi" onPress={pager.showToday}>
          Oggi
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      {/* Scanning is the quickest way to log food: the button on the far right, wider than an icon. */}
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Altro">
          <Stack.Toolbar.MenuAction icon="target" onPress={() => router.push('/goals')}>
            Obiettivi
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="fork.knife" onPress={() => router.push('/foods')}>
            I miei alimenti
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="frying.pan" onPress={() => router.push('/recipes')}>
            Ricette e pasti salvati
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Button
          {...WIDE}
          separateBackground
          icon="barcode.viewfinder"
          accessibilityLabel="Scansiona codice a barre"
          onPress={() => router.push({ pathname: '/add/scan', params: { meal: mealForTime(), date } })}
        />
      </Stack.Toolbar>

      <PinnedStrip scroll={scroll}>
        <WeekStrip
          selected={date}
          today={today}
          progress={calories}
          pulse={pager.pulse}
          onSelect={pager.goTo}
          onChangeWeek={(direction) => pager.goTo(addDays(date, direction * 7))}
        />
      </PinnedStrip>

      <DayPager
        pager={pager}
        today={today}
        renderDay={(day, page) => <DayPage date={day} today={today} {...page} scrollToTop={scrollToTop} />}
      />
    </ScreenScroll>
  );
}
