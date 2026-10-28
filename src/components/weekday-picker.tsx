import { Pressable, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { WEEKDAYS_FROM_MONDAY } from '@/lib/calendar';
import { haptics } from '@/services/haptics';

import { AppText } from './app-text';

const LETTERS = ['D', 'L', 'M', 'M', 'G', 'V', 'S'];
const NAMES = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

/** The days of the week as circles to tick, Monday first, as when repeating an alarm in Clock. */
export function WeekdayPicker({ value, onChange }: { value: readonly number[]; onChange: (days: number[]) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      {WEEKDAYS_FROM_MONDAY.map((day) => {
        const on = value.includes(day);
        return (
          <Pressable
            key={day}
            onPress={() => {
              haptics.selection();
              onChange(on ? value.filter((d) => d !== day) : [...value, day]);
            }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={NAMES[day]}
            hitSlop={2}
            style={({ pressed }) => [
              styles.day,
              { backgroundColor: on ? theme.accent : theme.fill },
              pressed && { opacity: 0.6 },
            ]}>
            <AppText variant="subhead" weight="600" style={{ color: on ? theme.onAccent : theme.text }}>
              {LETTERS[day]}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  day: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
