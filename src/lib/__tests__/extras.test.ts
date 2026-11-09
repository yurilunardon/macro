import { describe, expect, it } from 'vitest';

import { toCsv } from '../csv';
import { formatPortions, portionName } from '../format';
import { measurementChanges } from '../measurements';
import { formatTime, parseTime } from '../reminders';

describe('toCsv', () => {
  it('writes Italian-style CSV that Excel opens correctly', () => {
    const csv = toCsv(['Data', 'Alimento', 'kcal'], [
      ['2026-10-31', 'Pasta; al "pomodoro"', 287.234],
      ['2026-10-31', 'Caffè', null],
    ]);
    expect(csv).toBe('﻿Data;Alimento;kcal\r\n2026-10-31;"Pasta; al ""pomodoro""";287,23\r\n2026-10-31;Caffè;\r\n');
  });
});

describe('portions', () => {
  it('names a serving without its amount', () => {
    expect(portionName('1 barretta (32 g)')).toBe('barretta');
    expect(portionName('85 g')).toBeNull();
    expect(portionName(null)).toBeNull();
  });

  it('counts servings in words', () => {
    expect(formatPortions(1, 'barretta')).toBe('1 barretta');
    expect(formatPortions(3, 'barretta')).toBe('3 barrette');
    expect(formatPortions(2, 'mela media')).toBe('2 mele medie');
    expect(formatPortions(2, 'fetta di pane')).toBe('2 fette di pane');
    expect(formatPortions(2, 'cucchiaio')).toBe('2 cucchiai');
    expect(formatPortions(1.5, null)).toBe('1,5 porzioni');
    expect(formatPortions(0.5, 'barretta')).toBe('½ barretta');
  });
});

describe('reminders', () => {
  it('reads times typed in different ways', () => {
    expect(parseTime('7:30')).toEqual({ hour: 7, minute: 30 });
    expect(parseTime('21.05')).toEqual({ hour: 21, minute: 5 });
    expect(parseTime('730')).toEqual({ hour: 7, minute: 30 });
    expect(parseTime('9')).toEqual({ hour: 9, minute: 0 });
    expect(parseTime('25:00')).toBeNull();
    expect(parseTime('7:75')).toBeNull();
    expect(parseTime('presto')).toBeNull();
    expect(formatTime(7, 5)).toBe('07:05');
  });

});

describe('measurementChanges', () => {
  it('reports the latest value and the change in the period', () => {
    const changes = measurementChanges(
      [
        { date: '2026-09-01', kind: 'waist', value: 90 },
        { date: '2026-10-01', kind: 'waist', value: 88 },
        { date: '2026-10-30', kind: 'waist', value: 86.5 },
        { date: '2026-10-30', kind: 'arm', value: 38 },
      ],
      '2026-10-01',
    );
    expect(changes.map((c) => [c.kind, c.latest.value, c.change])).toEqual([
      ['waist', 86.5, -1.5],
      ['arm', 38, null],
    ]);
  });
});
