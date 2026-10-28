import { describe, expect, it } from 'vitest';

import type { AgendaItem } from '../calendar';
import { averageClock, buildTimeline, partsOfDay, tickTimes, workoutTimes } from '../timeline';

/** An ISO time for a local date and time, as the app stores them. */
const at = (date: string, time: string) => new Date(`${date}T${time}:00`).toISOString();

const workout = (id: number, date: string, start: string, end: string | null): AgendaItem => ({
  kind: 'workout',
  key: `w${id}`,
  workout: { id, name: 'Push', date, startedAt: at(date, start), endedAt: end ? at(date, end) : null, dayId: null, workSets: 12 },
  occurrence: null,
});

const volley = (date: string, time: string | null): AgendaItem => ({
  kind: 'activity',
  key: `p1:${date}`,
  occurrence: { key: `p1:${date}`, recordId: null, planId: 1, typeId: 2, date, time, minutes: 90, dayId: null, note: null, status: 'done' },
  status: 'done',
  dayId: null,
});

describe('buildTimeline', () => {
  it('puts the day in order of time, untimed first, with the doses ticked together in one row', () => {
    const day = '2026-10-26';
    const rows = buildTimeline(
      [workout(7, day, '18:32', '19:34'), volley(day, '20:30'), { ...volley(day, null), key: 'a9' }],
      [
        { supplementId: 1, date: day, takenAt: at(day, '08:12') },
        { supplementId: 2, date: day, takenAt: at(day, '08:20') },
        { supplementId: 3, date: day, takenAt: at(day, '13:05') },
        // Ticked the next morning: no time of its own.
        { supplementId: 4, date: day, takenAt: at('2026-10-27', '09:00') },
      ],
    );
    expect(rows.map((r) => [r.kind, r.time])).toEqual([
      ['item', null],
      ['doses', null],
      ['doses', '08:12'],
      ['doses', '13:05'],
      ['item', '18:32'],
      ['item', '20:30'],
    ]);
    expect(rows[2]).toMatchObject({ supplementIds: [1, 2] });
    expect(rows[1]).toMatchObject({ supplementIds: [4] });
  });
});

describe('averageClock', () => {
  it('averages times on a clock', () => {
    expect(averageClock([])).toBeNull();
    expect(averageClock(['18:00', '19:00'])).toBe('18:30');
    expect(averageClock(['23:50', '00:10'])).toBe('00:00');
    expect(averageClock(['07:15'])).toBe('07:15');
  });
});

describe('times', () => {
  it('takes the start of finished workouts and the ticks made on their own day', () => {
    const agenda = new Map<string, AgendaItem[]>([
      ['2026-10-26', [workout(1, '2026-10-26', '18:00', '19:00')]],
      ['2026-10-28', [workout(2, '2026-10-28', '07:30', null)]],
      ['2026-11-02', [workout(3, '2026-11-02', '19:00', '20:00')]],
    ]);
    expect(workoutTimes(agenda, '2026-10-26', '2026-11-01')).toEqual(['18:00']);
    expect(
      tickTimes([
        { supplementId: 1, date: '2026-10-26', takenAt: at('2026-10-26', '08:00') },
        { supplementId: 1, date: '2026-10-25', takenAt: at('2026-10-26', '08:01') },
      ]),
    ).toEqual(['08:00']);
    expect(partsOfDay(['07:30', '12:00', '17:59', '18:00', '21:00'])).toEqual({ morning: 1, afternoon: 2, evening: 2 });
  });
});
