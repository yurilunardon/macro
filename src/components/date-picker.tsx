import { formatShortDate } from '@/lib/dates';

import { AppText } from './app-text';
import type { DatePickerProps } from './date-picker.types';

/** The date, read only, where the iOS date pill is not available. */
export function DatePicker({ value, accessibilityLabel }: DatePickerProps) {
  return (
    <AppText numeric accessibilityLabel={accessibilityLabel}>
      {formatShortDate(value)}
    </AppText>
  );
}
