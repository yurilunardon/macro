import { useState } from 'react';
import { StyleSheet, TextInput, type StyleProp, type TextStyle } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type EditableTitleProps = {
  value: string;
  /** Called with the new name, trimmed and not empty, when editing ends. */
  onChange: (name: string) => void;
  accessibilityLabel: string;
  style?: StyleProp<TextStyle>;
};

/**
 * The name of a list as the big title at the top of the page, renamed by tapping it, as in
 * Reminders: no menu or dialog in between.
 */
export function EditableTitle({ value, onChange, accessibilityLabel, style }: EditableTitleProps) {
  const theme = useTheme();
  const [text, setText] = useState(value);
  const [editing, setEditing] = useState(false);

  const save = () => {
    setEditing(false);
    const name = text.trim();
    if (name === '' || name === value) {
      setText(value);
      return;
    }
    onChange(name);
  };

  return (
    <TextInput
      value={editing ? text : value}
      onChangeText={setText}
      onFocus={() => {
        setText(value);
        setEditing(true);
      }}
      onEndEditing={save}
      returnKeyType="done"
      submitBehavior="blurAndSubmit"
      autoCorrect={false}
      multiline={false}
      maxLength={60}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Tocca per rinominare"
      style={[styles.title, { color: theme.text }, style]}
    />
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 34,
    lineHeight: 41,
    fontWeight: '700',
    paddingHorizontal: Spacing.xs,
    paddingVertical: 0,
    marginBottom: Spacing.md,
  },
});
