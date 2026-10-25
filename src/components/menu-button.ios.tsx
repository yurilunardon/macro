import { Button, Host, Image, Menu, Section } from '@expo/ui/swift-ui';
import { accessibilityLabel, frame } from '@expo/ui/swift-ui/modifiers';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

import type { MenuButtonProps } from './menu-button.types';

/** An icon that opens the native iOS menu, with SF Symbols next to each action. */
export function MenuButton({ icon, accessibilityLabel: label, groups }: MenuButtonProps) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const visible = groups.filter((group) => group.actions.length > 0);
  return (
    <Host matchContents colorScheme={scheme === 'dark' ? 'dark' : 'light'}>
      <Menu
        label={<Image systemName={icon} size={22} color={theme.accent} modifiers={[frame({ width: 44, height: 44 })]} />}
        modifiers={[accessibilityLabel(label)]}>
        {visible.map((group, index) => (
          <Section key={group.title ?? index} title={group.title}>
            {group.actions.map((action) => (
              <Button
                key={action.label}
                label={action.label}
                systemImage={action.icon}
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
