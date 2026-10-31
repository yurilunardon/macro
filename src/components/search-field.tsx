import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Icon } from './icon';

type SearchFieldProps = Pick<TextInputProps, 'onSubmitEditing' | 'accessibilityLabel'> & {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
};

/**
 * A search field in the page, as at the top of a list in Settings or Contacts: part of the page
 * from its first frame, never waiting on the navigation bar to dress it.
 */
export function SearchField({ value, onChangeText, placeholder, onSubmitEditing, accessibilityLabel }: SearchFieldProps) {
  const theme = useTheme();
  return (
    <View style={[styles.field, { backgroundColor: theme.track }]}>
      <Icon name="magnifyingglass" size={17} tone="textSecondary" />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        returnKeyType="search"
        onSubmitEditing={onSubmitEditing}
        autoCorrect={false}
        clearButtonMode="while-editing"
        accessibilityLabel={accessibilityLabel ?? placeholder}
        style={[styles.input, { color: theme.text }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.lg,
  },
  input: { flex: 1, fontSize: 17, paddingVertical: Spacing.md - 2 },
});
