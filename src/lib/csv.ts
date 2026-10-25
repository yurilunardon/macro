/**
 * CSV for Excel and Numbers set to Italian: semicolon separators, decimal comma, and a byte
 * order mark so accented letters open correctly.
 */

export type CsvValue = string | number | null;

function cell(value: CsvValue): string {
  if (value === null) return '';
  const text = typeof value === 'number' ? String(Math.round(value * 100) / 100).replace('.', ',') : value;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [header, ...rows].map((row) => row.map(cell).join(';'));
  return `﻿${lines.join('\r\n')}\r\n`;
}
