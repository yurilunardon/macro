import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Link } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import type { SFSymbol } from 'expo-symbols';
import { createContext, use, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { weekdayShort } from '@/lib/calendar';
import { weekdayOf } from '@/lib/dates';
import { haptics } from '@/services/haptics';

import { NOTCHED_TAB_BAR_BUTTON, NOTCHED_TAB_BAR_HEIGHT, NotchedTabBarView } from '../../modules/notched-tab-bar';

import { AppText } from './app-text';
import { Icon } from './icon';

const glass = isLiquidGlassAvailable();

/** The tabs' capsule, as tall as iOS's own, at most this wide. */
const BAR = 62;
const BAR_WIDTH = 300;
/** The calendar's button, floating over the middle of the capsule with its centre near the top edge. */
const FAB = NOTCHED_TAB_BAR_BUTTON;
const HEIGHT = NOTCHED_TAB_BAR_HEIGHT;
/** The lens under the tab on screen, a little inside the capsule. */
const LENS_INSET = 4;
const LENS_SPRING = { duration: 380, dampingRatio: 0.78 };
const FOLLOW_SPRING = { duration: 160, dampingRatio: 1 };
/** The workout in progress, in a capsule of its own above. */
const ACCESSORY = 56;
const ACCESSORY_WIDTH = 330;

type Side = 'left' | 'right';

/** Each tab has the capsule's end up to the circle, less a little air. */
function slotWidth(width: number): number {
  return (width - FAB) / 2 - LENS_INSET;
}

/** Where the lens rests under a tab, from the capsule's left edge. */
function restOf(side: Side, width: number): number {
  return side === 'left' ? LENS_INSET : width - LENS_INSET - slotWidth(width);
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

type Tab = { label: string; icon: SFSymbol; selectedIcon?: SFSymbol };

type TabBarProps = BottomTabBarProps & {
  screen: number;
  safeBottom: number;
  /** The tabs at the two ends of the capsule, by route name. */
  left: string;
  right: string;
  tabs: Record<string, Tab>;
  /** Shown in a capsule of its own above, as the mini player in Music. */
  accessory?: ReactNode;
};

/**
 * A floating action button over a tab bar, in Liquid Glass. The capsule holds the two tabs and
 * runs on under the calendar's round button, which floats on its own in a cradle cut into the
 * middle of the capsule. Holding and sliding along the capsule moves its lens from one tab to
 * the other, under the button, and picks the tab on release; the button only opens the
 * calendar, which grows out of it and shrinks back into it.
 */
export function TabBar({ state, emitter, navigateToTab, screen, safeBottom, left, right, tabs, accessory }: TabBarProps) {
  const theme = useTheme();
  const width = Math.min(screen - 2 * Spacing.xl, BAR_WIDTH);

  const focusedName = state.routes[state.index]?.name;
  const focused: Side | null = focusedName === left ? 'left' : focusedName === right ? 'right' : null;

  const press = (name: string) => {
    const route = state.routes.find((r) => r.name === name);
    if (!route) return;
    const on = state.routes[state.index]?.key === route.key;
    // A tap on the tab on screen goes back to its first page, as in iOS.
    const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (on || event.defaultPrevented) return;
    haptics.selection();
    navigateToTab(route.key);
  };
  const bar: BarProps = { width, focused, tabs, left, right, press };

  return (
    <View pointerEvents="box-none" style={[styles.root, { bottom: barBottom(safeBottom) }]}>
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
      {NotchedTabBarView ? <SwiftUIBar {...bar} /> : <ReactBar {...bar} />}
    </View>
  );
}

type BarProps = {
  width: number;
  focused: Side | null;
  tabs: Record<string, Tab>;
  left: string;
  right: string;
  press: (name: string) => void;
};

/**
 * The calendar's button: the calendar's sheet grows out of it with the system's zoom, and
 * shrinks back into it when dragged down.
 */
function CalendarLink({ onPressIn, onPressOut, children }: { onPressIn?: () => void; onPressOut?: () => void; children?: ReactNode }) {
  return (
    <Link href="/calendar" asChild>
      <Link.Trigger withAppleZoom>
        <Pressable
          onPressIn={() => {
            haptics.light();
            onPressIn?.();
          }}
          onPressOut={onPressOut}
          accessibilityRole="button"
          accessibilityLabel="Calendario"
          accessibilityHint="Apre il calendario"
          // A Link.Trigger's child takes one plain style: the web passes it on as is.
          style={styles.fabTouch}>
          {children}
        </Pressable>
      </Link.Trigger>
    </Link>
  );
}

/**
 * Drawn in SwiftUI (modules/notched-tab-bar), the only way to give Liquid Glass the cradle's
 * shape. The calendar's button is drawn there too, under a transparent React Native one that
 * the calendar zooms out of.
 */
function SwiftUIBar({ width, focused, tabs, left, right, press }: BarProps) {
  const theme = useTheme();
  const today = useToday();
  const last = useRef({ tab: '', at: 0 });
  const [pressed, setPressed] = useState(false);
  if (!NotchedTabBarView) return null;
  const leftTab = tabs[left];
  const rightTab = tabs[right];
  return (
    <View style={{ width, height: HEIGHT }}>
      <NotchedTabBarView
        accessibilityRole="tablist"
        style={StyleSheet.absoluteFill}
        leftLabel={leftTab?.label ?? ''}
        leftIcon={leftTab?.icon ?? 'circle'}
        leftSelectedIcon={leftTab?.selectedIcon}
        rightLabel={rightTab?.label ?? ''}
        rightIcon={rightTab?.icon ?? 'circle'}
        rightSelectedIcon={rightTab?.selectedIcon}
        selected={focused ?? 'none'}
        weekday={weekdayShort(weekdayOf(today)).toUpperCase()}
        day={String(Number(today.slice(8)))}
        accent={theme.accent}
        calendarPressed={pressed}
        onSelect={({ nativeEvent: { tab } }) => {
          // A tap that is also a short slide can report the same pick twice.
          const now = Date.now();
          if (last.current.tab === tab && now - last.current.at < 400) return;
          last.current = { tab, at: now };
          press(tab === 'left' ? left : right);
        }}
      />
      <View style={[styles.fabSlot, { left: (width - FAB) / 2 }]}>
        <CalendarLink onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)} />
      </View>
    </View>
  );
}

