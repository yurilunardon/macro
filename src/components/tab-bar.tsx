import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Link } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import type { SymbolViewProps } from 'expo-symbols';
import { createContext, use, useEffect, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { weekdayShort } from '@/lib/calendar';
import { weekdayOf } from '@/lib/dates';
import { haptics } from '@/services/haptics';

import { AppText } from './app-text';
import { Icon } from './icon';
import { PressableScale } from './pressable-scale';

const glass = isLiquidGlassAvailable();

/** The two round tabs, and the calendar's bigger button between them. */
const BUBBLE = 58;
const CENTER = 72;
/** How far the calendar's button sits above the bottom of the tabs, so it rises over them. */
const LIFT = 4;
const GAP = 18;
/** The workout in progress, in a capsule of its own above. */
const ACCESSORY = 56;
const ACCESSORY_WIDTH = 360;

/** Where the bottom of the tabs sits: inside the home indicator's area, as iOS's own bar. */
function barBottom(safeBottom: number): number {
  return Math.max(safeBottom - 12, 12);
}

/**
 * How much of the page the bar covers above the safe area, which iOS already keeps clear: the
 * scroll views inside the tabs add it at the bottom so their end can scroll out from under it.
 */
export function tabBarInset(safeBottom: number, accessory: boolean): number {
  const top = barBottom(safeBottom) + CENTER + LIFT + Spacing.sm + (accessory ? ACCESSORY + Spacing.md : 0);
  return Platform.OS === 'web' ? top : top - safeBottom;
}

const TabBarInsetContext = createContext(0);

export function TabBarInsetProvider({ value, children }: { value: number; children: ReactNode }) {
  return <TabBarInsetContext value={value}>{children}</TabBarInsetContext>;
}

/** The space to leave under a scroll view's content in a tab; 0 outside the tabs. */
export function useTabBarInset(): number {
  return use(TabBarInsetContext);
}

type Tab = { label: string; icon: SymbolViewProps['name']; selectedIcon?: SymbolViewProps['name'] };

type TabBarProps = BottomTabBarProps & {
  /** The tabs left and right of the calendar, by route name. */
  left: string;
  right: string;
  tabs: Record<string, Tab>;
  /** Shown in a capsule of its own above, as the mini player in Music. */
  accessory?: ReactNode;
};

/**
 * The tabs as a small dock floating over the page: one round glass button on each side and,
 * between them and a little higher, the calendar's bigger green one with today's date, as on the
 * Calendar app's icon. The calendar opens out of it and shrinks back into it when closed. A dot
 * under a tab marks the one on screen, as under the open apps in the Mac's Dock.
 */
export function TabBar({ state, emitter, navigateToTab, left, right, tabs, accessory }: TabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const press = (name: string) => {
    const route = state.routes.find((r) => r.name === name);
    if (!route) return;
    const focused = state.routes[state.index]?.key === route.key;
    // A tap on the tab on screen goes back to its first page, as in iOS.
    const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (focused || event.defaultPrevented) return;
    haptics.selection();
    navigateToTab(route.key);
  };
  const focusedName = state.routes[state.index]?.name;

  return (
    <View pointerEvents="box-none" style={[styles.root, { bottom: barBottom(insets.bottom) }]}>
      {accessory ? (
        <View style={[styles.accessorySlot, { width: Math.min(width - 2 * Spacing.xl, ACCESSORY_WIDTH) }]}>
          {glass ? (
            <GlassView style={styles.accessory} glassEffectStyle="regular" isInteractive>
              {accessory}
            </GlassView>
          ) : (
            <View style={[styles.accessory, styles.solid, { backgroundColor: theme.card, borderColor: theme.separator }]}>{accessory}</View>
          )}
        </View>
      ) : null}

      <View pointerEvents="box-none" accessibilityRole="tablist" style={styles.dock}>
        {[left, null, right].map((name) =>
          name === null ? (
            <CalendarButton key="calendar" />
          ) : tabs[name] ? (
            <TabBubble key={name} tab={tabs[name]} focused={focusedName === name} onPress={() => press(name)} />
          ) : null,
        )}
      </View>
    </View>
  );
}

function TabBubble({ tab, focused, onPress }: { tab: Tab; focused: boolean; onPress: () => void }) {
  const theme = useTheme();
  // The symbol pops when its tab is picked, and the dot under it grows in.
  const pop = useSharedValue(1);
  const dot = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    dot.set(withSpring(focused ? 1 : 0, { duration: 350, dampingRatio: 0.8 }));
    if (focused) pop.set(withSequence(withSpring(0.82, { duration: 120, dampingRatio: 1 }), withSpring(1, { duration: 450, dampingRatio: 0.45 })));
  }, [focused, dot, pop]);
  const symbolStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.get() }] }));
  const dotStyle = useAnimatedStyle(() => ({ opacity: dot.get(), transform: [{ scale: dot.get() }] }));

  const content = (
    <Animated.View style={symbolStyle}>
      <Icon name={focused ? (tab.selectedIcon ?? tab.icon) : tab.icon} size={24} color={focused ? theme.accent : theme.text} weight="semibold" />
    </Animated.View>
  );
  return (
    <View style={styles.bubbleSlot}>
      <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: focused }} accessibilityLabel={tab.label} hitSlop={6}>
        {glass ? (
          <GlassView style={styles.bubble} glassEffectStyle="regular" isInteractive>
            {content}
          </GlassView>
        ) : (
          <View style={[styles.bubble, styles.solid, { backgroundColor: theme.card, borderColor: theme.separator }]}>{content}</View>
        )}
      </Pressable>
      <Animated.View style={[styles.dot, { backgroundColor: theme.accent }, dotStyle]} />
    </View>
  );
}

