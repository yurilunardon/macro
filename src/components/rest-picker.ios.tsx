import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Host, HStack, Picker, Popover, Text, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  contentShape,
  font,
  foregroundStyle,
  frame,
  onTapGesture,
  opacity,
  padding,
  pickerStyle,
  shapes,
  tag,
} from '@expo/ui/swift-ui/modifiers';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { formatDuration } from '@/lib/training';

import { AppText } from './app-text';
import { Icon } from './icon';
import { REST_MAX_MINUTES, REST_STEP, type RestPickerProps } from './rest-picker.types';

const MINUTES = Array.from({ length: REST_MAX_MINUTES + 1 }, (_, i) => i);
const SECONDS = Array.from({ length: 60 / REST_STEP }, (_, i) => i * REST_STEP);

/**
 * The rest after each set, as a small pill: tapping it opens a popover with a minutes and a
 * seconds wheel, as in the Timer of Clock, for any rest rather than a few presets. The pill
 * follows the wheels as they turn, and each value is kept as soon as it is picked.
 */
export function RestPicker({ value, onChange }: RestPickerProps) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState(Math.floor(value / 60));
  const [seconds, setSeconds] = useState(Math.round((value % 60) / REST_STEP) * REST_STEP);

  // No rest at all would end it the moment a set is ticked: the shortest is one step.
  const total = Math.max(REST_STEP, minutes * 60 + seconds);
  const shown = open ? total : value;

  const present = (next: boolean) => {
    if (next) {
      setMinutes(Math.floor(value / 60));
      setSeconds(Math.round((value % 60) / REST_STEP) * REST_STEP);
    }
    setOpen(next);
  };

  const pick = (m: number, s: number) => {
    setMinutes(m);
    setSeconds(s);
    const next = Math.max(REST_STEP, m * 60 + s);
    if (next !== value) onChange(next);
  };

  return (
    <View>
      <View style={[styles.pill, { backgroundColor: theme.fill }]}>
        <Icon name="timer" size={13} tone="textSecondary" />
        <AppText variant="subhead" weight="600" numeric>
          {formatDuration(shown)}
        </AppText>
      </View>
      <Host style={StyleSheet.absoluteFill} colorScheme={scheme === 'dark' ? 'dark' : 'light'}>
        <Popover isPresented={open} onIsPresentedChange={present} arrowEdge="bottom">
          <Popover.Trigger>
            <HStack
              modifiers={[
                frame({ maxWidth: 1000, maxHeight: 1000 }),
                contentShape(shapes.rectangle()),
                onTapGesture(() => present(true)),
                accessibilityLabel(`Recupero dopo ogni serie: ${formatDuration(value)}. Cambia`),
                // SwiftUI ignores taps on fully transparent views, hence the tiny opacity.
                opacity(0.02),
              ]}>
              <Text>{formatDuration(value)}</Text>
            </HStack>
          </Popover.Trigger>
          <Popover.Content>
            <VStack spacing={4} modifiers={[padding({ top: 14, horizontal: 12, bottom: 4 })]}>
              <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(theme.textSecondary)]}>
                Recupero dopo ogni serie
              </Text>
              <HStack spacing={0}>
                <Picker
                  selection={minutes}
                  onSelectionChange={(m) => pick(m, seconds)}
                  modifiers={[pickerStyle('wheel'), frame({ width: 110, height: 150 })]}>
                  {MINUTES.map((m) => (
                    <Text key={m} modifiers={[tag(m)]}>
                      {`${m} min`}
                    </Text>
                  ))}
                </Picker>
                <Picker
                  selection={seconds}
                  onSelectionChange={(s) => pick(minutes, s)}
                  modifiers={[pickerStyle('wheel'), frame({ width: 110, height: 150 })]}>
                  {SECONDS.map((s) => (
                    <Text key={s} modifiers={[tag(s)]}>
                      {`${s} s`}
                    </Text>
                  ))}
                </Picker>
              </HStack>
            </VStack>
          </Popover.Content>
        </Popover>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 32, paddingHorizontal: 12, borderRadius: 16 },
});
