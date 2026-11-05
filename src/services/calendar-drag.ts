import { useSyncExternalStore, type ComponentRef, type RefObject } from 'react';
import type { View } from 'react-native';

import type { AgendaItem } from '@/lib/calendar';
import type { DateKey } from '@/lib/dates';
import type { Placed } from '@/lib/day-grid';
import type { DayEntry } from '@/lib/plan';

/** Something in a day, as it is drawn and as what can be done with it. */
export type DayBlock = {
  key: string;
  name: string;
  /** Under the name, when there is room. */
  sub: string | null;
  start: number;
  minutes: number;
  color: string;
  item: AgendaItem | null;
  entry: DayEntry | null;
  done: boolean;
  skipped: boolean;
};

export type DayLayout = { firstHour: number; blocks: Placed<DayBlock>[]; grid: RefObject<ComponentRef<typeof View> | null> };

/** What each day on screen or kept ready has drawn, to tell what is under a finger. */
export const dayLayouts = new Map<DateKey, DayLayout>();

type DragState = {
  /** What has been lifted: gone from its day, drawn over everything until it is let go. */
  lifted: { date: DateKey; key: string } | null;
  /** "Nuovo" in its day, while the sheet asks what it is. */
  draft: { date: DateKey; minute: number; minutes: number } | null;
  /** What was just moved: it keeps its grab points until a tap elsewhere. */
  selected: { date: DateKey; key: string } | null;
  /** The day a lifted block is over, in the month or the week. */
  hover: DateKey | null;
};

let state: DragState = { lifted: null, draft: null, selected: null, hover: null };
let droppedAt = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const calendarDrag = {
  get: () => state,
  set(fields: Partial<DragState>): void {
    state = { ...state, ...fields };
    for (const listener of listeners) listener();
  },
  /** A finger let go just now: what is under it was not tapped. */
  markDropped(): void {
    droppedAt = Date.now();
  },
  justDropped: () => Date.now() - droppedAt < 350,
};

export function useLiftedKey(date: DateKey): string | null {
  return useSyncExternalStore(subscribe, () => (state.lifted?.date === date ? state.lifted.key : null));
}

export function useSelectedKey(date: DateKey): string | null {
  return useSyncExternalStore(subscribe, () => (state.selected?.date === date ? state.selected.key : null));
}

export function useDraftOn(date: DateKey): DragState['draft'] {
  return useSyncExternalStore(subscribe, () => (state.draft?.date === date ? state.draft : null));
}

export function useIsHovered(date: DateKey): boolean {
  return useSyncExternalStore(subscribe, () => state.hover === date);
}

export function useDraft(): DragState['draft'] {
  return useSyncExternalStore(subscribe, () => state.draft);
}
