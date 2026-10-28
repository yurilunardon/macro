import { Alert, Pressable, StyleSheet } from 'react-native';

import { AppText } from './app-text';
import { Icon } from './icon';
import type { MenuButtonProps } from './menu-button.types';

export type { MenuAction, MenuGroup } from './menu-button.types';

/** Fallback for platforms without native SwiftUI menus: the same actions in an alert. */
export function MenuButton({ icon, title, accessibilityLabel, groups, children, onPrimaryAction }: MenuButtonProps) {
  const actions = groups.flatMap((group) => group.actions);
  const open = () =>
    Alert.alert(accessibilityLabel, undefined, [
      ...actions.map((action) => ({
        text: action.checked ? `✓ ${action.label}` : action.label,
        style: action.destructive ? ('destructive' as const) : ('default' as const),
        onPress: action.onPress,
      })),
      { text: 'Annulla', style: 'cancel' as const },
    ]);
  return (
    <Pressable onPress={onPrimaryAction ?? open} onLongPress={onPrimaryAction ? open : undefined} hitSlop={12} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={!children && styles.row}>
      {children ?? (
        <>
          <Icon name={icon} size={title ? 14 : 22} tone="accent" />
          {title ? (
            <AppText variant="subhead" weight="600" tone="accent">
              {title}
            </AppText>
          ) : null}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 36 },
});
