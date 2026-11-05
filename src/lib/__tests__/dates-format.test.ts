import { describe, expect, it } from 'vitest';

import { addDays, dayInMonth, daysBetween, formatDaySubtitle, formatDayTitle, fromDateKey, isDateKey, lastDays, monthAt, monthGrid, monthNumber, monthOf, monthWeeks, toDateKey, weekdayOf } from '../dates';
import { formatGrams, formatNumber, numberToInput, parseDecimal, servingPresetLabel } from '../format';

describe('date keys', () => {
  it('round-trips a local day', () => {
    expect(toDateKey(fromDateKey('2026-10-25'))).toBe('2026-10-25');
  });

  it('adds days across month, year and DST boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-29', -1)).toBe('2026-03-28');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
  });

  it('counts days between keys', () => {
    expect(daysBetween('2026-10-20', '2026-10-25')).toBe(5);
    expect(daysBetween('2026-10-25', '2026-10-20')).toBe(-5);
  });

  it('lists the last days oldest first', () => {
    expect(lastDays('2026-10-25', 3)).toEqual(['2026-10-23', '2026-10-24', '2026-10-25']);
  });

  it('knows the day of the week', () => {
    expect(weekdayOf('2026-10-25')).toBe(0);
    expect(weekdayOf('2026-10-26')).toBe(1);
  });

  it('validates keys', () => {
    expect(isDateKey('2026-10-25')).toBe(true);
    expect(isDateKey('25/10/2026')).toBe(false);
    expect(isDateKey(42)).toBe(false);
  });

  it('names nearby days', () => {
    expect(formatDayTitle('2026-10-25', '2026-10-25')).toBe('Oggi');
    expect(formatDayTitle('2026-10-24', '2026-10-25')).toBe('Ieri');
    expect(formatDayTitle('2026-10-26', '2026-10-25')).toBe('Domani');
    expect(formatDayTitle('2026-10-20', '2026-10-25')).toBe('Martedì 20 ottobre');
  });

  it('puts the date under nearby days and the distance under the others', () => {
    expect(formatDaySubtitle('2026-10-25', '2026-10-25')).toBe('Domenica 25 ottobre');
    expect(formatDaySubtitle('2026-10-26', '2026-10-25')).toBe('Lunedì 26 ottobre');
    expect(formatDaySubtitle('2026-10-20', '2026-10-25')).toBe('5 giorni fa');
    expect(formatDaySubtitle('2026-10-28', '2026-10-25')).toBe('Tra 3 giorni');
  });
});

describe('number input and output', () => {
  it('accepts comma and dot decimals', () => {
    expect(parseDecimal('12,5')).toBe(12.5);
    expect(parseDecimal(' 80 ')).toBe(80);
    expect(parseDecimal('0.25')).toBe(0.25);
    expect(parseDecimal(',5')).toBe(0.5);
  });

  it('rejects text that is not a number', () => {
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('abc')).toBeNull();
    expect(parseDecimal('1,2,3')).toBeNull();
    expect(parseDecimal('12g')).toBeNull();
  });

  it('formats with an Italian decimal comma', () => {
    expect(formatNumber(12.34, 1)).toBe('12,3');
    expect(formatGrams(0.44)).toBe('0,4 g');
    expect(formatGrams(56.8)).toBe('57 g');
  });

  it('prepares stored numbers for an input field', () => {
    expect(numberToInput(12.5)).toBe('12,5');
    expect(numberToInput(80)).toBe('80');
    expect(numberToInput(null)).toBe('');
  });
});

describe('servingPresetLabel', () => {
  it('uses descriptive labels and drops ones that repeat the amount', () => {
    expect(servingPresetLabel(180, '1 mela media', 'g')).toBe('1 mela media · 180 g');
    expect(servingPresetLabel(85, '85 g', 'g')).toBe('1 porzione · 85 g');
    expect(servingPresetLabel(10, '1 biscotto (10 g)', 'g')).toBe('1 biscotto · 10 g');
    expect(servingPresetLabel(12.5, null, 'ml')).toBe('1 porzione · 12,5 ml');
    expect(servingPresetLabel(30, 'una porzione molto abbondante di cereali', 'g')).toBe('una porzione molto abbondan… · 30 g');
  });
});

describe('months in the calendar', () => {
  it('counts months with numbers, there and back', () => {
    expect(monthNumber('2026-11') + 2).toBe(monthNumber('2027-01'));
    expect(monthAt(monthNumber('2026-12'))).toBe('2026-12');
    expect(monthAt(monthNumber('2027-01'))).toBe('2027-01');
  });

  it('gives each month as many weeks as its grid has with days of it', () => {
    for (let number = monthNumber('2026-01'); number <= monthNumber('2028-12'); number++) {
      const month = monthAt(number);
      const days = monthGrid(month);
      const weeks = Array.from({ length: 6 }, (_, i) => days.slice(i * 7, i * 7 + 7)).filter((week) => week.some((day) => monthOf(day) === month));
      expect(monthWeeks(number)).toBe(weeks.length);
    }
    // February 2027 begins on a Monday: exactly four weeks.
    expect(monthWeeks(monthNumber('2027-02'))).toBe(4);
  });

  it('keeps the day when turning the month, the last one if it is shorter, today in today’s month', () => {
    expect(dayInMonth('2026-11-14', 1, '2026-11-05')).toBe('2026-12-14');
    expect(dayInMonth('2027-01-31', 1, '2026-11-05')).toBe('2027-02-28');
    expect(dayInMonth('2026-12-20', -1, '2026-11-05')).toBe('2026-11-05');
  });
});
