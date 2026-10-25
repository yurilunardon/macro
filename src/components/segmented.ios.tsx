import { Host, Picker, Text } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { StyleSheet } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { haptics } from '@/services/haptics';

import type { SegmentedProps } from './segmented.types';

/** The system segmented control, whose selection slides from one segment to the next. */
export function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  const scheme = useColorScheme();
  return (
    <Host matchContents={{ vertical: true }} style={styles.host} colorScheme={scheme === 'dark' ? 'dark' : 'light'}>
      <Picker
        selection={value}
        onSelectionChange={(next: string) => {
          if (next === value) return;
          haptics.selection();
          onChange(next as T);
        }}
        modifiers={[pickerStyle('segmented')]}>
        {options.map((option) => (
          <Text key={option.key} modifiers={[tag(option.key)]}>
            {option.label}
          </Text>
        ))}
      </Picker>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { alignSelf: 'stretch' },
});
