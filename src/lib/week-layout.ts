/**
 * Where things go in the week's grid, as in Calendar's week view: the hours to show, and side by
 * side columns for what overlaps on a day. Pure, so it is tested without drawing.
 */

/** Something with a start and an end, in minutes from midnight. */
export type Span = { start: number; end: number };

/** Minutes from midnight of "18:30". */
export function minutesOfClock(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * The hours the grid shows: at least `from` to `to`, widened to whatever falls outside, in whole
 * hours within the day.
 */
export function hourRange(spans: readonly Span[], from = 7, to = 22): { from: number; to: number } {
  let start = from * 60;
  let end = to * 60;
  for (const s of spans) {
    start = Math.min(start, s.start);
    end = Math.max(end, s.end);
  }
  return { from: Math.max(0, Math.floor(start / 60)), to: Math.min(24, Math.ceil(end / 60)) };
}

/**
 * Side by side columns for spans that overlap, as Calendar draws events at the same time: each
 * gets the first column free at its start, and every span of a group of overlapping ones shares
 * the group's number of columns.
 */
export function placeInLanes<T extends Span>(spans: readonly T[]): (T & { lane: number; lanes: number })[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const placed: (T & { lane: number; lanes: number })[] = [];
  let group: (T & { lane: number; lanes: number })[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -Infinity;
  const close = () => {
    for (const s of group) s.lanes = laneEnds.length;
    group = [];
    laneEnds = [];
  };
  for (const span of sorted) {
    if (span.start >= groupEnd) {
      close();
      groupEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((end) => end <= span.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(span.end);
    } else {
      laneEnds[lane] = span.end;
    }
    const item = { ...span, lane, lanes: 1 };
    group.push(item);
    placed.push(item);
    groupEnd = Math.max(groupEnd, span.end);
  }
  close();
  return placed;
}
