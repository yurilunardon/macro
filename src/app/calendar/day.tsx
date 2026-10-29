import { Stack, useLocalSearchParams } from 'expo-router';

import { DayDetail } from '@/components/day-detail';
import { ScreenScroll } from '@/components/screen';
import { useAgenda } from '@/hooks/use-agenda';
import { useToday } from '@/hooks/use-today';
import { busyDates } from '@/lib/calendar';
import { formatDayTitle, isDateKey } from '@/lib/dates';

/** One day of the week, opened from its card: everything about it, to tick and change. */
export default function DayScreen() {
  const today = useToday();
  const params = useLocalSearchParams<{ date?: string }>();
  const date = isDateKey(params.date) ? params.date : today;
  const { data, agenda, types } = useAgenda(date, date, today);
  return (
    <ScreenScroll>
      <Stack.Screen options={{ title: formatDayTitle(date, today) }} />
      <DayDetail
        date={date}
        today={today}
        items={agenda.get(date) ?? []}
        calendar={data}
        types={types}
        busy={busyDates(agenda).has(date)}
        header={false}
      />
    </ScreenScroll>
  );
}
