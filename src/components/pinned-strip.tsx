import { useHeaderHeight } from 'expo-router/react-navigation';
import { useEffect, useRef, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
import type { ScrollTop } from '@/hooks/use-scroll-top';
import { useTheme } from '@/hooks/use-theme';

/** From iOS 26 the system's bar is taller. */
const NAV_BAR = Platform.OS === 'ios' && Number.parseInt(String(Platform.Version), 10) >= 26 ? 54 : 44;
/** How far above the strip its background reaches, under the bar. */
const COVER = 240;

/**
 * The bar's height with its large title folded: the lowest iOS has reported, kept for every page.
 * Until then, the system's usual height.
 */
let foldedBar: number | null = null;

/** The height of the bar with its large title folded, where what is pinned stops. */
export function usePinnedBar(): SharedValue<number> {
  const insets = useSafeAreaInsets();
  const reported = useHeaderHeight();
  const bar = useSharedValue(foldedBar ?? insets.top + NAV_BAR);
  // The first value is React Navigation's own estimate, before iOS has reported anything.
  const estimate = useRef(reported);
  useEffect(() => {
    if (reported === estimate.current || reported < insets.top + 30) return;
    if (reported < (foldedBar ?? insets.top + NAV_BAR)) {
      foldedBar = reported;
      bar.set(withTiming(reported, { duration: 180 }));
    }
  }, [reported, insets.top, bar]);
  return bar;
}

/**
 * What stays in sight at the top as the page scrolls, as the week in Calendar: it scrolls with the
 * page until it reaches the bottom of the bar, then stops there, with the page going under it.
 */
export function PinnedStrip({ scroll, children }: { scroll: ScrollTop; children: ReactNode }) {
  const theme = useTheme();
  const bar = usePinnedBar();
  const top = useSharedValue(0);
  const { offset, pinnedAt } = scroll;
  useAnimatedReaction(
    () => top.get() - bar.get(),
    (at) => pinnedAt.set(at),
  );

  const pinned = useAnimatedStyle(() => ({ transform: [{ translateY: Math.max(0, offset.get() + bar.get() - top.get()) }] }));
  // Only once pinned: before, it would hide what is above the strip on the page.
  const cover = useAnimatedStyle(() => ({ opacity: offset.get() + bar.get() - top.get() > 0 ? 1 : 0 }));

  return (
    <Animated.View
      onLayout={(event) => top.set(event.nativeEvent.layout.y)}
      style={[styles.strip, { backgroundColor: theme.background }, pinned]}>
      <Animated.View pointerEvents="none" style={[styles.cover, { backgroundColor: theme.background }, cover]} />
      {children}
      <View style={[styles.rule, { backgroundColor: theme.separator }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Full width, out of the screen's side margins; over the pages going under it.
  strip: { zIndex: 1, marginHorizontal: -Spacing.lg, paddingHorizontal: Spacing.lg, paddingTop: Spacing.xs },
  cover: { position: 'absolute', left: 0, right: 0, bottom: '100%', height: COVER },
  rule: { height: StyleSheet.hairlineWidth, marginHorizontal: -Spacing.lg },
});
