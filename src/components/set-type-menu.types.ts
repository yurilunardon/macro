import type { SetType } from '@/lib/training';

export type SetTypeMenuProps = {
  /** What the badge shows: the set number, or R / D / C. */
  badge: string;
  type: SetType;
  done: boolean;
  onChange: (type: SetType) => void;
  onDelete: () => void;
};
