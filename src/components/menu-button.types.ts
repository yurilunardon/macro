import type { SFSymbol } from 'expo-symbols';

export type MenuAction = {
  label: string;
  icon: SFSymbol;
  onPress: () => void;
  destructive?: boolean;
  /** The current choice: shown with a checkmark instead of its icon. */
  checked?: boolean;
};

/** Actions shown together, with a separator between groups. */
export type MenuGroup = { title?: string; actions: MenuAction[] };

export type MenuButtonProps = {
  icon: SFSymbol;
  /** With a title the button reads "icon title ⌄", as a pop-up button; without, just the icon. */
  title?: string;
  accessibilityLabel: string;
  groups: MenuGroup[];
};
