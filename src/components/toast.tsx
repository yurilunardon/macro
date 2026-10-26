import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { SFSymbol } from 'expo-symbols';
import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { AppText } from './app-text';
import { Icon } from './icon';

type ToastAction = { label: string; onPress: () => void };
type ToastMessage = { id: number; title: string; icon: SFSymbol; action?: ToastAction };

const VISIBLE_MS = 1800;
/** Long enough to read the message and reach the button. */
const WITH_ACTION_MS = 4500;
const ENTER = FadeInUp.duration(280).easing(Easing.bezier(0.23, 1, 0.32, 1));
const EXIT = FadeOutUp.duration(220).easing(Easing.bezier(0.23, 1, 0.32, 1));
const glass = isLiquidGlassAvailable();

let current: ToastMessage | null = null;
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | undefined;
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
 * dismissed.
 */
export const toast = {
  show(title: string, icon: SFSymbol = 'checkmark.circle.fill', action?: ToastAction): void {
    const id = nextId++;
    current = { id, title, icon, action };
    emit();
    AccessibilityInfo.announceForAccessibility(title);
    clearTimeout(timer);
    timer = setTimeout(() => toast.hide(id), action ? WITH_ACTION_MS : VISIBLE_MS);
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
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const message = useSyncExternalStore(subscribe, () => current);

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {message ? (
        <Animated.View
          key={message.id}
          entering={ENTER}
          exiting={EXIT}
          pointerEvents={message.action ? 'box-none' : 'none'}
          style={[styles.slot, { top: insets.top + Spacing.xs }]}>
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
      ) : null}
    </View>
  );
}

function ToastContent({ message }: { message: ToastMessage }) {
  const { action } = message;
  return (
    <>
      <Icon name={message.icon} size={18} tone="accent" />
      <AppText variant="subhead" weight="600" numberOfLines={1} style={styles.title}>
        {message.title}
      </AppText>
      {action ? (
        <Pressable
          onPress={() => {
            toast.hide(message.id);
            action.onPress();
          }}
          hitSlop={12}
          accessibilityRole="button"
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <AppText variant="subhead" weight="700" tone="accent">
            {action.label}
          </AppText>
        </Pressable>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  slot: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radius.pill,
    maxWidth: '90%',
    overflow: 'hidden',
  },
  title: { flexShrink: 1 },
  action: { marginLeft: Spacing.sm },
  pressed: { opacity: 0.5 },
  solid: {
    borderWidth: StyleSheet.hairlineWidth,
    boxShadow: '0 6px 20px rgba(0, 0, 0, 0.15)',
  },
});
