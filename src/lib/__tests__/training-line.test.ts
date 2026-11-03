import { describe, expect, it } from 'vitest';

import { formatWeekdayAndDay } from '../dates';
import { buildTrainingLine } from '../training-line';

const PUSH = 1;
const PULL = 2;
const LEGS = 3;
const DAYS = [PUSH, PULL, LEGS];

const kinds = (rows: ReturnType<typeof buildTrainingLine>) => rows.map((r) => r.kind);
const coming = (rows: ReturnType<typeof buildTrainingLine>) => rows.flatMap((r) => (r.kind === 'past' || r.kind === 'active' ? [] : [r.dayId]));

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
    expect(rows.every((r) => r.kind === 'past' || r.kind === 'active' || r.date === null)).toBe(true);
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

describe('buildTrainingLine with a workout in progress', () => {
  it('puts it between what is done and what comes', () => {
    const rows = buildTrainingLine({
      history: [{ id: 1 }],
      dayIds: DAYS,
      nextId: PUSH,
      upcoming: [{ date: '2026-11-06', time: '21:00', dayId: PULL }],
      active: { dayId: PUSH },
    });
    expect(kinds(rows)).toEqual(['past', 'active', 'next', 'later']);
  });

  it('does not list its day again among those to come', () => {
    const rows = buildTrainingLine({ history: [], dayIds: DAYS, nextId: PUSH, upcoming: [], active: { dayId: PUSH } });
    expect(coming(rows)).toEqual([PULL, LEGS]);
  });

  it('takes a free workout too', () => {
    const rows = buildTrainingLine({ history: [], dayIds: DAYS, nextId: PUSH, upcoming: [], active: { dayId: null } });
    expect(kinds(rows)[0]).toBe('active');
    expect(coming(rows)).toEqual(DAYS);
  });
});

describe('formatWeekdayAndDay', () => {
  it('reads as a short day and its number', () => {
    expect(formatWeekdayAndDay('2026-11-04')).toBe('Mer 4');
  });
});
