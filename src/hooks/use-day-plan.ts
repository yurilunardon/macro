import { getWeightOn } from '@/db/body';
import { useLiveQuery } from '@/db/live';
import { getWeighInPlan, getWorkHours } from '@/db/plan';
import { getDoseChanges, getDoseTimes, getSupplements } from '@/db/supplements';
import { busyDates, type ActivityType, type AgendaItem, type WorkHours } from '@/lib/calendar';
import { weekOf, type DateKey } from '@/lib/dates';
import { buildDay, dayProgress, type DayEntry } from '@/lib/plan';

import { useAgenda, type Agenda } from './use-agenda';

export type DayPlan = {
  /** The week of the day, Monday to Sunday, with what each day holds. */
  week: DateKey[];
  agenda: Agenda['agenda'];
  calendar: Agenda['data'];
  types: Map<number, ActivityType>;
  /** The day's activities and workouts. */
  items: AgendaItem[];
  /** The weigh-in and the doses of the day, in the order they fall. */
  entries: DayEntry[];
  /** When the user is at work, drawn behind the hours. */
  workHours: WorkHours | null;
  progress: { done: number; total: number };
  /** False until the day's plan is loaded. */
  ready: boolean;
};

/** Everything one day of the calendar shows: its activities and its checklist, kept up to date. */
export function useDayPlan(date: DateKey, today: DateKey): DayPlan {
  const week = weekOf(date);
  const { data: calendar, agenda, types } = useAgenda(week[0], week[6], today);
  const { data } = useLiveQuery(
    `day-plan:${date}`,
    async (database) => {
      const [weighIn, workHours, supplements, taken, changes, weight] = await Promise.all([
        getWeighInPlan(database),
        getWorkHours(database),
        getSupplements(database),
        getDoseTimes(database, date),
        getDoseChanges(database, date, date),
        getWeightOn(database, date),
      ]);
      return { weighIn, workHours, supplements, taken, changes, weight };
    },
    ['settings', 'calendar', 'body'],
  );

  const items = agenda.get(date) ?? [];
  const entries = data
    ? buildDay({
        date,
        supplements: data.supplements,
        taken: data.taken,
        changes: data.changes,
        active: busyDates(agenda),
        weighIn: data.weighIn,
        weight: data.weight ? { kg: data.weight.kg, loggedAt: data.weight.logged_at ?? null } : null,
      })
    : [];
  const activities = items.filter((i) => i.kind === 'workout' || i.status !== 'skipped');
  const progress = dayProgress(entries, {
    done: activities.filter((i) => i.kind === 'workout' || i.status === 'done').length,
    total: activities.length,
  });
  return { week, agenda, calendar, types, items, entries, workHours: data?.workHours ?? null, progress, ready: data !== undefined && calendar !== undefined };
}
