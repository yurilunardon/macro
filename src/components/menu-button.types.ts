import type { SFSymbol } from 'expo-symbols';
import type { ReactNode } from 'react';

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
  /**
   * Draws the button exactly as it looks, but without the native menu behind it: for content
   * kept ready off screen, where a SwiftUI view per button would cost too much.
   */
  inert?: boolean;
  /** Draws the button with these views instead of the icon and title, e.g. a value to pick. */
  children?: ReactNode;
  /**
   * What a tap does, as Safari's back button: the menu then opens on a long press instead.
   */
  onPrimaryAction?: () => void;
};
