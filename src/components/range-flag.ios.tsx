import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { Button, Host, Image, Popover, Text, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonStyle,
  contentShape,
  controlSize,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  onTapGesture,
  padding,
  shapes,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

import type { RangeFlagProps } from './range-flag.types';

/**
 * The "!" on the corner of a count outside the planned range. Tapping it opens a popover, as
 * the tips in Apple's apps, that says what it means and lets the set be reopened.
 */
export function RangeFlag({ title, message, onFix }: RangeFlagProps) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const [open, setOpen] = useState(false);
  return (
    // A fixed size: a host that measured its content would start at 0 × 0 and jump.
    <Host style={styles.host} colorScheme={scheme === 'dark' ? 'dark' : 'light'}>
      <Popover isPresented={open} onIsPresentedChange={setOpen} arrowEdge="bottom">
        <Popover.Trigger>
          <Image
            systemName="exclamationmark.circle.fill"
            size={18}
            color={theme.warning}
            modifiers={[
              frame({ width: SIZE, height: SIZE }),
              contentShape(shapes.rectangle()),
              onTapGesture(() => setOpen(true)),
              accessibilityLabel(`${title}. ${message}`),
            ]}
          />
        </Popover.Trigger>
        <Popover.Content>
          <VStack alignment="leading" spacing={6} modifiers={[padding({ all: 16 }), frame({ width: 260 })]}>
            <Text modifiers={[font({ size: 15, weight: 'semibold' }), fixedSize({ horizontal: false, vertical: true })]}>
              {title}
            </Text>
            <Text
              modifiers={[font({ size: 15 }), foregroundStyle(theme.textSecondary), fixedSize({ horizontal: false, vertical: true })]}>
              {message}
            </Text>
            <Button
              label="Correggi"
              systemImage="pencil"
              onPress={() => {
                setOpen(false);
                onFix();
              }}
              modifiers={[buttonStyle('bordered'), controlSize('small'), tint(theme.accent), padding({ top: 4 })]}
            />
          </VStack>
        </Popover.Content>
      </Popover>
    </Host>
  );
}

const SIZE = 24;

const styles = StyleSheet.create({
  host: { width: SIZE, height: SIZE },
});
