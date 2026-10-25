import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { SFSymbol } from 'expo-symbols';
import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { AppText } from './app-text';
import { Icon } from './icon';

type ToastMessage = { id: number; title: string; icon: SFSymbol };

const VISIBLE_MS = 1800;
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
 * to tomorrow. It never needs to be dismissed.
 */
export const toast = {
  show(title: string, icon: SFSymbol = 'checkmark.circle.fill'): void {
    current = { id: nextId++, title, icon };
    emit();
    AccessibilityInfo.announceForAccessibility(title);
    clearTimeout(timer);
    timer = setTimeout(() => {
      current = null;
      emit();
    }, VISIBLE_MS);
  },
};

/** Renders the current toast above everything else. Mounted once in the root layout. */
export function ToastHost() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const message = useSyncExternalStore(subscribe, () => current);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {message ? (
        <Animated.View key={message.id} entering={ENTER} exiting={EXIT} style={[styles.slot, { top: insets.top + Spacing.xs }]}>
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
  return (
    <>
      <Icon name={message.icon} size={18} tone="accent" />
      <AppText variant="subhead" weight="600" numberOfLines={1}>
        {message.title}
      </AppText>
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
  solid: {
    borderWidth: StyleSheet.hairlineWidth,
    boxShadow: '0 6px 20px rgba(0, 0, 0, 0.15)',
  },
});
