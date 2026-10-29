import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { ColorValue, NativeSyntheticEvent, ViewProps } from 'react-native';

export type NotchedTabBarTab = 'left' | 'right';

export type NotchedTabBarProps = ViewProps & {
  leftLabel: string;
  leftIcon: string;
  leftSelectedIcon?: string;
  rightLabel: string;
  rightIcon: string;
  rightSelectedIcon?: string;
  /** The tab on screen; "none" for none. */
  selected: NotchedTabBarTab | 'none';
  /** Today on the calendar's button. */
  weekday: string;
  day: string;
  accent: ColorValue;
  /**
   * While a finger is down on the calendar's button. The touch is React Native's: a transparent
   * button laid over the drawn one, so the calendar can zoom out of it.
   */
  calendarPressed: boolean;
  onSelect: (event: NativeSyntheticEvent<{ tab: NotchedTabBarTab }>) => void;
};

/** The calendar's button: its size, centred at the top of the view (see Metrics in NotchedTabBarModule.swift). */
export const NOTCHED_TAB_BAR_BUTTON = 60;

/** How tall the view is: the button rises above the 62pt capsule by half its size less 4pt. */
export const NOTCHED_TAB_BAR_HEIGHT = 62 + NOTCHED_TAB_BAR_BUTTON / 2 - 4;

/** Null where the native code is not included: on the web, or in an app built before it. */
export const NotchedTabBarView: ComponentType<NotchedTabBarProps> | null = requireOptionalNativeModule('NotchedTabBar')
  ? requireNativeView<NotchedTabBarProps>('NotchedTabBar', 'NotchedTabBarView')
  : null;
