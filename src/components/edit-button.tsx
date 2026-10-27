import type { ComponentProps } from 'react';
import type { Stack } from 'expo-router';

import { haptics } from '@/services/haptics';

type EditButtonOptions = {
  editing: boolean;
  onChange: (editing: boolean) => void;
  disabled?: boolean;
};

/**
 * "Modifica" in the bar, turning into a prominent ✓ while editing, as in Clock. It has its own
 * glass, apart from the buttons beside it, so iOS can melt them together for a moment when one
 * is pressed and pull them apart again. Every list that can be edited uses it.
 *
 * Props to spread on a `Stack.Toolbar.Button` rather than a component: the toolbar only takes
 * its own elements as children and silently drops any other, which hid the button.
 */
export function editButton({ editing, onChange, disabled = false }: EditButtonOptions): ComponentProps<typeof Stack.Toolbar.Button> {
  return {
    icon: editing ? 'checkmark' : undefined,
    variant: editing ? 'done' : 'plain',
    separateBackground: true,
    disabled: disabled && !editing,
    accessibilityLabel: editing ? 'Fine' : 'Modifica',
    onPress: () => {
      haptics.selection();
      onChange(!editing);
    },
    children: editing ? undefined : 'Modifica',
  };
}
