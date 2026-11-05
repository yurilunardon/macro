import { useMemo } from 'react';

import { getCalendar, type CalendarData } from '@/db/calendar';
import { useLiveQuery } from '@/db/live';
import { buildAgenda, expandActivities, type ActivityType, type AgendaItem } from '@/lib/calendar';
import type { DateKey } from '@/lib/dates';

export type Agenda = {
  data: CalendarData | undefined;
  /** What each day from `from` to `to` holds. */
  agenda: Map<DateKey, AgendaItem[]>;
  types: Map<number, ActivityType>;
};

/**
 * The calendar's days from `from` to `to`, kept up to date with the activities and the workouts.
 * Days to come are counted from today, so the gym days of a later week get the program's days in
 * the right turn.
 */
export function useAgenda(from: DateKey, to: DateKey, today: DateKey): Agenda {
  const start = from < today ? from : today;
  const { data } = useLiveQuery(`calendar:${start}:${to}`, (database) => getCalendar(database, start, to), ['calendar', 'training']);
  // Worked out again only when the data changes: a page that draws itself for another reason, as a
  // month does at each day picked, need not lay out its weeks again.
  const agenda = useMemo(
    () =>
      data
        ? buildAgenda({
            occurrences: expandActivities(data.plans, data.records, start, to),
            workouts: data.workouts,
            gymTypeId: data.gymTypeId,
            today,
            rotation: data.rotation,
          })
        : new Map<DateKey, AgendaItem[]>(),
    [data, start, to, today],
  );
  const types = useMemo(() => new Map((data?.types ?? []).map((t) => [t.id, t])), [data]);
  return { data, agenda, types };
}
