import { useNavigation, useRoute } from 'expo-router';
import type { NavigationProp, ParamListBase } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import Animated, { scrollTo, useAnimatedRef, useAnimatedScrollHandler, useSharedValue, type AnimatedRef } from 'react-native-reanimated';
import { scheduleOnUI } from 'react-native-worklets';

export type ScrollTop = {
  ref: AnimatedRef<Animated.ScrollView>;
  onScroll: ReturnType<typeof useAnimatedScrollHandler>;
  /** Scrolls back up to the top of the page; resolved once it is about there. */
  scrollToTop: () => Promise<void>;
};

/**
 * Back to the top of a page with a large title. The top is the first offset iOS reports, with the
 * large title open: it sets it itself, under the bar, so 0 would be too far.
 */
export function useScrollTop(): ScrollTop {
  const ref = useAnimatedRef<Animated.ScrollView>();
  const offset = useSharedValue(0);
  const top = useSharedValue<number | null>(null);
  const onScroll = useAnimatedScrollHandler((event) => {
    if (top.get() === null) top.set(event.contentOffset.y);
    offset.set(event.contentOffset.y);
  });
  const [scrollToTop] = useState(() => (): Promise<void> => {
    const to = top.get() ?? 0;
    const far = offset.get() - to;
    if (far < 8) return Promise.resolve();
    scheduleOnUI(() => {
      'worklet';
      scrollTo(ref, 0, to, true);
    });
    // Resolved once the scroll has about come to rest.
    return new Promise((resolve) => setTimeout(resolve, Math.min(300 + far / 4, 650)));
  });
  return { ref, onScroll, scrollToTop };
}

/**
 * A tap on the tab of the page on screen takes it back to the top, as in every iOS app. Only
 * the first page of the tab: on the pages above it the tap goes back to that one instead.
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
      if (navigation.isFocused() && stack?.routes[0]?.key === route.key) latest.current();
    };
    // Only the tab navigator sends it; it reaches the page through its stack, whichever level.
    const unsubscribe: (() => void)[] = [];
    for (let level: NavigationProp<ParamListBase> | undefined = navigation; level; level = level.getParent()) {
      unsubscribe.push((level as unknown as { addListener: (type: 'tabPress', listener: () => void) => () => void }).addListener('tabPress', onTabPress));
    }
    return () => unsubscribe.forEach((u) => u());
  }, [navigation, route.key]);
}
