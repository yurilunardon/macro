import { StyleSheet, View } from 'react-native';

import { Button, Host, HStack, Image, Menu, Section, Text } from '@expo/ui/swift-ui';
import { accessibilityLabel, font, foregroundStyle, frame } from '@expo/ui/swift-ui/modifiers';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

import { AppText } from './app-text';
import { Icon } from './icon';
import type { MenuButtonProps } from './menu-button.types';

/** Opens the native iOS menu, with SF Symbols next to each action. */
export function MenuButton({ icon, title, accessibilityLabel: label, groups, inert = false }: MenuButtonProps) {
  const theme = useTheme();
  const scheme = useColorScheme();
  if (inert) return <MenuButtonLook icon={icon} title={title} />;
  const visible = groups.filter((group) => group.actions.length > 0);
  const trigger = title ? (
    <HStack spacing={5} modifiers={[frame({ minHeight: 36 })]}>
      <Image systemName={icon} size={14} color={theme.accent} />
      <Text modifiers={[font({ size: 15, weight: 'semibold' }), foregroundStyle(theme.accent)]}>{title}</Text>
      <Image systemName="chevron.up.chevron.down" size={11} color={theme.accent} />
    </HStack>
  ) : (
    <Image systemName={icon} size={22} color={theme.accent} modifiers={[frame({ width: 44, height: 44 })]} />
  );
  return (
    <Host matchContents colorScheme={scheme === 'dark' ? 'dark' : 'light'}>
      <Menu label={trigger} modifiers={[accessibilityLabel(label)]}>
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
