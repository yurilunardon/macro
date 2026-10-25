import { describe, expect, it } from 'vitest';

import { toCsv } from '../csv';
import { measurementChanges } from '../measurements';
import { expiryReminderAt, formatTime, parseTime } from '../reminders';

describe('toCsv', () => {
  it('writes Italian-style CSV that Excel opens correctly', () => {
    const csv = toCsv(['Data', 'Alimento', 'kcal'], [
      ['2026-10-31', 'Pasta; al "pomodoro"', 287.234],
      ['2026-10-31', 'Caffè', null],
    ]);
    expect(csv).toBe('﻿Data;Alimento;kcal\r\n2026-10-31;"Pasta; al ""pomodoro""";287,23\r\n2026-10-31;Caffè;\r\n');
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

  it('warns the evening before the expiry, or two hours before when it is late', () => {
    const expires = new Date(2026, 10, 2, 13, 0);
    expect(expiryReminderAt(expires, new Date(2026, 9, 31, 10, 0))).toEqual(new Date(2026, 10, 1, 20, 0));
    expect(expiryReminderAt(expires, new Date(2026, 10, 1, 22, 0))).toEqual(new Date(2026, 10, 2, 11, 0));
    expect(expiryReminderAt(expires, new Date(2026, 10, 2, 12, 0))).toBeNull();
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
