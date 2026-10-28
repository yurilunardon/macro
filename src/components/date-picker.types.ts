import type { DateKey } from '@/lib/dates';

export type DatePickerProps = {
  value: DateKey;
  onChange: (date: DateKey) => void;
  accessibilityLabel: string;
};
