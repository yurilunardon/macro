import { Button, Host, Menu, Section, Text } from '@expo/ui/swift-ui';
import { font, foregroundStyle, frame } from '@expo/ui/swift-ui/modifiers';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { SET_TYPES } from '@/lib/training';

import type { SetTypeMenuProps } from './set-type-menu.types';

const ICONS = { normal: 'number', warmup: 'flame', drop: 'arrow.down.right', failure: 'bolt.fill' } as const;

/** The set number: tapping it opens the native menu to mark a warm-up, drop or failure set. */
export function SetTypeMenu({ badge, type, done, onChange, onDelete }: SetTypeMenuProps) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const color = type === 'warmup' ? theme.warning : type === 'normal' ? (done ? theme.accent : theme.text) : theme.danger;
  return (
    <Host matchContents colorScheme={scheme === 'dark' ? 'dark' : 'light'}>
      <Menu
        label={
          <Text modifiers={[font({ size: 15, weight: 'bold' }), foregroundStyle(color), frame({ width: 36, height: 36 })]}>
            {badge}
          </Text>
        }>
        <Section title="Tipo di serie">
          {SET_TYPES.map((t) => (
            <Button
              key={t.key}
              label={t.label}
              systemImage={t.key === type ? 'checkmark' : ICONS[t.key]}
              onPress={() => onChange(t.key)}
            />
          ))}
        </Section>
        <Button label="Elimina serie" systemImage="trash" role="destructive" onPress={onDelete} />
      </Menu>
    </Host>
  );
}
