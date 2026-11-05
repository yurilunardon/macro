/**
 * A day as in Calendar: the hours at their true scale, so a distance is a length of time, and what
 * overlaps side by side. Pure, so it is tested without drawing.
 */
import { placeInLanes } from './week-layout';

export const HOUR_HEIGHT = 56;
/** The hours' labels, to the left of the blocks. */
export const GUTTER = 48;
/** What moves in the day moves by a quarter of an hour. */
export const SNAP_MINUTES = 15;
/** Earlier than this only when something is there: nothing in the user's day falls so early. */
const USUAL_FIRST_HOUR = 6;
/** Something with no length of its own, as a dose, takes the room of half an hour. */
const LEAST_MINUTES = 30;

export function firstHourFor(starts: readonly number[]): number {
  return Math.min(USUAL_FIRST_HOUR, ...starts.map((s) => Math.floor(s / 60)));
}

export function gridHeight(firstHour: number): number {
  return (24 - firstHour) * HOUR_HEIGHT;
}

export function yOfMinute(minute: number, firstHour: number): number {
  'worklet';
  return ((minute - firstHour * 60) / 60) * HOUR_HEIGHT;
}

export function minuteOfY(y: number, firstHour: number): number {
  'worklet';
  return firstHour * 60 + (y / HOUR_HEIGHT) * 60;
}

/** To the nearest quarter of an hour, so that what lasts `minutes` stays within the day. */
export function snapMinute(minute: number, minutes = 0): number {
  'worklet';
  return Math.max(0, Math.min(24 * 60 - Math.max(minutes, SNAP_MINUTES), Math.round(minute / SNAP_MINUTES) * SNAP_MINUTES));
}

export type Placed<T> = T & { top: number; height: number; left: number; width: number };

/** Where each thing goes in a day `width` wide, side by side when they overlap. */
export function placeBlocks<T extends { start: number; minutes: number }>(blocks: readonly T[], firstHour: number, width: number): Placed<T>[] {
  const spans = blocks.map((b) => ({ ...b, end: b.start + Math.max(b.minutes, LEAST_MINUTES), block: b }));
  return placeInLanes(spans).map((s) => {
    const lane = width / s.lanes;
    return {
      ...s.block,
      top: yOfMinute(s.start, firstHour) + 1,
      height: Math.max(HOUR_HEIGHT / 2, (s.block.minutes / 60) * HOUR_HEIGHT) - 2,
      left: s.lane * lane,
      width: lane - (s.lanes > 1 ? 2 : 0),
    };
  });
}

/** "16:15" from minutes since midnight. */
export function clockOfMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