/** The same bar in React Native, where the native one is missing (the web): without the cradle. */
function ReactBar({ width, focused, tabs, left, right, press }: BarProps) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const slot = slotWidth(width);
  const rest: Record<Side, number> = { left: restOf('left', width), right: restOf('right', width) };

  // The lens rests under the tab on screen.
  const lensX = useSharedValue(rest[focused === 'right' ? 'right' : 'left']);
  const lensShown = useSharedValue(focused === 'left' || focused === 'right' ? 1 : 0);
  const lifted = useSharedValue(0);
  const settle = (side: Side | null) => {
    if (side === 'left' || side === 'right') lensX.set(withSpring(restOf(side, width), LENS_SPRING));
    lensShown.set(withSpring(side === 'left' || side === 'right' ? 1 : 0, LENS_SPRING));
  };
  useEffect(() => {
    if (focused === 'left' || focused === 'right') lensX.set(withSpring(restOf(focused, width), LENS_SPRING));
    lensShown.set(withSpring(focused === 'left' || focused === 'right' ? 1 : 0, LENS_SPRING));
  }, [focused, width, lensX, lensShown]);

  // While a finger slides along the capsule, the lens follows it, lifted, and picks a tab on release.
  const over = useRef<Side | null>(null);
  const picked = useRef(false);
  // A slide ends on a tab too: its tap must not count as well.
  const slid = useRef(false);
  const sideAt = (x: number): Side => (x < width / 2 ? 'left' : 'right');
  const follow = (x: number) => {
    lensX.set(withSpring(Math.min(Math.max(x - slot / 2, rest.left), rest.right), FOLLOW_SPRING));
    const side = sideAt(x);
    if (side !== over.current) {
      over.current = side;
      haptics.selection();
    }
  };
  const pan = usePanGesture({
    minDistance: 4,
    runOnJS: true,
    onBegin: () => {
      slid.current = false;
    },
    onActivate: (event) => {
      slid.current = true;
      picked.current = false;
      over.current = sideAt(event.x);
      lensShown.set(withSpring(1, LENS_SPRING));
      lifted.set(withSpring(1, LENS_SPRING));
      follow(event.x);
    },
    onUpdate: (event) => follow(event.x),
    onDeactivate: (event) => {
      const side = over.current;
      if (event.canceled || !side) return;
      picked.current = true;
      press(side === 'left' ? left : right);
      settle(side);
    },
    onFinalize: () => {
      over.current = null;
      lifted.set(withSpring(0, LENS_SPRING));
      // Back under the tab on screen if the slide picked nothing.
      if (!picked.current) settle(focused);
      picked.current = false;
    },
  });
  const lensStyle = useAnimatedStyle(() => ({
    opacity: lensShown.get(),
    transform: [{ translateX: lensX.get() }, { scale: (0.85 + 0.15 * lensShown.get()) * (1 + 0.06 * lifted.get()) }],
  }));
  const lensColor = scheme === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.07)';

  const tab = (side: Side) => {
    const name = side === 'left' ? left : right;
    const item = tabs[name];
    if (!item) return null;
    const on = focused === side;
    const tint = on ? theme.accent : theme.text;
    return (
      <Pressable
        key={side}
        onPress={() => {
          if (!slid.current) press(name);
        }}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        accessibilityLabel={item.label}
        style={[styles.tab, { left: rest[side], width: slot }]}>
        <Icon name={on ? (item.selectedIcon ?? item.icon) : item.icon} size={22} color={tint} weight="semibold" />
        <AppText variant="caption" weight="600" numberOfLines={1} style={[styles.label, { color: tint }]}>
          {item.label}
        </AppText>
      </Pressable>
    );
  };

  const capsuleContent = (
    <>
      <Animated.View pointerEvents="none" style={[styles.lens, { width: slot, backgroundColor: lensColor }, lensStyle]} />
      {tab('left')}
      {tab('right')}
    </>
  );

  const fab = (
    <CalendarLink>
      <CalendarDate weekdayColor={theme.accent} dayColor={theme.text} />
    </CalendarLink>
  );

  return (
    <View accessibilityRole="tablist" style={{ width, height: HEIGHT }}>
      <GestureDetector gesture={pan}>
        <View style={styles.capsuleSlot}>
          {glass ? (
            <GlassView style={styles.capsule} glassEffectStyle="regular" isInteractive>
              {capsuleContent}
            </GlassView>
          ) : (
            <View style={[styles.capsule, styles.solid, { backgroundColor: theme.card, borderColor: theme.separator }]}>
              {capsuleContent}
            </View>
          )}
        </View>
      </GestureDetector>

      {/* On its own, not melted into the capsule: the calendar is a button, not a tab to slide to. */}
      <View style={[styles.fabSlot, { left: (width - FAB) / 2 }]}>
        {glass ? (
          <GlassView style={styles.fab} glassEffectStyle="regular" isInteractive>
            {fab}
          </GlassView>
        ) : (
          <View style={[styles.fab, styles.solid, { backgroundColor: theme.card, borderColor: theme.separator }]}>{fab}</View>
        )}
      </View>
    </View>
  );
}

