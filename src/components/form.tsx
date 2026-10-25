import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/services/haptics';

import { AppText } from './app-text';

type FieldRowProps = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  /** Unit shown after the value, e.g. "g" or "kcal". */
  suffix?: string;
  numeric?: boolean;
  invalid?: boolean;
} & Pick<TextInputProps, 'autoFocus' | 'autoCapitalize' | 'returnKeyType' | 'onSubmitEditing' | 'selectTextOnFocus'>;

/** Label on the left, input on the right: for rows inside a ListGroup. */
export function FieldRow({
  label,
  value,
  onChangeText,
  placeholder,
  suffix,
  numeric = false,
  invalid = false,
  ...inputProps
}: FieldRowProps) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <AppText style={styles.label} tone={invalid ? 'danger' : 'text'}>
        {label}
      </AppText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textTertiary}
        keyboardType={numeric ? 'decimal-pad' : 'default'}
        // The number pad has no return key: iOS then shows a toolbar with this button.
        inputAccessoryViewButtonLabel={numeric ? 'Fine' : undefined}
        accessibilityLabel={label}
        style={[styles.input, { color: invalid ? theme.danger : theme.text }, !numeric && styles.textInput]}
        {...inputProps}
      />
      {suffix ? (
        <AppText tone="textSecondary" style={styles.suffix}>
          {suffix}
        </AppText>
      ) : null}
    </View>
  );
}

export { Segmented } from './segmented';

type ChipProps = { label: string; selected?: boolean; onPress: () => void };

export function Chip({ label, selected = false, onPress }: ChipProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? theme.accent : theme.card, borderColor: selected ? theme.accent : theme.separator },
        pressed && { opacity: 0.7 },
      ]}>
      <AppText variant="subhead" weight="600" numeric style={{ color: selected ? theme.onAccent : theme.text }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  label: { flexShrink: 0, maxWidth: '55%' },
  input: {
    flex: 1,
    fontSize: 17,
    textAlign: 'right',
    paddingVertical: Spacing.md,
    fontVariant: ['tabular-nums'],
  },
  textInput: { fontVariant: [] },
  suffix: { minWidth: 28 },
  chip: {
    minHeight: 36,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
