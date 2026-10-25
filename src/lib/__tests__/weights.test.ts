import { describe, expect, it } from 'vitest';

import { formatNumber } from '../format';
import { formatChange, groupByMonth, withChanges } from '../weights';

describe('withChanges', () => {
  it('lists the newest first, each compared with the weigh-in before', () => {
    expect(
      withChanges([
        { date: '2026-10-20', kg: 80 },
        { date: '2026-10-25', kg: 79.4 },
        { date: '2026-10-22', kg: 79.8 },
      ]),
    ).toEqual([
      { date: '2026-10-25', kg: 79.4, change: expect.closeTo(-0.4) },
      { date: '2026-10-22', kg: 79.8, change: expect.closeTo(-0.2) },
      { date: '2026-10-20', kg: 80, change: null },
    ]);
  });
});

describe('groupByMonth', () => {
  it('groups consecutive days of the same month under its name', () => {
    const groups = groupByMonth([{ date: '2026-10-25' }, { date: '2026-10-02' }, { date: '2026-09-30' }]);
    expect(groups.map((g) => [g.title, g.items.length])).toEqual([
      ['Ottobre 2026', 2],
      ['Settembre 2026', 1],
    ]);
  });
});

describe('formatChange', () => {
  it('uses a real minus sign and ± for no change', () => {
    expect(formatChange(-0.4, 'kg', (n) => formatNumber(n, 1))).toBe('−0,4 kg');
    expect(formatChange(1.25, 'kg', (n) => formatNumber(n, 1))).toBe('+1,3 kg');
    expect(formatChange(0, 'cm', (n) => formatNumber(n, 1))).toBe('±0 cm');
  });
});
