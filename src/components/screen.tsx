import type { ReactNode } from 'react';
import { Platform, StyleSheet, type ScrollViewProps } from 'react-native';
import Animated, { type AnimatedRef } from 'react-native-reanimated';

import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { closeOpenSwipeRow } from './swipe-to-delete';
import { useTabBarInset } from './tab-bar';

/**
 * Scrollable screen body. It must be the first child of the screen so iOS can collapse the
 * large title and inset the content under the header; in a tab, the end of the page also
 * clears the tab bar floating over it.
 */
export function ScreenScroll({
  children,
  animatedRef,
  ...props
}: { children: ReactNode; animatedRef?: AnimatedRef<Animated.ScrollView> } & ScrollViewProps) {
  const theme = useTheme();
  const tabBar = useTabBarInset();
  return (
    <Animated.ScrollView
      ref={animatedRef}
      contentInsetAdjustmentBehavior="automatic"
      {...bottomInset(tabBar)}
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={[styles.content, webPadding(tabBar)]}
      onScrollBeginDrag={closeOpenSwipeRow}
      {...props}>
      {children}
    </Animated.ScrollView>
  );
}

/**
 * Room under the content for the tab bar. On iOS it goes on top of the safe area the system
 * adds by itself, as an inset, so the scroll bar stops above the tab bar too.
 */
export function bottomInset(tabBar: number): Pick<ScrollViewProps, 'contentInset' | 'scrollIndicatorInsets'> {
  return tabBar > 0 && Platform.OS === 'ios' ? { contentInset: { bottom: tabBar }, scrollIndicatorInsets: { bottom: tabBar } } : {};
}

/** The web has no insets: the same room as padding. */
export function webPadding(tabBar: number) {
  return Platform.OS === 'web' && tabBar > 0 ? { paddingBottom: BOTTOM + tabBar } : null;
}

const BOTTOM = Spacing.xxl * 2;

const styles = StyleSheet.create({
  content: {
    padding: Spacing.lg,
    paddingBottom: BOTTOM,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
});
