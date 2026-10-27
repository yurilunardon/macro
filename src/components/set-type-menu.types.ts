import type { SetType } from '@/lib/training';

export type SetTypeMenuProps = {
  /** What the badge shows: the set number, or R / D / C. */
  badge: string;
  type: SetType;
  done: boolean;
  /** The set to do now: the number sits in a filled circle, as today in the week strip. */
  current?: boolean;
  onChange: (type: SetType) => void;
  onDelete: () => void;
};
