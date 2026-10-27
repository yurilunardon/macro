import { StyleSheet } from 'react-native';

import { DatePicker, Host } from '@expo/ui/swift-ui';
import { accessibilityLabel as a11yLabel, datePickerStyle, labelsHidden, tint } from '@expo/ui/swift-ui/modifiers';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

import type { TimePickerProps } from './time-picker.types';

/** The iOS time pill, as in Clock and Settings: tapping it opens the wheels. */
export function TimePicker({ hour, minute, onChange, accessibilityLabel }: TimePickerProps) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const selection = new Date();
  selection.setHours(hour, minute, 0, 0);
  return (
    // A fixed size: a host that measured its content would start at 0 × 0 and make the row jump.
    <Host style={styles.host} colorScheme={scheme === 'dark' ? 'dark' : 'light'}>
      <DatePicker
        selection={selection}
        displayedComponents={['hourAndMinute']}
        onDateChange={(date) => onChange({ hour: date.getHours(), minute: date.getMinutes() })}
        modifiers={[datePickerStyle('compact'), labelsHidden(), tint(theme.accent), a11yLabel(accessibilityLabel)]}
      />
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { width: 84, height: 36 },
});
