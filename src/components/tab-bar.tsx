import { GlassContainer, GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Link, useRouter } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import type { SymbolViewProps } from 'expo-symbols';
import { createContext, use, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
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

/** The two tabs' circles and the calendar's bigger one, which sits higher, between them. */
const SIDE = 58;
const CENTER = 70;
/** How much higher the calendar's centre is than the tabs', and how far apart they are across. */
const RISE = 22;
const SPREAD = 44;
/** Glass this close together flows into one piece. */
const MERGE = 30;
/** A drag counts over a circle this far outside it too. */
const SLOP = 24;
/** The workout in progress, in a capsule of its own above. */
const ACCESSORY = 56;
const ACCESSORY_WIDTH = 330;

const WIDTH = 2 * SPREAD + SIDE;
const HEIGHT = CENTER / 2 + RISE + SIDE / 2;
const TAB_TOP = CENTER / 2 + RISE - SIDE / 2;

type Target = 'left' | 'center' | 'right';

/** The circles' centres and radii, in the bar's own coordinates. */
const CIRCLES: Record<Target, { x: number; y: number; r: number }> = {
  left: { x: SIDE / 2, y: TAB_TOP + SIDE / 2, r: SIDE / 2 },
  center: { x: WIDTH / 2, y: CENTER / 2, r: CENTER / 2 },
  right: { x: WIDTH - SIDE / 2, y: TAB_TOP + SIDE / 2, r: SIDE / 2 },
};

/** The circle under a point: the one it is deepest in, or the nearest within reach. */
function targetAt(x: number, y: number): Target | null {
  let best: Target | null = null;
  let distance = Infinity;
  for (const target of ['left', 'center', 'right'] as const) {
    const c = CIRCLES[target];
    const d = Math.hypot(x - c.x, y - c.y) - c.r;
    if (d < distance) {
      best = target;
      distance = d;
    }
  }
  return distance <= SLOP ? best : null;
}

/** Where the bar's bottom edge sits: inside the home indicator's area, as iOS's own bar. */
function barBottom(safeBottom: number): number {
  return Math.max(safeBottom - 12, 12);
}

/**
 * How much of the page the bar covers above the safe area, which iOS already keeps clear: the
 * scroll views inside the tabs add it at the bottom so their end can scroll out from under it.
 */
export function tabBarInset(safeBottom: number, accessory: boolean): number {
  const top = barBottom(safeBottom) + HEIGHT + Spacing.sm + (accessory ? ACCESSORY + Spacing.md : 0);
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
 * Three circles of Liquid Glass melted into one piece: a tab low on each side and the calendar,
 * bigger and green, higher up between them. A tap picks one; holding and sliding moves across
 * them and picks the one under the finger on release, as in iOS's own tab bar. The calendar
 * opens out of its circle and shrinks back into it.
 */
export function TabBar({ state, emitter, navigateToTab, left, right, tabs, accessory }: TabBarProps) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screen } = useWindowDimensions();
  const [hover, setHover] = useState<Target | null>(null);
  const hovered = useRef<Target | null>(null);

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
  const names: Record<Exclude<Target, 'center'>, string> = { left, right };

  const track = (x: number, y: number) => {
    const target = targetAt(x, y);
    if (target === hovered.current) return;
    hovered.current = target;
    setHover(target);
    if (target) haptics.selection();
  };
  const pan = usePanGesture({
    minDistance: 4,
    runOnJS: true,
    onActivate: (event) => track(event.x, event.y),
    onUpdate: (event) => track(event.x, event.y),
    onDeactivate: (event) => {
      const target = hovered.current;
      if (event.canceled || !target) return;
      if (target === 'center') router.push('/calendar');
      else press(names[target]);
    },
    onFinalize: () => {
      hovered.current = null;
      setHover(null);
    },
  });

  const focusedName = state.routes[state.index]?.name;
  // The circle under a sliding finger lights up; the tab on screen is the green one.
  const lens = scheme === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.07)';

  const tab = (side: 'left' | 'right') => {
    const name = names[side];
    const item = tabs[name];
    if (!item) return null;
    const focused = focusedName === name;
    return (
      <Pressable
        onPress={() => press(name)}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={item.label}
        style={styles.fill}>
        <View style={[styles.lens, hover === side && { backgroundColor: lens }]}>
          <Icon
            name={focused ? (item.selectedIcon ?? item.icon) : item.icon}
            size={24}
            color={focused ? theme.accent : theme.text}
            weight="semibold"
          />
        </View>
      </Pressable>
    );
  };

  const calendar = (
    <Link href="/calendar" asChild>
      <Link.Trigger withAppleZoom>
        <Pressable
          onPressIn={() => haptics.light()}
          accessibilityRole="button"
          accessibilityLabel="Calendario"
          accessibilityHint="Apre il calendario"
          style={styles.fill}>
          {/* A Link.Trigger's child takes one plain style: the web passes it on as is. */}
          <View style={[styles.fill, styles.stretch, hover === 'center' && styles.centerLens]}>
            <CalendarDate color={glass ? '#FFFFFF' : theme.onAccent} />
          </View>
        </Pressable>
      </Link.Trigger>
    </Link>
  );

  return (
    <View pointerEvents="box-none" style={[styles.root, { bottom: barBottom(insets.bottom) }]}>
      {accessory ? (
        <View style={[styles.accessorySlot, { width: Math.min(screen - 2 * Spacing.xl, ACCESSORY_WIDTH) }]}>
          {glass ? (
            <GlassView style={styles.accessory} glassEffectStyle="regular" isInteractive>
              {accessory}
            </GlassView>
          ) : (
            <View style={[styles.accessory, styles.solid, { backgroundColor: theme.card, borderColor: theme.separator }]}>{accessory}</View>
          )}
        </View>
      ) : null}

      <GestureDetector gesture={pan}>
        <View accessibilityRole="tablist" style={styles.bar}>
          {glass ? (
            <GlassContainer spacing={MERGE} style={StyleSheet.absoluteFill}>
              <GlassView style={[styles.side, styles.left]} glassEffectStyle="regular" isInteractive>
                {tab('left')}
              </GlassView>
              <GlassView style={[styles.side, styles.right]} glassEffectStyle="regular" isInteractive>
                {tab('right')}
              </GlassView>
              <GlassView style={styles.center} glassEffectStyle="regular" tintColor={theme.accent} isInteractive>
                {calendar}
              </GlassView>
            </GlassContainer>
          ) : (
            // Without Liquid Glass: the same shape, solid. The shadows go first, under all three
            // circles, so they join without seams.
            <View style={StyleSheet.absoluteFill}>
              <View style={[styles.side, styles.left, styles.shadow]} />
              <View style={[styles.side, styles.right, styles.shadow]} />
              <View style={[styles.center, styles.shadow]} />
              <View style={[styles.side, styles.left, { backgroundColor: theme.card }]}>{tab('left')}</View>
              <View style={[styles.side, styles.right, { backgroundColor: theme.card }]}>{tab('right')}</View>
              <View style={[styles.center, { backgroundColor: theme.accent }]}>{calendar}</View>
            </View>
          )}
        </View>
      </GestureDetector>
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
  bar: { width: WIDTH, height: HEIGHT },
  side: { position: 'absolute', top: TAB_TOP, width: SIDE, height: SIDE, borderRadius: SIDE / 2, overflow: 'hidden' },
  left: { left: 0 },
  right: { right: 0 },
  center: {
    position: 'absolute',
    top: 0,
    left: (WIDTH - CENTER) / 2,
    width: CENTER,
    height: CENTER,
    borderRadius: CENTER / 2,
    overflow: 'hidden',
  },
  shadow: { boxShadow: '0 6px 20px rgba(0, 0, 0, 0.16)' },
  solid: { borderWidth: StyleSheet.hairlineWidth, boxShadow: '0 8px 24px rgba(0, 0, 0, 0.14)' },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stretch: { alignSelf: 'stretch' },
  lens: { width: SIDE - 10, height: SIDE - 10, borderRadius: (SIDE - 10) / 2, alignItems: 'center', justifyContent: 'center' },
  centerLens: { backgroundColor: 'rgba(255,255,255,0.18)' },
  weekday: { fontSize: 10, lineHeight: 12, letterSpacing: 0.8, opacity: 0.9 },
  date: { fontSize: 26, lineHeight: 28 },
  accessorySlot: { marginBottom: Spacing.md },
  accessory: { height: ACCESSORY, borderRadius: ACCESSORY / 2, borderCurve: 'continuous', overflow: 'hidden', justifyContent: 'center' },
});
