import type { ReactNode } from 'react';
import { StyleSheet, type ScrollViewProps } from 'react-native';
import Animated, { type AnimatedRef } from 'react-native-reanimated';

import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { closeOpenSwipeRow } from './swipe-to-delete';

/**
 * Scrollable screen body. It must be the first child of the screen so iOS can collapse the
 * large title and inset the content under the header and tab bar.
 */
export function ScreenScroll({
  children,
  animatedRef,
  ...props
}: { children: ReactNode; animatedRef?: AnimatedRef<Animated.ScrollView> } & ScrollViewProps) {
  const theme = useTheme();
  return (
    <Animated.ScrollView
      ref={animatedRef}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      onScrollBeginDrag={closeOpenSwipeRow}
      {...props}>
      {children}
    </Animated.ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl * 2,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
});
