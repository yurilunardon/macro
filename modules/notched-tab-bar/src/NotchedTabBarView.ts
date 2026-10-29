import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { ColorValue, NativeSyntheticEvent, ViewProps } from 'react-native';

export type NotchedTabBarTab = 'left' | 'right' | 'calendar';

export type NotchedTabBarProps = ViewProps & {
  leftLabel: string;
  leftIcon: string;
  leftSelectedIcon?: string;
  rightLabel: string;
  rightIcon: string;
  rightSelectedIcon?: string;
  /** The button on screen; "none" for none. */
  selected: NotchedTabBarTab | 'none';
  /** Today on the calendar's button. */
  weekday: string;
  day: string;
  accent: ColorValue;
  onSelect: (event: NativeSyntheticEvent<{ tab: NotchedTabBarTab }>) => void;
};

/**
 * How tall the view is: the calendar's button rises above the 62pt capsule by half its 60pt size
 * less 4pt (see Metrics in NotchedTabBarModule.swift).
 */
export const NOTCHED_TAB_BAR_HEIGHT = 62 + 60 / 2 - 4;

/** Null where the native code is not included: on the web, or in an app built before it. */
export const NotchedTabBarView: ComponentType<NotchedTabBarProps> | null = requireOptionalNativeModule('NotchedTabBar')
  ? requireNativeView<NotchedTabBarProps>('NotchedTabBar', 'NotchedTabBarView')
  : null;
