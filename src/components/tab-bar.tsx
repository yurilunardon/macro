import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { SymbolViewProps } from 'expo-symbols';
import { createContext, use, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
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

/** The bar's capsule. */
const BAR = 64;
/** The round button in the middle, and how far it rises above the capsule. */
const CENTER = 68;
const RISE = 18;
const SIDE = 20;
/** The workout in progress, in its own capsule above the bar. */
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
  const top = barBottom(safeBottom) + BAR + Spacing.sm + (accessory ? RISE + ACCESSORY + Spacing.sm : 0);
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

type SideTab = { label: string; icon: SymbolViewProps['name']; selectedIcon?: SymbolViewProps['name'] };

type TabBarProps = BottomTabBarProps & {
  /** The route drawn as the big round button in the middle. */
  center: string;
  sides: Record<string, SideTab>;
  /** Shown in a capsule of its own above the bar, as the mini player in Music. */
  accessory?: ReactNode;
};

/**
 * The tab bar: one tab on each side and, raised in the middle, a bigger round button with
 * today's date, as on the Calendar app's icon. iOS's own tab bar cannot draw an item bigger than
 * the others, so this one is drawn here, floating over the page in Liquid Glass like iOS's.
 */
export function TabBar({ state, descriptors, emitter, navigateToTab, center, sides, accessory }: TabBarProps) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const today = useToday();

  const press = (index: number) => {
    const route = state.routes[index];
    const focused = state.index === index;
    // A tap on the tab on screen goes back to its first page, as in iOS.
    const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (focused || event.defaultPrevented) return;
    haptics.selection();
    navigateToTab(route.key);
  };

  const centerIndex = state.routes.findIndex((r) => r.name === center);
  const sideIndexes = state.routes.map((_, i) => i).filter((i) => i !== centerIndex);
  const lens = scheme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)';
  const bottom = barBottom(insets.bottom);

  const capsule = (
    <View style={styles.items}>
      {sideIndexes.map((index, i) => {
        const route = state.routes[index];
        const tab = sides[route.name];
        if (!tab) return null;
        const focused = state.index === index;
        const tint = focused ? theme.accent : theme.text;
        return (
          // The middle of the capsule is left to the round button.
          <View key={route.key} style={[styles.slot, i === 0 ? styles.left : styles.right]}>
            <Pressable
              onPress={() => press(index)}
              onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key })}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={descriptors[route.key]?.options.tabBarAccessibilityLabel ?? tab.label}
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

  return (
    <View pointerEvents="box-none" style={[styles.root, { bottom }]}>
      {accessory ? (
        <View style={{ marginBottom: RISE + Spacing.sm }}>
          {glass ? (
            <GlassView style={styles.accessory} glassEffectStyle="regular" isInteractive>
              {accessory}
            </GlassView>
          ) : (
            <View style={[styles.accessory, styles.solid, { backgroundColor: theme.card, borderColor: theme.separator }]}>{accessory}</View>
          )}
        </View>
      ) : null}

      <View pointerEvents="box-none" accessibilityRole="tablist" style={styles.bar}>
        {glass ? (
          <GlassView style={styles.capsule} glassEffectStyle="regular">
            {capsule}
          </GlassView>
        ) : (
          <View style={[styles.capsule, styles.solid, { backgroundColor: theme.card, borderColor: theme.separator }]}>{capsule}</View>
        )}

        {centerIndex >= 0 ? (
          <View pointerEvents="box-none" style={styles.centerSlot}>
            <PressableScale
              scaleTo={0.9}
              onPress={() => press(centerIndex)}
              accessibilityRole="tab"
              accessibilityState={{ selected: state.index === centerIndex }}
              accessibilityLabel="Calendario"
              style={[
                styles.center,
                { backgroundColor: theme.accent, borderColor: theme.background },
                state.index === centerIndex && styles.centerOn,
              ]}>
              <AppText weight="700" style={[styles.weekday, { color: theme.onAccent }]}>
                {weekdayShort(weekdayOf(today)).toUpperCase()}
              </AppText>
              <AppText weight="700" numeric style={[styles.date, { color: theme.onAccent }]}>
                {String(Number(today.slice(8)))}
              </AppText>
            </PressableScale>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: SIDE, right: SIDE },
  bar: { height: BAR, justifyContent: 'center' },
  capsule: { height: BAR, borderRadius: BAR / 2, borderCurve: 'continuous', overflow: 'hidden' },
  solid: { borderWidth: StyleSheet.hairlineWidth, boxShadow: '0 8px 24px rgba(0, 0, 0, 0.14)' },
  items: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6 },
  // Each side tab takes what the round button leaves, centred in it.
  slot: { flex: 1, alignItems: 'center' },
  left: { marginRight: CENTER / 2 + Spacing.sm },
  right: { marginLeft: CENTER / 2 + Spacing.sm },
  item: {
    minWidth: 96,
    height: BAR - 12,
    paddingHorizontal: Spacing.md,
    borderRadius: (BAR - 12) / 2,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  label: { fontSize: 11, lineHeight: 13 },
  pressed: { opacity: 0.6 },
  centerSlot: { position: 'absolute', left: 0, right: 0, top: -RISE, alignItems: 'center' },
  center: {
    width: CENTER,
    height: CENTER,
    borderRadius: CENTER / 2,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 6px 16px rgba(0, 0, 0, 0.22)',
  },
  // On the calendar, a ring of the page's colour sets it apart from what scrolls behind.
  centerOn: { borderWidth: 3 },
  weekday: { fontSize: 11, lineHeight: 13, letterSpacing: 0.6, opacity: 0.85 },
  date: { fontSize: 26, lineHeight: 28 },
  accessory: { height: ACCESSORY, borderRadius: ACCESSORY / 2, borderCurve: 'continuous', overflow: 'hidden', justifyContent: 'center' },
});
