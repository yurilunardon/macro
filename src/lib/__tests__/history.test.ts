import { describe, expect, it } from 'vitest';

import { formatRestGap, historyLine } from '../history';

describe('historyLine', () => {
  it('puts the days without training between two workouts', () => {
    // Fri 21, Wed 19, Mon 17 and Tue 11 November 2025.
    const line = historyLine([{ date: '2025-11-21' }, { date: '2025-11-19' }, { date: '2025-11-18' }, { date: '2025-11-11' }]);
    expect(line.map((i) => (i.kind === 'rest' ? i.gap.days : i.workout.date))).toEqual([
      '2025-11-21',
      1,
      '2025-11-19',
      '2025-11-18',
      6,
      '2025-11-11',
    ]);
    const gap = line[1];
    expect(gap.kind === 'rest' && gap.gap).toEqual({ days: 1, from: '2025-11-20', to: '2025-11-20' });
  });

  it('has nothing between two workouts of the same day', () => {
    expect(historyLine([{ date: '2025-11-21' }, { date: '2025-11-21' }]).filter((i) => i.kind === 'rest')).toEqual([]);
  });
});

describe('formatRestGap', () => {
  it('names the days', () => {
    expect(formatRestGap({ days: 1, from: '2025-11-20', to: '2025-11-20' })).toBe('Giovedì · riposo');
    expect(formatRestGap({ days: 2, from: '2025-11-19', to: '2025-11-20' })).toBe('Mercoledì e giovedì · riposo');
    expect(formatRestGap({ days: 4, from: '2025-11-17', to: '2025-11-20' })).toBe('Da lunedì a giovedì · 4 giorni di riposo');
    expect(formatRestGap({ days: 9, from: '2025-11-10', to: '2025-11-18' })).toBe('9 giorni di pausa');
  });
});
