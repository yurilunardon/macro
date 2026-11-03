import { describe, expect, it } from 'vitest';

import { hourRows, placeInRow } from '../day-hours';

const block = (key: string, start: number, end = start) => ({ key, start, end, value: key });
const at = (hour: number, minute = 0) => hour * 60 + minute;

describe('hourRows', () => {
  it('shows the usual stretch of the day with nothing planned', () => {
    const rows = hourRows([]);
    expect(rows[0].hour).toBe(7);
    expect(rows[rows.length - 1].until).toBe(23);
    expect(rows.every((r) => r.until === r.hour + 1)).toBe(true);
  });

  it('puts each thing in the hour it starts in', () => {
    const rows = hourRows([block('creatina', at(7, 30)), block('pranzo', at(13))]);
    expect(rows.find((r) => r.hour === 7)?.blocks.map((b) => b.key)).toEqual(['creatina']);
    expect(rows.find((r) => r.hour === 13)?.blocks.map((b) => b.key)).toEqual(['pranzo']);
    expect(rows.find((r) => r.hour === 8)?.blocks).toEqual([]);
  });

  it('gives no row to an hour a block covers whole', () => {
    const rows = hourRows([block('pallavolo', at(21), at(23))]);
    const row = rows.find((r) => r.hour === 21);
    expect(row?.until).toBe(23);
    expect(rows.some((r) => r.hour === 22)).toBe(false);
  });

  it('keeps the row of an hour covered only in part', () => {
    const rows = hourRows([block('push', at(21), at(22, 30)), block('whey', at(22, 30))]);
    expect(rows.find((r) => r.hour === 22)?.blocks.map((b) => b.key)).toEqual(['whey']);
  });

  it('keeps what starts inside a long block', () => {
    const rows = hourRows([block('partita', at(19), at(22)), block('integratore', at(20, 15))]);
    const row = rows.find((r) => r.hour === 19);
    expect(row?.until).toBe(22);
    expect(row?.blocks.map((b) => b.key)).toEqual(['partita', 'integratore']);
  });

  it('widens to whatever falls outside the usual hours', () => {
    const rows = hourRows([block('presto', at(5, 40)), block('tardi', at(23, 30), at(23, 50))]);
    expect(rows[0].hour).toBe(5);
    expect(rows[rows.length - 1].until).toBe(24);
  });
});

describe('placeInRow', () => {
  it('says where a time falls in its row', () => {
    expect(placeInRow({ hour: 14, until: 15 }, at(14, 15))).toBe(0.25);
    expect(placeInRow({ hour: 21, until: 23 }, at(22))).toBe(0.5);
    expect(placeInRow({ hour: 14, until: 15 }, at(15))).toBeNull();
  });
});