/** Today's weekday and date, as on the Calendar app's icon. */
function CalendarDate({ weekdayColor, dayColor }: { weekdayColor: string; dayColor: string }) {
  const today = useToday();
  return (
    <>
      <AppText weight="700" style={[styles.weekday, { color: weekdayColor }]}>
        {weekdayShort(weekdayOf(today)).toUpperCase()}
      </AppText>
      <AppText weight="600" numeric style={[styles.date, { color: dayColor }]}>
        {String(Number(today.slice(8)))}
      </AppText>
    </>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  // Glass is never clipped: iOS draws its edge light just outside the frame.
  capsuleSlot: { position: 'absolute', left: 0, right: 0, bottom: 0, height: BAR },
  capsule: { flex: 1, borderRadius: BAR / 2, borderCurve: 'continuous' },
  solid: { borderWidth: StyleSheet.hairlineWidth, boxShadow: '0 8px 24px rgba(0, 0, 0, 0.14)' },
  lens: { position: 'absolute', left: 0, top: LENS_INSET, bottom: LENS_INSET, borderRadius: (BAR - 2 * LENS_INSET) / 2 },
  tab: { position: 'absolute', top: LENS_INSET, bottom: LENS_INSET, alignItems: 'center', justifyContent: 'center', gap: 2 },
  label: { fontSize: 10, lineHeight: 12 },
  fabSlot: { position: 'absolute', top: 0, width: FAB, height: FAB },
  fab: { width: FAB, height: FAB, borderRadius: FAB / 2 },
  fabTouch: { width: FAB, height: FAB, borderRadius: FAB / 2, alignItems: 'center', justifyContent: 'center' },
  weekday: { fontSize: 10, lineHeight: 12, letterSpacing: 0.8 },
  date: { fontSize: 24, lineHeight: 26 },
  accessorySlot: { marginBottom: Spacing.md },
  accessory: { height: ACCESSORY, borderRadius: ACCESSORY / 2, borderCurve: 'continuous', justifyContent: 'center' },
});
