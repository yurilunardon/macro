const formatters = new Map<number, Intl.NumberFormat>();

function formatter(decimals: number): Intl.NumberFormat {
  let f = formatters.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat('it-IT', { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
    formatters.set(decimals, f);
  }
  return f;
}

/** Italian number format with a decimal comma, e.g. 12.5 → "12,5". */
export function formatNumber(value: number, decimals = 1): string {
  return formatter(decimals).format(value);
}

export function formatKcal(value: number): string {
  return formatNumber(Math.round(value), 0);
}

/** Grams with one decimal under 10 g, none above: 0,4 g · 12 g. */
export function formatGrams(value: number): string {
  return `${formatNumber(value, Math.abs(value) < 10 ? 1 : 0)} g`;
}

/** Parses user input that may use a comma as decimal separator. Returns null if it is not a number. */
export function parseDecimal(input: string): number | null {
  const normalized = input.trim().replace(/\s/g, '').replace(',', '.');
  if (normalized === '' || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Turns a stored number back into text for an input field. */
export function numberToInput(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined) return '';
  return String(Number(value.toFixed(decimals))).replace('.', ',');
}

/**
 * Label of the "one serving" shortcut, e.g. "1 mela media · 180 g". Labels that only repeat
 * the amount ("85 g", or "1 biscotto (10 g)" from Open Food Facts) are shortened.
 */
export function servingPresetLabel(size: number, label: string | null, unit: string): string {
  const amount = `${formatNumber(size, 1)} ${unit}`;
  const name = (label ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (name === '' || /^[\d.,\s]+(g|gr|ml|cl|l)?\.?$/i.test(name)) return `1 porzione · ${amount}`;
  return `${name.length > 28 ? `${name.slice(0, 27)}…` : name} · ${amount}`;
}

/** "1 alimento", "3 alimenti". */
export function countLabel(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
