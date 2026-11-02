import { describe, expect, it } from 'vitest';

import { formatWeekdayAndDay } from '../dates';
import { buildTrainingLine } from '../training-line';

const PUSH = 1;
const PULL = 2;
const LEGS = 3;
const DAYS = [PUSH, PULL, LEGS];

const kinds = (rows: ReturnType<typeof buildTrainingLine>) => rows.map((r) => r.kind);
const coming = (rows: ReturnType<typeof buildTrainingLine>) => rows.flatMap((r) => (r.kind === 'past' ? [] : [r.dayId]));

describe('buildTrainingLine', () => {
  it('goes in the order of time: done, next, later', () => {
    const rows = buildTrainingLine({
      history: [{ id: 12 }, { id: 11 }, { id: 10 }],
      dayIds: DAYS,
      nextId: PUSH,
      upcoming: [
        { date: '2026-11-04', time: '21:00', dayId: PUSH },
        { date: '2026-11-06', time: '21:00', dayId: PULL },
        { date: '2026-11-08', time: '17:00', dayId: LEGS },
      ],
    });
    expect(kinds(rows)).toEqual(['past', 'past', 'next', 'later', 'later']);
    // The last two done, the older first: never one done below the next.
    expect(rows.flatMap((r) => (r.kind === 'past' ? [r.workout.id] : []))).toEqual([11, 12]);
    expect(rows[2]).toMatchObject({ dayId: PUSH, date: '2026-11-04', time: '21:00' });
  });

  it('follows the rotation from the next day when the calendar has no gym days', () => {
    const rows = buildTrainingLine({ history: [], dayIds: DAYS, nextId: PULL, upcoming: [] });
    expect(coming(rows)).toEqual([PULL, LEGS, PUSH]);
    expect(kinds(rows)).toEqual(['next', 'later', 'later']);
    expect(rows.every((r) => r.kind === 'past' || r.date === null)).toBe(true);
  });

  it('keeps every day of the program in reach when the calendar repeats one', () => {
    const rows = buildTrainingLine({
      history: [],
      dayIds: DAYS,
      nextId: PUSH,
      upcoming: [
        { date: '2026-11-04', time: null, dayId: PUSH },
        { date: '2026-11-06', time: null, dayId: PUSH },
        { date: '2026-11-08', time: null, dayId: PUSH },
      ],
    });
    expect(new Set(coming(rows))).toEqual(new Set(DAYS));
    // Each row has its own key, even with the same day twice.
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it('leaves out gym days for a day that is not in the program in use', () => {
    const rows = buildTrainingLine({ history: [], dayIds: [PUSH], nextId: PUSH, upcoming: [{ date: '2026-11-04', time: null, dayId: 99 }] });
    expect(coming(rows)).toEqual([PUSH]);
  });
});

describe('formatWeekdayAndDay', () => {
  it('reads as a short day and its number', () => {
    expect(formatWeekdayAndDay('2026-11-04')).toBe('Mer 4');
  });
});
