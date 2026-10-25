import { Alert, Pressable } from 'react-native';

import { Icon } from './icon';
import type { MenuButtonProps } from './menu-button.types';

export type { MenuAction, MenuGroup } from './menu-button.types';

/** Fallback for platforms without native SwiftUI menus: the same actions in an alert. */
export function MenuButton({ icon, accessibilityLabel, groups }: MenuButtonProps) {
  const actions = groups.flatMap((group) => group.actions);
  const open = () =>
    Alert.alert(accessibilityLabel, undefined, [
      ...actions.map((action) => ({
        text: action.label,
        style: action.destructive ? ('destructive' as const) : ('default' as const),
        onPress: action.onPress,
      })),
      { text: 'Annulla', style: 'cancel' as const },
    ]);
  return (
    <Pressable onPress={open} hitSlop={12} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
      <Icon name={icon} size={22} tone="accent" />
    </Pressable>
  );
}
