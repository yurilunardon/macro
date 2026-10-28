import { StyleSheet } from 'react-native';

import { DatePicker as SwiftDatePicker, Host } from '@expo/ui/swift-ui';
import { accessibilityLabel as a11yLabel, datePickerStyle, labelsHidden, tint } from '@expo/ui/swift-ui/modifiers';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { fromDateKey, toDateKey } from '@/lib/dates';

import type { DatePickerProps } from './date-picker.types';

/** The iOS date pill, as in Calendar's new event: tapping it opens the month. */
export function DatePicker({ value, onChange, accessibilityLabel }: DatePickerProps) {
  const theme = useTheme();
  const scheme = useColorScheme();
  return (
    // A fixed size, as the time pill: a host that measured its content would make the row jump.
    <Host style={styles.host} colorScheme={scheme === 'dark' ? 'dark' : 'light'}>
      <SwiftDatePicker
        selection={fromDateKey(value)}
        displayedComponents={['date']}
        onDateChange={(date) => onChange(toDateKey(date))}
        modifiers={[datePickerStyle('compact'), labelsHidden(), tint(theme.accent), a11yLabel(accessibilityLabel)]}
      />
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { width: 132, height: 36 },
});
