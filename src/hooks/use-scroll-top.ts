import { useNavigation, useRoute } from 'expo-router';
import { useHeaderHeight, type NavigationProp, type ParamListBase } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import Animated, { scrollTo, useAnimatedRef, useAnimatedScrollHandler, useSharedValue, type AnimatedRef, type SharedValue } from 'react-native-reanimated';
import { scheduleOnUI } from 'react-native-worklets';

export type ScrollTop = {
  ref: AnimatedRef<Animated.ScrollView>;
  onScroll: ReturnType<typeof useAnimatedScrollHandler>;
  /** How far the page is scrolled, as iOS reports it: negative under a bar. */
  offset: SharedValue<number>;
  /** Scrolls back up to the top of the page; resolved once it is about there. */
  scrollToTop: () => Promise<void>;
};

/**
 * Back to the top of a page with a large title, the title open. Under a bar that floats over the
 * page, the top is as far above 0 as that bar is tall with its title open: the most iOS has
 * reported for it. The first offset alone may come only with the first drag, a little down the page.
 */
export function useScrollTop(): ScrollTop {
  const ref = useAnimatedRef<Animated.ScrollView>();
  const offset = useSharedValue(0);
  const top = useSharedValue<number | null>(null);
  const reported = useHeaderHeight();
  const bar = useSharedValue(0);
  useEffect(() => {
    if (reported > bar.get()) bar.set(reported);
  }, [reported, bar]);
  const onScroll = useAnimatedScrollHandler((event) => {
    if (top.get() === null) top.set(event.contentOffset.y);
    offset.set(event.contentOffset.y);
  });
  const [scrollToTop] = useState(() => (): Promise<void> => {
    const first = top.get();
    // A page that starts at 0 or below has its bar above it, not over it.
    const to = first !== null && first >= 0 ? first : Math.min(first ?? 0, -bar.get());
    const far = offset.get() - to;
    if (far < 8) return Promise.resolve();
    scheduleOnUI(() => {
      'worklet';
      scrollTo(ref, 0, to, true);
    });
    // Resolved once the scroll has about come to rest.
    return new Promise((resolve) => setTimeout(resolve, Math.min(300 + far / 4, 650)));
  });
  return { ref, onScroll, offset, scrollToTop };
}

/**
 * A tap on the tab on screen takes its first page back to the top, as in every iOS app, even from
 * a page further in, which the tap also closes. A tap coming from another tab only switches to it.
 */
export function useScrollTopOnTabPress(scrollToTop: () => void): void {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const route = useRoute();
  const latest = useRef(scrollToTop);
  useEffect(() => {
    latest.current = scrollToTop;
  });
  useEffect(() => {
    const onTabPress = () => {
      const stack = navigation.getState();
      if (navigation.getParent()?.isFocused() && stack?.routes[0]?.key === route.key) latest.current();
    };
    // Only the tab navigator sends it; it reaches the page through its stack, whichever level.
    const unsubscribe: (() => void)[] = [];
    for (let level: NavigationProp<ParamListBase> | undefined = navigation; level; level = level.getParent()) {
      unsubscribe.push((level as unknown as { addListener: (type: 'tabPress', listener: () => void) => () => void }).addListener('tabPress', onTabPress));
    }
    return () => unsubscribe.forEach((u) => u());
  }, [navigation, route.key]);
}
