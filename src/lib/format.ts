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

/**
 * What one serving is called, e.g. "barretta" from "1 barretta (32 g)": without the amount in
 * brackets and the leading "1". Null when the label is only an amount ("85 g") or empty.
 */
export function portionName(label: string | null): string | null {
  const name = (label ?? '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/^1\s+/, '')
    .trim();
  if (name === '' || /^[\d.,\s]+(g|gr|ml|cl|l)?\.?$/i.test(name)) return null;
  return name;
}

/** Italian plural of a word, the regular way: barretta → barrette, vasetto → vasetti, cucchiaio → cucchiai. */
function plural(word: string): string {
  if (/io$/.test(word)) return word.slice(0, -1);
  if (/a$/.test(word)) return `${word.slice(0, -1)}e`;
  if (/[oe]$/.test(word)) return `${word.slice(0, -1)}i`;
  return word;
}

/**
 * "1 barretta", "3 barrette", "2 mele medie", "2 fette di pane", "1,5 porzioni": a number of
 * servings in words. Only the words before the first short one ("di", "da") change.
 */
export function formatPortions(count: number, name: string | null): string {
  const amount = count === 0.5 ? '½' : formatNumber(count, 2);
  if (!name) return `${amount} ${count <= 1 ? 'porzione' : 'porzioni'}`;
  if (count <= 1) return `${amount} ${name}`;
  let stopped = false;
  const words = name.split(/\s+/).map((word) => {
    if (stopped || word.length <= 3) {
      stopped = true;
      return word;
    }
    return plural(word);
  });
  return `${amount} ${words.join(' ')}`;
}

/** "1 alimento", "3 alimenti". */
export function countLabel(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
