import { getWeightOn } from '@/db/body';
import { useLiveQuery } from '@/db/live';
import { getMoments, getWeighInPlan } from '@/db/plan';
import { getDoseTimes, getSupplements } from '@/db/supplements';
import { busyDates, type ActivityType, type AgendaItem } from '@/lib/calendar';
import { weekOf, type DateKey } from '@/lib/dates';
import { buildDay, dayProgress, trainingTimes, type DaySection, type TrainingTimes } from '@/lib/plan';

import { useAgenda, type Agenda } from './use-agenda';

export type DayPlan = {
  /** The week of the day, Monday to Sunday, with what each day holds. */
  week: DateKey[];
  agenda: Agenda['agenda'];
  calendar: Agenda['data'];
  types: Map<number, ActivityType>;
  /** The day's activities and workouts. */
  items: AgendaItem[];
  training: TrainingTimes;
  sections: DaySection[];
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
      const [moments, weighIn, supplements, taken, weight] = await Promise.all([
        getMoments(database),
        getWeighInPlan(database),
        getSupplements(database),
        getDoseTimes(database, date),
        getWeightOn(database, date),
      ]);
      return { moments, weighIn, supplements, taken, weight };
    },
    ['settings', 'calendar', 'body'],
  );

  const items = agenda.get(date) ?? [];
  const training = trainingTimes(items, types);
  const sections = data
    ? buildDay({
        date,
        moments: data.moments,
        training,
        supplements: data.supplements,
        taken: data.taken,
        active: busyDates(agenda),
        weighIn: data.weighIn,
        weight: data.weight ? { kg: data.weight.kg, loggedAt: data.weight.logged_at ?? null } : null,
      })
    : [];
  const activities = items.filter((i) => i.kind === 'workout' || i.status !== 'skipped');
  const progress = dayProgress(sections, {
    done: activities.filter((i) => i.kind === 'workout' || i.status === 'done').length,
    total: activities.length,
  });
  return { week, agenda, calendar, types, items, training, sections, progress, ready: data !== undefined && calendar !== undefined };
}
