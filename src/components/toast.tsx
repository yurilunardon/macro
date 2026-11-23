import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { SFSymbol } from 'expo-symbols';
import { useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { Easing, FadeInUp, FadeOutUp, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { AppText } from './app-text';
import { Icon } from './icon';
import { project, rubberband } from './motion';

type ToastAction = { label: string; onPress: () => void };
type ToastMessage = { id: number; title: string; icon: SFSymbol; action?: ToastAction; second?: ToastAction };

const VISIBLE_MS = 1800;
/** Long enough to read the message and reach the button. */
const WITH_ACTION_MS = 4500;
const ENTER = FadeInUp.duration(280).easing(Easing.bezier(0.23, 1, 0.32, 1));
const EXIT = FadeOutUp.duration(220).easing(Easing.bezier(0.23, 1, 0.32, 1));
const glass = isLiquidGlassAvailable();
/** Past this, up or to a side, or thrown that way, letting go sends it off. */
const FLING_UP = 24;
const FLING_SIDE = 90;
const FLING_MS = 200;
const SETTLE = { duration: 320, dampingRatio: 1 };

let current: ToastMessage | null = null;
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | undefined;

function hideLater(message: ToastMessage): void {
  clearTimeout(timer);
  timer = setTimeout(() => toast.hide(message.id), message.action ? WITH_ACTION_MS : VISIBLE_MS);
}
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * A short confirmation at the top of the screen, like the pills iOS shows for AirDrop or
 * silent mode: for actions whose result is not visible where the user is, e.g. copying a meal
 * to tomorrow, or with an "Annulla" button after deleting something. It never needs to be
 * dismissed, but it can be: pushed up or to a side, as a notification.
 */
export const toast = {
  show(title: string, icon: SFSymbol = 'checkmark.circle.fill', action?: ToastAction, second?: ToastAction): void {
    const id = nextId++;
    current = { id, title, icon, action, second };
    emit();
    AccessibilityInfo.announceForAccessibility(title);
    hideLater(current);
  },
  /** While a finger holds it, it stays; let go, it gets its time again. */
  hold(id: number): void {
    if (current?.id === id) clearTimeout(timer);
  },
  release(id: number): void {
    if (current?.id === id) hideLater(current);
  },
  /** Hides the toast, or only the one with this id if given. */
  hide(id?: number): void {
    if (!current || (id !== undefined && current.id !== id)) return;
    current = null;
    emit();
  },
};

/** Renders the current toast above everything else. Mounted once in the root layout. */
export function ToastHost() {
  const insets = useSafeAreaInsets();
  const message = useSyncExternalStore(subscribe, () => current);

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {message ? <ToastPill key={message.id} message={message} top={insets.top + Spacing.xs} /> : null}
    </View>
  );
}

/**
 * One toast: it follows the finger, and pushed up or to a side, or thrown, it goes that way and is
 * gone; let go short of it, it springs back and stays its time.
 */
function ToastPill({ message, top }: { message: ToastMessage; top: number }) {
  const theme = useTheme();
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const fade = useSharedValue(1);
  // Sent off by the finger, it has already left: no fade on the way out.
  const [flung, setFlung] = useState(false);
  const { id } = message;
  const hold = () => toast.hold(id);
  const release = () => toast.release(id);
  const fling = () => setFlung(true);
  const hide = () => toast.hide(id);

  const pan = usePanGesture({
    minDistance: 4,
    onActivate: () => {
      'worklet';
      scheduleOnRN(hold);
    },
    onUpdate: (event) => {
      'worklet';
      x.set(event.translationX);
      // Down it only gives a little: there is nowhere to send it.
      y.set(event.translationY < 0 ? event.translationY : rubberband(event.translationY, 120));
    },
    onDeactivate: (event) => {
      'worklet';
      const upTo = y.get() + project(event.velocityY, 0.99);
      const sideTo = x.get() + project(event.velocityX, 0.99);
      const up = !event.canceled && upTo < -FLING_UP && Math.abs(sideTo) < Math.abs(upTo) * 2;
      const side = !event.canceled && !up && Math.abs(sideTo) > FLING_SIDE;
      if (up || side) {
        scheduleOnRN(fling);
        if (up) y.set(withTiming(-(top + 120), { duration: FLING_MS }));
        else x.set(withTiming(Math.sign(sideTo) * 500, { duration: FLING_MS }));
        fade.set(
          withTiming(0, { duration: FLING_MS }, (finished) => {
            if (finished) scheduleOnRN(hide);
          }),
        );
        return;
      }
      x.set(withSpring(0, { ...SETTLE, velocity: event.velocityX }));
      y.set(withSpring(0, { ...SETTLE, velocity: event.velocityY }));
      scheduleOnRN(release);
    },
  });
  const style = useAnimatedStyle(() => ({
    opacity: fade.get(),
    transform: [{ translateX: x.get() }, { translateY: y.get() }],
  }));

  return (
    <Animated.View entering={ENTER} exiting={flung ? undefined : EXIT} pointerEvents="box-none" style={[styles.slot, { top }]}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.holder, style]}>
          {glass ? (
            <GlassView style={styles.pill} glassEffectStyle="regular">
              <ToastContent message={message} />
            </GlassView>
          ) : (
            <View style={[styles.pill, styles.solid, { backgroundColor: theme.card, borderColor: theme.separator }]}>
              <ToastContent message={message} />
            </View>
          )}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

function ToastContent({ message }: { message: ToastMessage }) {
  const { action, second } = message;
  return (
    <>
      <Icon name={message.icon} size={18} tone="accent" />
      <AppText variant="subhead" weight="600" numberOfLines={second ? 2 : 1} style={styles.title}>
        {message.title}
      </AppText>
      {[second, action].map((a) =>
        a ? (
          <Pressable
            key={a.label}
            onPress={() => {
              toast.hide(message.id);
              a.onPress();
            }}
            hitSlop={12}
            accessibilityRole="button"
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
            <AppText variant="subhead" weight="700" tone="accent">
              {a.label}
            </AppText>
          </Pressable>
        ) : null,
      )}
    </>
  );
}

const styles = StyleSheet.create({
  slot: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  holder: { maxWidth: '90%' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  title: { flexShrink: 1 },
  action: { marginLeft: Spacing.sm },
  pressed: { opacity: 0.6 },
  solid: {
    borderWidth: StyleSheet.hairlineWidth,
    boxShadow: '0 6px 20px rgba(0, 0, 0, 0.15)',
  },
});
