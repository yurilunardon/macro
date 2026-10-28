import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { Radius, Spacing } from '@/constants/theme';
import type { DaySummary, Program } from '@/db/programs';
import { useTheme } from '@/hooks/use-theme';
import { muscleLabel } from '@/lib/exercises';
import { countLabel } from '@/lib/format';
import { dayIcon } from '@/lib/training';
import { haptics } from '@/services/haptics';

import { AppText } from './app-text';
import { Button } from './button';
import { DayBadge } from './day-badge';
import { Icon } from './icon';
import { MenuButton } from './menu-button';

/** How far each sheet behind shows below the one before it. */
const PEEK = 10;
/** How much smaller each sheet behind is. */
const SHRINK = 0.06;
/** Sheets drawn behind the one in front. */
const BEHIND = 2;

type DayDeckProps = {
  program: Program;
  /** The next day, as saved. */
  dayId: number;
  /** A day swiped to or picked: save it as the next one. */
  onPick: (dayId: number) => void;
  onStart: (dayId: number) => void;
  onChangeProgram: () => void;
};

/**
 * The program's days as a pile of sheets, the next workout on top and the days after it under
 * it, their edges showing. Swiping the top sheet away brings the one under it up, as in a card
 * stack carousel; swiping back brings the previous day down on top. ⌃⌄ lists the days, and
 * picking one leafs through the pile to it.
 *
 * The pile is a paging scroll view: iOS moves it, with its own physics, and each sheet is only
 * drawn where the scroll puts it, on the UI thread. Nothing is mounted or reordered on a change.
 */
export function DayDeck({ program, dayId, onPick, onStart, onChangeProgram }: DayDeckProps) {
  const { width } = useWindowDimensions();
  const n = program.days.length;
  // The pile starts from the day that was next when it appeared and goes round the program from
  // there, so the sheets under the top one are always the days that come after it.
  const [firstId] = useState(dayId);
  const start = Math.max(0, program.days.findIndex((d) => d.id === firstId));
  const days = [...program.days.slice(start), ...program.days.slice(0, start)];
  const indexOf = (id: number) => Math.max(0, days.findIndex((d) => d.id === id));
  const ref = useRef<Animated.ScrollView>(null);
  const [current, setCurrent] = useState(() => indexOf(dayId));
  const x = useSharedValue(indexOf(dayId) * width);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      x.set(event.contentOffset.x);
    },
  });

  // The next day changed elsewhere (a workout done, a day picked in a program): leaf to it.
  const [seen, setSeen] = useState(dayId);
  if (seen !== dayId) {
    setSeen(dayId);
    setCurrent(indexOf(dayId));
  }
  // In place before the first frame (contentOffset alone is not enough everywhere), then each
  // change of the day in front leafs to it.
  useLayoutEffect(() => {
    ref.current?.scrollTo({ x: indexOf(dayId) * width, animated: false });
    // Only when it appears: later changes go through `current`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    ref.current?.scrollTo({ x: current * width, animated: true });
  }, [current, width]);

  /** The pile came to rest on a sheet. */
  const settle = (offset: number) => {
    const index = Math.max(0, Math.min(n - 1, Math.round(offset / width)));
    if (index === current) return;
    haptics.selection();
    setCurrent(index);
    onPick(days[index].id);
  };

  const pick = (index: number) => {
    if (index === current) return;
    haptics.selection();
    setCurrent(index);
    onPick(days[index].id);
  };

  return (
    <Animated.ScrollView
      ref={ref}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      contentOffset={{ x: indexOf(dayId) * width, y: 0 }}
      onScroll={onScroll}
      scrollEventThrottle={16}
      onMomentumScrollEnd={(event) => settle(event.nativeEvent.contentOffset.x)}
      style={styles.pager}>
      {days.map((day, index) => (
        <Sheet key={day.id} index={index} count={n} x={x} width={width}>
          <SheetContent
            program={program}
            day={day}
            onStart={() => onStart(day.id)}
            switcher={
              <MenuButton
                // Only the sheet in front gets the native menu.
                inert={index !== current}
                icon="chevron.up.chevron.down"
                accessibilityLabel={`Prossimo giorno: ${day.name}. Scegli un altro giorno`}
                groups={[
                  {
                    title: `Giorni di ${program.name}`,
                    // In the program's order, whatever the pile's.
                    actions: program.days.map((d) => ({
                      label: d.name,
                      icon: dayIcon(d.name),
                      checked: d.id === days[current]?.id,
                      onPress: () => pick(indexOf(d.id)),
                    })),
                  },
                  { actions: [{ label: 'Cambia scheda', icon: 'list.bullet.rectangle', onPress: onChangeProgram }] },
                ]}>
                <SwitchLook />
              </MenuButton>
            }
          />
        </Sheet>
      ))}
    </Animated.ScrollView>
  );
}

