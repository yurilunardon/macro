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

/** The calendar's days from `from` to `to`, kept up to date with the activities and the workouts. */
export function useAgenda(from: DateKey, to: DateKey, today: DateKey): Agenda {
  const { data } = useLiveQuery(`calendar:${from}:${to}`, (database) => getCalendar(database, from, to), ['calendar', 'training']);
  const agenda = data
    ? buildAgenda({
        occurrences: expandActivities(data.plans, data.records, from, to),
        workouts: data.workouts,
        gymTypeId: data.gymTypeId,
        today,
        rotation: data.rotation,
      })
    : new Map<DateKey, AgendaItem[]>();
  return { data, agenda, types: new Map((data?.types ?? []).map((t) => [t.id, t])) };
}
