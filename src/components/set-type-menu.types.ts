import type { SetType } from '@/lib/training';

export type SetTypeMenuProps = {
  /** What the badge shows: the set number, or R / D / C. */
  badge: string;
  type: SetType;
  done: boolean;
  /** The set to do now: the number sits in a filled circle, as today in the week strip. */
  current?: boolean;
  onChange: (type: SetType) => void;
  /**
   * Drawn exactly as it looks, without the native menu behind it: while the screen is still
   * sliding in, when a SwiftUI view per set would make the animation stutter.
   */
  inert?: boolean;
  onDelete: () => void;
};
