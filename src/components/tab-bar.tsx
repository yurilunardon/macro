import { GlassContainer, GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
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

import { AppText } from './app-text';
import { Icon } from './icon';

const glass = isLiquidGlassAvailable();

export type TabBarStyle = 'capsule' | 'circles' | 'fab';

type Target = 'left' | 'center' | 'right';
type Rect = { x: number; y: number; w: number; h: number };
/** A piece of glass and the buttons it holds. */
type Shape = Rect & { tint: boolean; holds: readonly Target[] };
type Layout = {
  width: number;
  height: number;
  shapes: readonly Shape[];
  /** Each button's area, in the bar's coordinates. */
  slots: Record<Target, Rect>;
  /** Tabs with their names under the symbol, on a sliding lens; or symbols alone in circles. */
  labels: boolean;
};

/** The tab bar's capsule, as tall as iOS's own. */
const BAR = 62;
/** Glass this close together flows into one piece. */
const MERGE = 24;
/** A drag counts over a button this far outside it too. */
const SLOP = 24;
/** The workout in progress, in a capsule of its own above. */
const ACCESSORY = 56;
const ACCESSORY_WIDTH = 330;
const LENS_SPRING = { duration: 380, dampingRatio: 0.78 };

/**
 * The three looks, all with the calendar bigger and green:
 * - capsule: the two tabs in one capsule, the calendar's circle rising out of its middle;
 * - circles: three circles melted together, the calendar's higher up between the tabs;
 * - fab: the tabs' capsule and, beside it, the calendar's circle, as Search in Photos and Music.
 */
function layoutFor(style: TabBarStyle, screen: number): Layout {
  if (style === 'circles') {
    const side = 58;
    const center = 70;
    const rise = 22;
    const spread = 44;
    const width = 2 * spread + side;
    const tabTop = center / 2 + rise - side / 2;
    const left = { x: 0, y: tabTop, w: side, h: side };
    const right = { x: width - side, y: tabTop, w: side, h: side };
    const middle = { x: (width - center) / 2, y: 0, w: center, h: center };
    return {
      width,
      height: tabTop + side,
      shapes: [
        { ...left, tint: false, holds: ['left'] },
        { ...right, tint: false, holds: ['right'] },
        { ...middle, tint: true, holds: ['center'] },
      ],
      slots: { left, center: middle, right },
      labels: false,
    };
  }
  if (style === 'fab') {
    const circle = 68;
    const gap = 10;
    const capsule = Math.min(screen - 2 * Spacing.xl - circle - gap, 230);
    const top = (circle - BAR) / 2;
    const half = capsule / 2;
    return {
      width: capsule + gap + circle,
      height: circle,
      shapes: [
        { x: 0, y: top, w: capsule, h: BAR, tint: false, holds: ['left', 'right'] },
        { x: capsule + gap, y: 0, w: circle, h: circle, tint: true, holds: ['center'] },
      ],
      slots: {
        left: { x: 4, y: top + 4, w: half - 6, h: BAR - 8 },
        right: { x: half + 2, y: top + 4, w: half - 6, h: BAR - 8 },
        center: { x: capsule + gap, y: 0, w: circle, h: circle },
      },
      labels: true,
    };
  }
  const circle = 72;
  const rise = 16;
  const width = Math.min(screen - 2 * Spacing.xl, 280);
  const side = (width - circle) / 2 - 8;
  return {
    width,
    height: BAR + rise,
    shapes: [
      { x: 0, y: rise, w: width, h: BAR, tint: false, holds: ['left', 'right'] },
      { x: (width - circle) / 2, y: 0, w: circle, h: circle, tint: true, holds: ['center'] },
    ],
    slots: {
      left: { x: 6, y: rise + 4, w: side, h: BAR - 8 },
      right: { x: width - 6 - side, y: rise + 4, w: side, h: BAR - 8 },
      center: { x: (width - circle) / 2, y: 0, w: circle, h: circle },
    },
    labels: true,
  };
}

/** How far a point is outside a button: round ones by their circle, the others by their box. */
function distanceTo(slot: Rect, round: boolean, x: number, y: number): number {
  if (round) return Math.hypot(x - (slot.x + slot.w / 2), y - (slot.y + slot.h / 2)) - slot.w / 2;
  const dx = Math.max(slot.x - x, 0, x - (slot.x + slot.w));
  const dy = Math.max(slot.y - y, 0, y - (slot.y + slot.h));
  return Math.hypot(dx, dy);
}

/** The button under a point, or the nearest within reach. */
function targetAt(layout: Layout, x: number, y: number): Target | null {
  let best: Target | null = null;
  let distance = Infinity;
  for (const target of ['left', 'center', 'right'] as const) {
    const d = distanceTo(layout.slots[target], target === 'center' || !layout.labels, x, y);
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
export function tabBarInset(safeBottom: number, accessory: boolean, style: TabBarStyle, screen: number): number {
  const top = barBottom(safeBottom) + layoutFor(style, screen).height + Spacing.sm + (accessory ? ACCESSORY + Spacing.md : 0);
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
  look: TabBarStyle;
  screen: number;
  safeBottom: number;
  /** The routes of the three buttons, by name; the one in `center` is the calendar. */
  routes: Record<Target, string>;
  tabs: Record<string, Tab>;
  /** Shown in a capsule of its own above, as the mini player in Music. */
  accessory?: ReactNode;
};

/**
 * The tab bar in Liquid Glass, with the calendar in a bigger green circle showing today's date.
 * A tap picks a button; holding and sliding moves across them and picks the one under the
 * finger on release, as in iOS's own tab bar.
 */
export function TabBar({ state, emitter, navigateToTab, look, screen, safeBottom, routes, tabs, accessory }: TabBarProps) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const layout = layoutFor(look, screen);
  const [hover, setHover] = useState<Target | null>(null);
  const hovered = useRef<Target | null>(null);

  const focusedName = state.routes[state.index]?.name;
  const focused = (['left', 'center', 'right'] as const).find((t) => routes[t] === focusedName) ?? null;

  const press = (target: Target) => {
    const route = state.routes.find((r) => r.name === routes[target]);
    if (!route) return;
    // A tap on the tab on screen goes back to its first page, as in iOS.
    const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (target === focused || event.defaultPrevented) return;
    haptics.selection();
    navigateToTab(route.key);
  };

  const track = (x: number, y: number) => {
    const target = targetAt(layout, x, y);
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
      if (!event.canceled && hovered.current) press(hovered.current);
    },
    onFinalize: () => {
      hovered.current = null;
      setHover(null);
    },
  });

  // The lens under the tab on screen, or under a sliding finger, glides from one to the other.
  const lensOn = hover ?? focused;
  const lensColor = scheme === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.07)';
  const lensX = useSharedValue(lensOn === 'right' ? 1 : 0);
  const lensShown = useSharedValue(lensOn === 'left' || lensOn === 'right' ? 1 : 0);
  useEffect(() => {
    if (lensOn === 'left' || lensOn === 'right') lensX.set(withSpring(lensOn === 'right' ? 1 : 0, LENS_SPRING));
    lensShown.set(withSpring(lensOn === 'left' || lensOn === 'right' ? 1 : 0, LENS_SPRING));
  }, [lensOn, lensX, lensShown]);
  const { left: from, right: to } = layout.slots;
  const lensStyle = useAnimatedStyle(() => ({
    opacity: lensShown.get(),
    transform: [{ translateX: lensX.get() * (to.x - from.x) }, { scale: 0.85 + 0.15 * lensShown.get() }],
  }));

  const button = (target: Target, shape: Shape) => {
    const slot = layout.slots[target];
    const position = { left: slot.x - shape.x, top: slot.y - shape.y, width: slot.w, height: slot.h };
    if (target === 'center') {
      return (
        <Pressable
          key={target}
          onPress={() => press(target)}
          accessibilityRole="tab"
          accessibilityState={{ selected: focused === 'center' }}
          accessibilityLabel="Calendario"
          style={[styles.slot, position]}>
          {hover === 'center' ? <View style={[styles.round, styles.centerLens]} /> : null}
          {focused === 'center' ? <View style={[styles.round, styles.ring]} /> : null}
          <CalendarDate color={glass ? '#FFFFFF' : theme.onAccent} big={slot.w >= 70} />
        </Pressable>
      );
    }
    const tab = tabs[routes[target]];
    if (!tab) return null;
    const on = focused === target;
    const tint = on ? theme.accent : theme.text;
    return (
      <Pressable
        key={target}
        onPress={() => press(target)}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        accessibilityLabel={tab.label}
        style={[styles.slot, position]}>
        {!layout.labels && hover === target ? <View style={[styles.round, styles.inset, { backgroundColor: lensColor }]} /> : null}
        <Icon name={on ? (tab.selectedIcon ?? tab.icon) : tab.icon} size={layout.labels ? 22 : 24} color={tint} weight="semibold" />
        {layout.labels ? (
          <AppText variant="caption" weight="600" numberOfLines={1} style={[styles.label, { color: tint }]}>
            {tab.label}
          </AppText>
        ) : null}
      </Pressable>
    );
  };

  const contents = (shape: Shape) => (
    <>
      {layout.labels && shape.holds.includes('left') ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.lens,
            { left: from.x - shape.x, top: from.y - shape.y, width: from.w, height: from.h, backgroundColor: lensColor },
            lensStyle,
          ]}
        />
      ) : null}
      {shape.holds.map((target) => button(target, shape))}
    </>
  );
  const frame = (shape: Shape) => ({
    left: shape.x,
    top: shape.y,
    width: shape.w,
    height: shape.h,
    borderRadius: Math.min(shape.w, shape.h) / 2,
  });

  return (
    <View pointerEvents="box-none" style={[styles.root, { bottom: barBottom(safeBottom) }]}>
      {accessory ? (
        <View style={[styles.accessorySlot, { width: Math.min(screen - 2 * Spacing.xl, Math.max(layout.width, ACCESSORY_WIDTH)) }]}>
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
        <View accessibilityRole="tablist" style={{ width: layout.width, height: layout.height }}>
          {glass ? (
            // The pieces are direct children of one container, and nothing clips them: iOS draws
            // the joins between them outside their frames.
            <GlassContainer spacing={MERGE} style={StyleSheet.absoluteFill}>
              {layout.shapes.map((shape) => (
                <GlassView
                  key={shape.holds.join()}
                  style={[styles.shape, frame(shape)]}
                  glassEffectStyle="regular"
                  tintColor={shape.tint ? theme.accent : undefined}
                  isInteractive>
                  {contents(shape)}
                </GlassView>
              ))}
            </GlassContainer>
          ) : (
            // Without Liquid Glass: the same shapes, solid. The shadows go first, under all of
            // them, so they join without seams.
            <View style={StyleSheet.absoluteFill}>
              {layout.shapes.map((shape) => (
                <View key={`shadow-${shape.holds.join()}`} style={[styles.shape, styles.shadow, frame(shape)]} />
              ))}
              {layout.shapes.map((shape) => (
                <View
                  key={shape.holds.join()}
                  style={[styles.shape, frame(shape), { backgroundColor: shape.tint ? theme.accent : theme.card }]}>
                  {contents(shape)}
                </View>
              ))}
            </View>
          )}
        </View>
      </GestureDetector>
    </View>
  );
}

/** Today's weekday and date, as on the Calendar app's icon. */
function CalendarDate({ color, big }: { color: string; big: boolean }) {
  const today = useToday();
  return (
    <>
      <AppText weight="700" style={[styles.weekday, { color }]}>
        {weekdayShort(weekdayOf(today)).toUpperCase()}
      </AppText>
      <AppText weight="700" numeric style={[big ? styles.date : styles.dateSmall, { color }]}>
        {String(Number(today.slice(8)))}
      </AppText>
    </>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  shape: { position: 'absolute', borderCurve: 'continuous' },
  shadow: { boxShadow: '0 8px 24px rgba(0, 0, 0, 0.16)' },
  solid: { borderWidth: StyleSheet.hairlineWidth, boxShadow: '0 8px 24px rgba(0, 0, 0, 0.14)' },
  slot: { position: 'absolute', alignItems: 'center', justifyContent: 'center', gap: 2 },
  lens: { position: 'absolute', borderRadius: (BAR - 8) / 2, borderCurve: 'continuous' },
  round: { ...StyleSheet.absoluteFill, borderRadius: 999 },
  inset: { margin: 5 },
  centerLens: { backgroundColor: 'rgba(255,255,255,0.2)' },
  // The calendar on screen: a thin white ring inside its circle.
  ring: { margin: 4, borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)' },
  label: { fontSize: 10, lineHeight: 12 },
  weekday: { fontSize: 10, lineHeight: 12, letterSpacing: 0.8, opacity: 0.9 },
  date: { fontSize: 26, lineHeight: 28 },
  dateSmall: { fontSize: 23, lineHeight: 25 },
  accessorySlot: { marginBottom: Spacing.md },
  accessory: { height: ACCESSORY, borderRadius: ACCESSORY / 2, borderCurve: 'continuous', justifyContent: 'center' },
});
