import { AppText } from './app-text';
import type { TimePickerProps } from './time-picker.types';

/** The time, read only, where the iOS time pill is not available. */
export function TimePicker({ hour, minute, accessibilityLabel }: TimePickerProps) {
  return (
    <AppText numeric accessibilityLabel={accessibilityLabel}>
      {`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`}
    </AppText>
  );
}
