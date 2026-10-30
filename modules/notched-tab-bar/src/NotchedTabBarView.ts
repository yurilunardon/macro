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
  /** The tab on screen: "center" is the calendar's button; "none" for none. */
  selected: NotchedTabBarTab | 'center' | 'none';
  /** Today on the calendar's button. */
  weekday: string;
  day: string;
  accent: ColorValue;
  /**
   * While a finger is down on the calendar's button. The touch is React Native's: a transparent
   * button laid over the drawn one, so the calendar can grow out of it.
   */
  calendarPressed: boolean;
  onSelect: (event: NativeSyntheticEvent<{ tab: NotchedTabBarTab }>) => void;
};

/** The calendar's button: its size, centred at the top of the view (see Metrics in NotchedTabBarModule.swift). */
export const NOTCHED_TAB_BAR_BUTTON = 60;

/** How tall the view is: the button rises above the 62pt capsule by half its size less 4pt. */
export const NOTCHED_TAB_BAR_HEIGHT = 62 + NOTCHED_TAB_BAR_BUTTON / 2 - 4;

const nativeModule = requireOptionalNativeModule<{ hasAccessory?: boolean }>('NotchedTabBar');

/** Null where the native code is not included: on the web, or in an app built before it. */
export const NotchedTabBarView: ComponentType<NotchedTabBarProps> | null = nativeModule
  ? requireNativeView<NotchedTabBarProps>('NotchedTabBar', 'NotchedTabBarView')
  : null;

/** How far the workout's capsule comes down over the top of the calendar's button. */
export const NOTCHED_ACCESSORY_OVERLAP = 14;

/**
 * The glass of the workout's capsule, with the bar's cradle cut into its bottom edge; drawn only.
 * Null without the native code, and in builds from before it (up to 1.8.6).
 */
export const NotchedAccessoryView: ComponentType<ViewProps> | null = nativeModule?.hasAccessory
  ? requireNativeView<ViewProps>('NotchedTabBar', 'NotchedAccessoryView')
  : null;
