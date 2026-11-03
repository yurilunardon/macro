/**
 * A day as rows of hours, as the day view in Calendar, but each row as tall as what starts in it, so
 * what is planned never overlaps and an empty hour takes little room. Pure, so it is tested without
 * drawing.
 */

/** Something at a time of the day, in minutes from midnight. */
export type HourBlock<T> = { key: string; start: number; end: number; value: T };

/** The hours from `hour` to `until`, more than one when a block covers them, and what starts in them. */
export type HourRow<T> = { hour: number; until: number; blocks: HourBlock<T>[] };

/** At least this stretch of the day is shown, widened to whatever falls outside it. */
const FIRST_HOUR = 7;
const LAST_HOUR = 23;

export function hourRows<T>(blocks: readonly HourBlock<T>[]): HourRow<T>[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  const from = Math.min(FIRST_HOUR, ...sorted.map((b) => Math.floor(b.start / 60)));
  const to = Math.min(24, Math.max(LAST_HOUR, ...sorted.map((b) => Math.ceil(Math.max(b.start + 1, b.end) / 60))));
  const rows: HourRow<T>[] = [];
  for (let hour = from; hour < to; ) {
    let until = hour + 1;
    let inside = sorted.filter((b) => b.start >= hour * 60 && b.start < until * 60);
    // An hour wholly covered by a block has no row of its own: a line for it would cut the block.
    for (;;) {
      const covered = Math.floor(Math.max(0, ...inside.map((b) => b.end)) / 60);
      if (covered <= until) break;
      until = covered;
      inside = sorted.filter((b) => b.start >= hour * 60 && b.start < until * 60);
    }
    rows.push({ hour, until, blocks: inside });
    hour = until;
  }
  return rows;
}

/** Where a time falls in a row, from 0 at its top to 1 at its bottom; null if not in it. */
export function placeInRow(row: Pick<HourRow<unknown>, 'hour' | 'until'>, minute: number): number | null {
  if (minute < row.hour * 60 || minute >= row.until * 60) return null;
  return (minute - row.hour * 60) / ((row.until - row.hour) * 60);
}
