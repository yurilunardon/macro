import type { LiveQuery } from './live';
import { getDay, getProgram } from './programs';
import { getActiveWorkout } from './workouts';

/** A program's page: run ahead by the taps that open it, so it slides in whole. */
export function programScreen(id: number): LiveQuery<Awaited<ReturnType<typeof getProgram>>> {
  return { key: `program:${id}`, query: (db) => getProgram(db, id), topics: ['training'] };
}

type DayScreenData = { day: Awaited<ReturnType<typeof getDay>>; active: Awaited<ReturnType<typeof getActiveWorkout>> };

/** A program day's page, with whether a workout is running (it hides "Inizia"). */
export function dayScreen(id: number): LiveQuery<DayScreenData> {
  return {
    key: `day:${id}`,
    query: async (db) => {
      const [day, active] = await Promise.all([getDay(db, id), getActiveWorkout(db)]);
      return { day, active };
    },
    topics: ['training'],
  };
}
