import type { SFSymbol } from 'expo-symbols';

export type MenuAction = {
  label: string;
  icon: SFSymbol;
  onPress: () => void;
  destructive?: boolean;
};

/** Actions shown together, with a separator between groups. */
export type MenuGroup = { title?: string; actions: MenuAction[] };

export type MenuButtonProps = {
  icon: SFSymbol;
  accessibilityLabel: string;
  groups: MenuGroup[];
};
