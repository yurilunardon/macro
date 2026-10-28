import { GlassContainer, GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Link } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import type { SymbolViewProps } from 'expo-symbols';
import { createContext, use, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
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

const glass = isLiquidGlassAvailable();

/** The bar's capsule, at most this wide. */
const BAR = 64;
const BAR_WIDTH = 330;
/** The calendar's round button in the middle, and how far it rises above the capsule. */
const CENTER = 76;
const RISE = 18;
/** Glass this close together flows into one piece. */
const MERGE = 24;
/** The workout in progress, in a capsule of its own above. */
const ACCESSORY = 56;

/** Where the capsule's bottom edge sits: inside the home indicator's area, as iOS's own bar. */
function barBottom(safeBottom: number): number {
  return Math.max(safeBottom - 12, 12);
}

/**
 * How much of the page the bar covers above the safe area, which iOS already keeps clear: the
 * scroll views inside the tabs add it at the bottom so their end can scroll out from under it.
 */
export function tabBarInset(safeBottom: number, accessory: boolean): number {
  const top = barBottom(safeBottom) + BAR + RISE + Spacing.sm + (accessory ? ACCESSORY + Spacing.md : 0);
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
 * The tab bar in one piece of Liquid Glass: a capsule with a tab on each side and, in the middle,
 * the calendar's bigger round button rising out of it. The two shapes sit in one glass container,
 * so iOS melts them together as it does with its own glass. The calendar opens out of the button
 * and shrinks back into it.
 */
export function TabBar({ state, emitter, navigateToTab, left, right, tabs, accessory }: TabBarProps) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const { width: screen } = useWindowDimensions();
  const width = Math.min(screen - 2 * Spacing.xl, BAR_WIDTH);

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
  // The tab on screen sits on a lighter lens, as in iOS's tab bar.
  const lens = scheme === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.07)';

  const items = (
    <View style={styles.items}>
      {[left, right].map((name, i) => {
        const tab = tabs[name];
        if (!tab) return null;
        const focused = focusedName === name;
        const tint = focused ? theme.accent : theme.text;
        return (
          // Each tab in its half, clear of the round button.
          <View key={name} style={[styles.half, i === 0 ? { paddingRight: CENTER / 2 } : { paddingLeft: CENTER / 2 }]}>
            <Pressable
              onPress={() => press(name)}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={tab.label}
              style={({ pressed }) => [styles.item, focused && { backgroundColor: lens }, pressed && styles.pressed]}>
              <Icon name={focused ? (tab.selectedIcon ?? tab.icon) : tab.icon} size={22} color={tint} weight="semibold" />
              <AppText variant="caption" weight="600" numberOfLines={1} style={[styles.label, { color: tint }]}>
                {tab.label}
              </AppText>
            </Pressable>
          </View>
        );
      })}
    </View>
  );

  const date = <CalendarDate color={glass ? '#FFFFFF' : theme.onAccent} />;

  return (
    <View pointerEvents="box-none" style={[styles.root, { bottom: barBottom(insets.bottom) }]}>
      {accessory ? (
        <View style={[styles.accessorySlot, { width }]}>
          {glass ? (
            <GlassView style={styles.accessory} glassEffectStyle="regular" isInteractive>
              {accessory}
            </GlassView>
          ) : (
            <View style={[styles.accessory, styles.solid, { backgroundColor: theme.card, borderColor: theme.separator }]}>{accessory}</View>
          )}
        </View>
      ) : null}

      <View accessibilityRole="tablist" style={{ width, height: BAR + RISE }}>
        {glass ? (
          <GlassContainer spacing={MERGE} style={StyleSheet.absoluteFill}>
            <GlassView style={styles.capsule} glassEffectStyle="regular">
              {items}
            </GlassView>
            <CalendarLink left={(width - CENTER) / 2}>
              <GlassView style={styles.circle} glassEffectStyle="regular" tintColor={theme.accent} isInteractive>
                {date}
              </GlassView>
            </CalendarLink>
          </GlassContainer>
        ) : (
          // Without Liquid Glass: the same shape in the card's colour, the button in green.
          <View style={StyleSheet.absoluteFill}>
            <View style={[styles.capsule, styles.solid, { backgroundColor: theme.card, borderColor: theme.separator }]}>{items}</View>
            <View style={[styles.circleRing, { left: (width - CENTER) / 2 - 5, backgroundColor: theme.card }]} />
            <CalendarLink left={(width - CENTER) / 2}>
              <View style={[styles.circle, { backgroundColor: theme.accent }]}>{date}</View>
            </CalendarLink>
          </View>
        )}
      </View>
    </View>
  );
}

/** The round button: opens the calendar out of itself (a zoom from iOS 18) and takes it back on close. */
function CalendarLink({ left, children }: { left: number; children: ReactNode }) {
  return (
    <View style={[styles.circleSlot, { left }]}>
      <Link href="/calendar" asChild>
        <Link.Trigger withAppleZoom>
          <Pressable onPressIn={() => haptics.light()} accessibilityRole="button" accessibilityLabel="Calendario" accessibilityHint="Apre il calendario">
            {children}
          </Pressable>
        </Link.Trigger>
      </Link>
    </View>
  );
}

/** Today's weekday and date, as on the Calendar app's icon. */
function CalendarDate({ color }: { color: string }) {
  const today = useToday();
  return (
    <>
      <AppText weight="700" style={[styles.weekday, { color }]}>
        {weekdayShort(weekdayOf(today)).toUpperCase()}
      </AppText>
      <AppText weight="700" numeric style={[styles.date, { color }]}>
        {String(Number(today.slice(8)))}
      </AppText>
    </>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  capsule: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: BAR,
    borderRadius: BAR / 2,
    overflow: 'hidden',
  },
  solid: { borderWidth: StyleSheet.hairlineWidth, boxShadow: '0 8px 24px rgba(0, 0, 0, 0.14)' },
  items: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6 },
  half: { flex: 1, alignItems: 'center' },
  item: {
    minWidth: 92,
    height: BAR - 12,
    paddingHorizontal: Spacing.md,
    borderRadius: (BAR - 12) / 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  label: { fontSize: 10, lineHeight: 12 },
  pressed: { opacity: 0.6 },
  circleSlot: { position: 'absolute', top: 0, width: CENTER, height: CENTER },
  circle: {
    width: CENTER,
    height: CENTER,
    borderRadius: CENTER / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // In the solid version, a collar of the bar's colour joins the button to the capsule.
  circleRing: { position: 'absolute', top: -5, width: CENTER + 10, height: CENTER + 10, borderRadius: (CENTER + 10) / 2 },
  weekday: { fontSize: 11, lineHeight: 13, letterSpacing: 0.8, opacity: 0.9 },
  date: { fontSize: 28, lineHeight: 30 },
  accessorySlot: { marginBottom: Spacing.md },
  accessory: { height: ACCESSORY, borderRadius: ACCESSORY / 2, borderCurve: 'continuous', overflow: 'hidden', justifyContent: 'center' },
});
