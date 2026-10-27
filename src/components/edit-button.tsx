import { Stack } from 'expo-router';

import { haptics } from '@/services/haptics';

type EditButtonProps = {
  editing: boolean;
  onChange: (editing: boolean) => void;
  disabled?: boolean;
};

/**
 * "Modifica" in the bar, turning into a prominent ✓ while editing, as in Clock. It has its own
 * glass, apart from the buttons beside it, so iOS can melt them together for a moment when one
 * is pressed and pull them apart again. Every list that can be edited uses it.
 */
export function EditButton({ editing, onChange, disabled = false }: EditButtonProps) {
  return (
    <Stack.Toolbar.Button
      icon={editing ? 'checkmark' : undefined}
      variant={editing ? 'done' : 'plain'}
      separateBackground
      disabled={disabled && !editing}
      accessibilityLabel={editing ? 'Fine' : 'Modifica'}
      onPress={() => {
        haptics.selection();
        onChange(!editing);
      }}>
      {editing ? undefined : 'Modifica'}
    </Stack.Toolbar.Button>
  );
}
