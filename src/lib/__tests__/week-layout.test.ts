import { describe, expect, it } from 'vitest';

import { hourRange, minutesOfClock, placeInLanes } from '../week-layout';

describe('hourRange', () => {
  it('shows 7 to 22 unless something falls outside', () => {
    expect(hourRange([])).toEqual({ from: 7, to: 22 });
    expect(hourRange([{ start: minutesOfClock('06:40'), end: minutesOfClock('07:30') }])).toEqual({ from: 6, to: 22 });
    expect(hourRange([{ start: minutesOfClock('22:30'), end: minutesOfClock('23:15') }])).toEqual({ from: 7, to: 24 });
  });
});

describe('placeInLanes', () => {
  it('puts what overlaps side by side and the rest full width', () => {
    const placed = placeInLanes([
      { id: 'a', start: 600, end: 660 },
      { id: 'b', start: 630, end: 700 },
      { id: 'c', start: 665, end: 690 },
      { id: 'd', start: 800, end: 860 },
    ]);
    const byId = Object.fromEntries(placed.map((p) => [p.id, [p.lane, p.lanes]]));
    expect(byId).toEqual({ a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] });
  });
});
