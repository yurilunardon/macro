import { StyleSheet, View } from 'react-native';

import { Button, Host, HStack, Image, Menu, Section } from '@expo/ui/swift-ui';
import { accessibilityLabel, frame, opacity } from '@expo/ui/swift-ui/modifiers';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

import { AppText } from './app-text';
import { Icon } from './icon';
import type { MenuButtonProps } from './menu-button.types';

/**
 * Opens the native iOS menu, with SF Symbols next to each action.
 *
 * The button is drawn with React Native views, which have their size from the first frame; the
 * SwiftUI menu lies on top of it, filling it, with a nearly transparent label that only catches
 * the tap. A SwiftUI host that sized itself to its content would be 0 × 0 on its first frame and
 * then grow, which made the cards around it jump.
 */
export function MenuButton({ icon, title, accessibilityLabel: label, groups, inert = false }: MenuButtonProps) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const look = <MenuButtonLook icon={icon} title={title} />;
  if (inert) return look;
  const visible = groups.filter((group) => group.actions.length > 0);
  return (
    <View>
      {look}
      <Host style={StyleSheet.absoluteFill} colorScheme={scheme === 'dark' ? 'dark' : 'light'}>
        <Menu
          label={
            // SwiftUI ignores taps on fully transparent views, hence the tiny opacity.
            <HStack modifiers={[frame({ maxWidth: 1000, maxHeight: 1000 }), opacity(0.02)]}>
              <Image systemName={icon} size={14} color={theme.accent} />
            </HStack>
          }
          modifiers={[accessibilityLabel(label)]}>
          {visible.map((group, index) => (
            <Section key={group.title ?? index} title={group.title}>
              {group.actions.map((action) => (
                <Button
                  key={action.label}
                  label={action.label}
                  systemImage={action.checked ? 'checkmark' : action.icon}
                  role={action.destructive ? 'destructive' : 'default'}
                  onPress={action.onPress}
                />
              ))}
            </Section>
          ))}
        </Menu>
      </Host>
    </View>
  );
}

/** The same trigger drawn with plain views, to the point: the swap to the real one is invisible. */
function MenuButtonLook({ icon, title }: Pick<MenuButtonProps, 'icon' | 'title'>) {
  if (!title) {
    return (
      <View style={styles.iconOnly}>
        <Icon name={icon} size={22} tone="accent" />
      </View>
    );
  }
  return (
    <View style={styles.titled}>
      <Icon name={icon} size={14} tone="accent" />
      <AppText variant="subhead" weight="600" tone="accent">
        {title}
      </AppText>
      <Icon name="chevron.up.chevron.down" size={11} tone="accent" />
    </View>
  );
}

const styles = StyleSheet.create({
  iconOnly: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  titled: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 36 },
});
