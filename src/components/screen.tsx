import { useEffect, useRef, type ComponentRef, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type ScrollViewProps } from 'react-native';
import Animated from 'react-native-reanimated';

import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useScrollTop, useScrollTopOnTabPress, type ScrollTop } from '@/hooks/use-scroll-top';
import { useTheme } from '@/hooks/use-theme';

import { closeOpenSwipeRow } from './swipe-to-delete';
import { useTabBarInset } from './tab-bar';

/**
 * Scrollable screen body. It must be the first child of the screen so iOS can collapse the
 * large title and inset the content under the header; in a tab, the end of the page also
 * clears the tab bar floating over it, and a tap on the tab takes the first page back to its top.
 */
export function ScreenScroll({
  children,
  scroll,
  ...props
}: {
  children: ReactNode;
  /** The screen's own `useScrollTop`, when it also scrolls the page itself. */
  scroll?: ScrollTop;
} & ScrollViewProps) {
  const theme = useTheme();
  const tabBar = useTabBarInset();
  const own = useScrollTop();
  const active = scroll ?? own;
  const { ref, onScroll, scrollToTop } = active;
  useScrollTopOnTabPress(scrollToTop);
  return (
    <Animated.ScrollView
      ref={ref}
      onScroll={onScroll}
      scrollEventThrottle={16}
      contentInsetAdjustmentBehavior="automatic"
      // The top of a page under the bar is above 0, and without this iOS stops a scroll sent there at 0.
      scrollToOverflowEnabled
      {...bottomInset(tabBar)}
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={[styles.content, webPadding(tabBar)]}
      onScrollBeginDrag={closeOpenSwipeRow}
      {...props}>
      <TopMark scroll={active} />
      {children}
    </Animated.ScrollView>
  );
}

/**
 * Where the page starts on screen, measured as it opens, all the way up with its large title open:
 * how far it has to go to get back there. Measured again shortly after, once iOS has placed the bar.
 */
function TopMark({ scroll }: { scroll: ScrollTop }) {
  const mark = useRef<ComponentRef<typeof View>>(null);
  const inPage = useRef(0);
  const measure = () =>
    mark.current?.measureInWindow((_x, y) => {
      const top = y - inPage.current;
      if (top > scroll.openTop.get()) scroll.openTop.set(top);
    });
  useEffect(() => {
    const timers = [100, 400].map((ms) => setTimeout(measure, ms));
    return () => timers.forEach(clearTimeout);
    // Only as the page opens: later it may be scrolled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View
      ref={mark}
      collapsable={false}
      pointerEvents="none"
      onLayout={(event) => {
        inPage.current = event.nativeEvent.layout.y;
      }}
    />
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
