import { useRouter } from 'expo-router';
import { createContext, use, useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useTheme } from '@/hooks/use-theme';

type Origin = { x: number; y: number; size: number };

/** Slow out of the button, quick across the screen, gentle as it settles. */
const OPEN = { duration: 560, easing: Easing.bezier(0.45, 0, 0.15, 1) };
const CLOSE = { duration: 380, easing: Easing.bezier(0.5, 0, 0.3, 1) };

/** Where the calendar's button was when it was pressed, in the window. */
let origin: Origin | null = null;

export function setCalendarOrigin(next: Origin) {
  origin = next;
}

const CloseContext = createContext<() => void>(() => {});

/** Shrinks the calendar back into its button, then closes it. */
export function useCloseCalendar(): () => void {
  return use(CloseContext);
}

/**
 * The calendar grows out of the round button in the tab bar as a disc that spreads over the
 * screen, its pages settling into place inside it, and shrinks back into the button on close.
 */
export function CalendarReveal({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const [from] = useState(() => origin ?? { x: width / 2, y: height - 60, size: 60 });
  // The disc's full size reaches the farthest corner of the screen.
  const radius = Math.hypot(Math.max(from.x, width - from.x), Math.max(from.y, height - from.y));
  const start = from.size / (2 * radius);

  const progress = useSharedValue(0);
  const closing = useRef(false);
  useEffect(() => {
    progress.set(withTiming(1, OPEN));
  }, [progress]);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    progress.set(
      withTiming(0, CLOSE, (finished) => {
        if (finished) scheduleOnRN(router.back);
      }),
    );
  };

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 1], [0, 0.35], 'clamp'),
  }));
  const discStyle = useAnimatedStyle(() => ({
    transform: [{ scale: start + (1 - start) * progress.get() }],
  }));
  // The pages undo the disc's scale, so the disc uncovers them in place, and settle from a little smaller.
  const pagesStyle = useAnimatedStyle(() => {
    const disc = start + (1 - start) * progress.get();
    return {
      opacity: interpolate(progress.get(), [0, 0.35], [0, 1], 'clamp'),
      transform: [{ scale: (0.92 + 0.08 * progress.get()) / disc }],
    };
  });

  return (
    <CloseContext value={close}>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
        <Animated.View
          style={[
            styles.disc,
            {
              left: from.x - radius,
              top: from.y - radius,
              width: 2 * radius,
              height: 2 * radius,
              borderRadius: radius,
              backgroundColor: theme.background,
            },
            discStyle,
          ]}>
          <Animated.View
            style={[
              styles.pages,
              {
                left: radius - from.x,
                top: radius - from.y,
                width,
                height,
                backgroundColor: theme.background,
                transformOrigin: `${from.x}px ${from.y}px`,
              },
              pagesStyle,
            ]}>
            {children}
          </Animated.View>
        </Animated.View>
      </View>
    </CloseContext>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: '#000' },
  disc: { position: 'absolute', overflow: 'hidden' },
  pages: { position: 'absolute' },
});
