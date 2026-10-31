import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { DAY_ICON_CHOICES, type DayIcon } from '@/lib/training';

import { Icon } from './icon';
import { MenuButton } from './menu-button';

/** The symbol of a training day (push, pull, legs…) on a tinted square, as app icons in lists. */
export function DayBadge({ icon, size = 32 }: { icon: DayIcon; size?: number }) {
  const theme = useTheme();
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: size * 0.28, backgroundColor: theme.accentSoft }]}>
      <Icon name={icon} size={size * 0.6} tone="accent" />
    </View>
  );
}

/** The day's symbol beside its name, tapped to pick another from a menu that shows them all. */
export function DayIconButton({ icon, onPick }: { icon: DayIcon; onPick: (icon: DayIcon) => void }) {
  return (
    <MenuButton
      icon={icon}
      accessibilityLabel="Icona del giorno: cambiala"
      groups={[
        {
          title: 'Icona del giorno',
          actions: DAY_ICON_CHOICES.map((c) => ({ label: c.label, icon: c.icon, checked: c.icon === icon, onPress: () => onPick(c.icon) })),
        },
      ]}>
      <DayBadge icon={icon} size={44} />
    </MenuButton>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center', borderCurve: 'continuous' },
});
