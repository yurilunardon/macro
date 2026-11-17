import type { Ref } from 'react';

import type { Muscle } from '@/lib/exercises';
import type { MusclePart } from '@/lib/muscle-parts';
import type { MuscleLevel } from '@/lib/program-check';

/** The part of the screen the muscle's sheet takes: the figure keeps the muscle above it. */
export const MUSCLE_SHEET = 0.56;

/** What the page of the figure is told: the theme and how each muscle is doing. */
export type BodyFigureState = {
  dark: boolean;
  /** By muscle, and by part for the muscles drawn in parts. */
  levels: Partial<Record<Muscle | MusclePart, MuscleLevel>>;
  /** Points of the figure's view covered by something above and below it. */
  top: number;
  bottom: number;
  /** The share of the figure's view the muscle's sheet covers once open. */
  sheet: number;
};

export type BodyFigureHandle = {
  /** Brings a muscle forward, and one of its parts more, or with null goes back to the whole body. */
  select: (muscle: Muscle | null, part?: MusclePart | null) => void;
};

export type BodyFigureProps = {
  state: BodyFigureState;
  /** A muscle was tapped, on one of its parts for the muscles drawn in parts. */
  onSelect: (muscle: Muscle, part: MusclePart | null) => void;
  /** The device could not draw it. */
  onFail?: () => void;
  /** It is drawn and can be shown. */
  onReady?: () => void;
  ref?: Ref<BodyFigureHandle>;
};

export type BodyFigureMessage = { type: 'ready' } | { type: 'failed' } | { type: 'names'; shown: boolean } | { type: 'select'; muscle: string | null; part?: string | null };

export function parseBodyMessage(data: unknown): BodyFigureMessage | null {
  try {
    const message: unknown = typeof data === 'string' ? JSON.parse(data) : data;
    if (typeof message === 'object' && message !== null && 'type' in message) return message as BodyFigureMessage;
  } catch {
    // Not ours.
  }
  return null;
}