/** Today's weekday and date on a green button that opens the calendar out of itself. */
function CalendarButton() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const today = useToday();
  const dark = scheme === 'dark';
  return (
    <View style={styles.centerSlot}>
      <Link href="/calendar" asChild>
        <Link.Trigger withAppleZoom>
          <PressableScale scaleTo={0.9} accessibilityRole="button" accessibilityLabel="Calendario" accessibilityHint="Apre il calendario">
            <View
              style={[
                styles.center,
                {
                  backgroundColor: theme.accent,
                  backgroundImage: dark
                    ? 'linear-gradient(180deg, #5BE584 0%, #30D158 55%, #24B248 100%)'
                    : 'linear-gradient(180deg, #2BB35E 0%, #15803D 60%, #106A32 100%)',
                  boxShadow: dark
                    ? '0 10px 24px rgba(48, 209, 88, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.45)'
                    : '0 10px 22px rgba(21, 128, 61, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.35)',
                },
              ]}>
              <AppText weight="700" style={[styles.weekday, { color: theme.onAccent }]}>
                {weekdayShort(weekdayOf(today)).toUpperCase()}
              </AppText>
              <AppText weight="700" numeric style={[styles.date, { color: theme.onAccent }]}>
                {String(Number(today.slice(8)))}
              </AppText>
            </View>
          </PressableScale>
        </Link.Trigger>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  dock: { flexDirection: 'row', alignItems: 'flex-end', gap: GAP },
  bubbleSlot: { alignItems: 'center' },
  bubble: {
    width: BUBBLE,
    height: BUBBLE,
    borderRadius: BUBBLE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  solid: { borderWidth: StyleSheet.hairlineWidth, boxShadow: '0 6px 18px rgba(0, 0, 0, 0.14)' },
  // Under the bubble, inside the space the calendar's button rises by.
  dot: { position: 'absolute', bottom: -9, width: 5, height: 5, borderRadius: 2.5 },
  centerSlot: { marginBottom: LIFT },
  center: {
    width: CENTER,
    height: CENTER,
    borderRadius: CENTER / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekday: { fontSize: 11, lineHeight: 13, letterSpacing: 0.8, opacity: 0.85 },
  date: { fontSize: 28, lineHeight: 30 },
  accessorySlot: { marginBottom: Spacing.md },
  accessory: { height: ACCESSORY, borderRadius: ACCESSORY / 2, borderCurve: 'continuous', overflow: 'hidden', justifyContent: 'center' },
});
