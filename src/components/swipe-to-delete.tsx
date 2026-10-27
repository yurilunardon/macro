import { createContext, use, useState, type ReactNode } from 'react';
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
/** The red button fills the space the row leaves, top to bottom, rounded on the side it meets the row. */
const RADIUS = 16;
/** Past this share of the row, letting go deletes without tapping the button: well past the middle, as in Clock. */
const FULL_SWIPE = 0.72;
const SETTLE = { duration: 350, dampingRatio: 1 };

// Captured by the gesture worklets, which call back into JS with scheduleOnRN.
const armHaptic = haptics.medium;
const disarmHaptic = haptics.light;

/** Only one row stays open at a time, as in iOS lists. */
let closeOpenRow: (() => void) | null = null;

/** Closes the row left open, e.g. when the list starts scrolling, as iOS does. */
export function closeOpenSwipeRow(): void {
  closeOpenRow?.();
}

const RevealContext = createContext<() => void>(() => {});

/** Inside a swipe row: slides it open on its "Elimina" button, as the red ⊖ does in Clock. */
export function useSwipeReveal(): () => void {
  return use(RevealContext);
}

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

  const reveal = () => {
    closeOthers();
    x.set(withSpring(-ACTION_WIDTH, SETTLE));
    settle(true);
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
  // The red button fills the space the row leaves and grows with the swipe.
  const actionStyle = useAnimatedStyle(() => {
    const reveal = Math.max(0, -x.get());
    return { opacity: reveal > 0.5 ? 1 : 0, width: reveal };
  });
  // As in Messages and Mail: the label stays centred in the red button while it grows, and once
  // a full swipe is armed it jumps to the button's leading edge and follows the finger.
  const labelStyle = useAnimatedStyle(() => {
    const button = Math.max(0, -x.get());
    const centred = Math.max(0, (button - ACTION_WIDTH) / 2);
    return { transform: [{ translateX: centred * (1 - armedProgress.get()) }] };
  });

  // The whole row takes the swipe, the red button too: an open row can be dragged further (or
  // back) from the button as from the row.
  return (
    <GestureDetector gesture={pan} touchAction="pan-y">
      <Animated.View style={[styles.container, containerStyle]} onLayout={onLayout}>
        <Animated.View style={[styles.action, { backgroundColor: theme.danger }, actionStyle]}>
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
        <Animated.View style={[{ backgroundColor: theme.card }, contentStyle]}>
          <RevealContext value={reveal}>{children}</RevealContext>
          {open ? (
            // While open, a tap on the row closes it instead of opening it.
            <Pressable style={StyleSheet.absoluteFill} onPress={reset} accessibilityLabel="Chiudi" />
          ) : null}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
  action: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    borderTopLeftRadius: RADIUS,
    borderBottomLeftRadius: RADIUS,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  label: { position: 'absolute', top: 0, bottom: 0, left: 0, width: ACTION_WIDTH },
  labelButton: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.xs },
  labelText: { color: '#FFFFFF' },
});
