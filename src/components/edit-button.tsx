import { Stack } from 'expo-router';

import { haptics } from '@/services/haptics';

type EditButtonProps = {
  editing: boolean;
  onChange: (editing: boolean) => void;
  disabled?: boolean;
};

/**
 * "Modifica" in the bar, turning into a prominent ✓ while editing, as in Clock: one button, so
 * iOS lets it come away from the buttons beside it in Liquid Glass and join them again when
 * done. Every list that can be edited uses it.
 */
export function EditButton({ editing, onChange, disabled = false }: EditButtonProps) {
  return (
    <Stack.Toolbar.Button
      icon={editing ? 'checkmark' : undefined}
      variant={editing ? 'done' : 'plain'}
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