/** ⌃⌄ in a round button, in the sheet's corner. */
function SwitchLook() {
  const theme = useTheme();
  return (
    <View style={[styles.switch, { backgroundColor: theme.fill }]}>
      <Icon name="chevron.up.chevron.down" size={16} tone="accent" weight="semibold" />
    </View>
  );
}

/**
 * One page of the pile. A sheet before the one in front scrolls away with the finger; a sheet
 * after it is held in place under it, smaller and lower with each place back, its bottom edge
 * showing, and grows into the front as the scroll reaches it.
 */
function Sheet({ index, count, x, width, children }: { index: number; count: number; x: SharedValue<number>; width: number; children: ReactNode }) {
  const theme = useTheme();
  const style = useAnimatedStyle(() => {
    // How many places behind the front this sheet is: 0 in front, below 0 already passed.
    const p = index - x.get() / width;
    if (p <= 0) {
      return { opacity: 1, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 + Math.max(-1, p) * 0.05 }] };
    }
    const depth = Math.min(p, BEHIND + 1);
    return {
      opacity: Math.max(0, Math.min(1, BEHIND + 1 - p)),
      transform: [{ translateX: -p * width }, { translateY: depth * PEEK }, { scale: 1 - depth * SHRINK }],
    };
  });
  const veil = useAnimatedStyle(() => ({ opacity: Math.max(0, Math.min(BEHIND, index - x.get() / width)) * 0.22 }));
  return (
    // The earlier days above the later ones, so the one in front covers the pile.
    <View style={[styles.page, { width, zIndex: count - index }]}>
      <Animated.View style={[styles.sheet, { backgroundColor: theme.card }, style]}>
        {children}
        <Animated.View pointerEvents="none" style={[styles.veil, { backgroundColor: theme.background }, veil]} />
      </Animated.View>
    </View>
  );
}

/** What a sheet says: the program, the day with what it trains, and "Inizia". */
function SheetContent({ program, day, switcher, onStart }: { program: Program; day: DaySummary; switcher: ReactNode; onStart: () => void }) {
  return (
    <View style={styles.content}>
      <View style={styles.top}>
        <AppText variant="footnote" weight="600" tone="textSecondary" style={styles.flex} numberOfLines={1}>
          {`PROSSIMO · ${program.name.toUpperCase()}`}
        </AppText>
        {switcher}
      </View>
      <View style={styles.name}>
        <DayBadge name={day.name} size={40} />
        <AppText variant="title" numberOfLines={1} style={styles.shrink}>
          {day.name}
        </AppText>
      </View>
      <AppText variant="subhead" tone="textSecondary" numberOfLines={1}>
        {[countLabel(day.exerciseCount, 'esercizio', 'esercizi'), day.muscles.map(muscleLabel).join(', ')].filter(Boolean).join(' · ')}
      </AppText>
      <View style={styles.button}>
        <Button title="Inizia" onPress={onStart} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  // Out of the screen's side margins, so a sheet swiped away leaves by the screen's edge.
  pager: { marginHorizontal: -Spacing.lg },
  page: { paddingHorizontal: Spacing.lg, paddingBottom: PEEK * BEHIND },
  sheet: {
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    // Scaled from the bottom edge, so each sheet behind shows exactly PEEK under the one before.
    transformOrigin: 'bottom center',
    boxShadow: '0 2px 10px rgba(0, 0, 0, 0.08)',
  },
  veil: { ...StyleSheet.absoluteFill, borderRadius: Radius.lg, borderCurve: 'continuous' },
  content: { padding: Spacing.lg, gap: Spacing.xs },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 32 },
  // Over the sheet's padding, so the circle sits in its corner without pushing the name down.
  switch: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginVertical: -Spacing.xs },
  name: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.xs },
  button: { marginTop: Spacing.md },
});
