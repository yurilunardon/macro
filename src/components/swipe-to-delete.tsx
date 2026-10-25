import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/services/haptics';

import { AppText } from './app-text';
import { Icon } from './icon';
import { EASE_OUT, project, rubberband } from './motion';

/** Width of the revealed button, as in Mail and Clock. */
const ACTION_WIDTH = 88;
/** Past this share of the row, letting go deletes without tapping the button. */
const FULL_SWIPE = 0.5;
const SETTLE = { duration: 350, dampingRatio: 1 };

// Captured by the gesture worklets, which call back into JS with scheduleOnRN.
const armHaptic = haptics.medium;
const disarmHaptic = haptics.light;

/** Only one row stays open at a time, as in iOS lists. */
let closeOpenRow: (() => void) | null = null;

type SwipeToDeleteProps = {
  children: ReactNode;
  onDelete: () => void;
  /** Asked once the row has slid out; resolving to false puts it back. */
  confirm?: () => Promise<boolean>;
  label?: string;
};

/**
 * Swipe left to delete, as in iOS lists. A short swipe reveals the red button; a long one
 * turns the whole row red, ticks, and deletes on release. The row then closes its gap.
 * Rows that use it should keep another way to delete for people who cannot swipe.
 */
export function SwipeToDelete({ children, onDelete, confirm, label = 'Elimina' }: SwipeToDeleteProps) {
  const theme = useTheme();
  const x = useSharedValue(0);
  const startX = useSharedValue(0);
  const width = useSharedValue(0);
  const height = useSharedValue(0);
  const armed = useSharedValue(false);
  const armedProgress = useSharedValue(0);
  const collapse = useSharedValue(0);
  const [open, setOpen] = useState(false);
  const [closeSelf] = useState(() => () => {
    x.set(withSpring(0, SETTLE));
    setOpen(false);
  });

  const settle = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) closeOpenRow = closeSelf;
    else if (closeOpenRow === closeSelf) closeOpenRow = null;
  };

  const closeOthers = () => {
    if (closeOpenRow && closeOpenRow !== closeSelf) closeOpenRow();
  };

  const reset = () => {
    armed.set(false);
    armedProgress.set(withTiming(0, { duration: 160, easing: EASE_OUT }));
    x.set(withSpring(0, SETTLE));
    settle(false);
  };

  /** Runs once the row has slid out completely. */
  const finish = async () => {
    if (confirm && !(await confirm())) {
      reset();
      return;
    }
    if (closeOpenRow === closeSelf) closeOpenRow = null;
    collapse.set(
      withTiming(1, { duration: 240, easing: EASE_OUT }, (finished) => {
        'worklet';
        if (finished) scheduleOnRN(onDelete);
      }),
    );
  };

  const slideOut = () => {
    'worklet';
    armedProgress.set(withTiming(1, { duration: 160, easing: EASE_OUT }));
    x.set(
      withTiming(-width.get(), { duration: 200, easing: EASE_OUT }, (finished) => {
        'worklet';
        if (finished) scheduleOnRN(finish);
      }),
    );
  };

  const pan = usePanGesture({
    activeOffsetX: [-12, 12],
    failOffsetY: [-8, 8],
    onActivate: () => {
      'worklet';
      startX.set(x.get());
      scheduleOnRN(closeOthers);
    },
    onUpdate: (event) => {
      'worklet';
      const rowWidth = width.get();
      const next = startX.get() + event.translationX;
      const clamped = next > 0 ? rubberband(next, rowWidth) : Math.max(next, -rowWidth);
      x.set(clamped);
      const isArmed = -clamped > rowWidth * FULL_SWIPE;
      if (isArmed !== armed.get()) {
        armed.set(isArmed);
        armedProgress.set(withTiming(isArmed ? 1 : 0, { duration: 160, easing: EASE_OUT }));
        scheduleOnRN(isArmed ? armHaptic : disarmHaptic);
      }
    },
    onDeactivate: (event) => {
      'worklet';
      if (armed.get() && !event.canceled) {
        slideOut();
        return;
      }
      armed.set(false);
      armedProgress.set(withTiming(0, { duration: 160, easing: EASE_OUT }));
      const projected = x.get() + project(event.velocityX);
      const opens = projected < -ACTION_WIDTH / 2 && !event.canceled;
      x.set(withSpring(opens ? -ACTION_WIDTH : 0, { ...SETTLE, velocity: event.velocityX }));
      scheduleOnRN(settle, opens);
    },
  });

  const onLayout = (event: LayoutChangeEvent) => {
    // While the row closes its gap its height shrinks: keep the original one.
    if (collapse.get() > 0) return;
    width.set(event.nativeEvent.layout.width);
    height.set(event.nativeEvent.layout.height);
  };

  const containerStyle = useAnimatedStyle(() => {
    const c = collapse.get();
    return c === 0 ? {} : { height: height.get() * (1 - c), opacity: 1 - c };
  });
  const contentStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  // The red layer sits behind the row and shows where the row has moved away.
  const actionStyle = useAnimatedStyle(() => ({ opacity: x.get() < -0.5 ? 1 : 0 }));
  // At rest the label sits at the right; once armed it follows the row's edge.
  const labelStyle = useAnimatedStyle(() => {
    const reveal = -x.get();
    const shift = width.get() - ACTION_WIDTH + armedProgress.get() * (ACTION_WIDTH - reveal);
    return { transform: [{ translateX: Math.max(0, shift) }] };
  });

  return (
    <Animated.View style={[styles.container, containerStyle]} onLayout={onLayout}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: theme.danger }, actionStyle]}>
        <Animated.View style={[styles.label, labelStyle]}>
          <Pressable
            onPress={() => slideOut()}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={styles.labelButton}>
            <Icon name="trash.fill" size={18} color="#FFFFFF" />
            <AppText variant="caption" weight="600" style={styles.labelText}>
              {label}
            </AppText>
          </Pressable>
        </Animated.View>
      </Animated.View>
      <GestureDetector gesture={pan} touchAction="pan-y">
        <Animated.View style={[{ backgroundColor: theme.card }, contentStyle]}>
          {children}
          {open ? (
            // While open, a tap on the row closes it instead of opening it.
            <Pressable style={StyleSheet.absoluteFill} onPress={reset} accessibilityLabel="Chiudi" />
          ) : null}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
  label: { position: 'absolute', top: 0, bottom: 0, left: 0, width: ACTION_WIDTH },
  labelButton: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.xs },
  labelText: { color: '#FFFFFF' },
});
