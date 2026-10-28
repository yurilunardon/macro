import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

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

/** How far each sheet behind shows below the one in front of it. */
const PEEK = 8;
/** How much narrower each sheet behind is: they recede, as a pile seen from above. */
const SHRINK = 0.05;
/** Sheets in the pile: the one in front and two behind it. */
const DEPTH = 3;
/**
 * The top sheet turning over, during which another turn waits. It starts moving at once, so the
 * tap is answered, and fades over its second half.
 */
const TURN = { duration: 400, easing: Easing.bezier(0.4, 0, 0.6, 1) };
const SETTLE = { duration: 480, dampingRatio: 0.82 };

type DayDeckProps = {
  program: Program;
  /** The next day, as saved. */
  dayId: number;
  /** A day was turned to or picked: save it as the next one. */
  onChange: (dayId: number) => void;
  onStart: (dayId: number) => void;
  onChangeProgram: () => void;
};

/**
 * The days of the program as a pile of sheets, the next one on top and the following ones
 * peeking out under it. ⌃⌄ turns the top sheet over, as the page of a pad, to the next day; held,
 * it lists the days to pick one, and other programs.
 *
 * The pile is a fixed set of sheet views, one more than shown, never mounted or unmounted:
 * turning moves each to its new place, the top one turns away, and that one is written with a
 * new day at the back while nobody sees it.
 */
export function DayDeck({ program, dayId, onChange, onStart, onChangeProgram }: DayDeckProps) {
  const n = program.days.length;
  const indexOf = (id: number) => Math.max(0, program.days.findIndex((d) => d.id === id));
  // Sheets are counted from the first one shown and never back, so each sheet view keeps its
  // count, and its place in the pile, from one turn to the next.
  const [position, setPosition] = useState(() => indexOf(dayId));
  // The saved next day as last seen, and the days this pile saved itself and is waiting to see
  // come back: those it is already showing, so they must not move it.
  const [seen, setSeen] = useState<{ programId: number; dayId: number; ours: number[] }>({ programId: program.id, dayId, ours: [] });
  if (seen.programId !== program.id) {
    setSeen({ programId: program.id, dayId, ours: [] });
    setPosition(indexOf(dayId));
  } else if (seen.dayId !== dayId) {
    // Changed elsewhere (a workout done, a day picked in a program): go forward to it.
    const ours = seen.ours.indexOf(dayId);
    setSeen({ programId: program.id, dayId, ours: ours >= 0 ? seen.ours.slice(ours + 1) : [] });
    if (ours < 0 && program.days[position % n]?.id !== dayId) {
      setPosition(position + ((indexOf(dayId) - (position % n) + n) % n));
    }
  }

  const busy = useRef(false);
  const fade = useSharedValue(1);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.get() }));

  const save = (next: number) => {
    const id = program.days[next % n].id;
    setPosition(next);
    setSeen((current) => ({ ...current, ours: [...current.ours, id] }));
    onChange(id);
  };

  /** ⌃⌄: the top sheet turns over to the next day. */
  const turn = () => {
    if (busy.current) return;
    busy.current = true;
    setTimeout(() => {
      busy.current = false;
    }, TURN.duration);
    haptics.selection();
    save(position + 1);
  };

  /** A day picked from the menu: the pile fades to it, however far it is. */
  const pick = (id: number) => {
    const steps = (indexOf(id) - (position % n) + n) % n;
    if (steps === 0) return;
    if (steps === 1) {
      turn();
      return;
    }
    haptics.selection();
    fade.set(
      withSequence(
        withTiming(0, { duration: 140 }, (finished) => {
          'worklet';
          if (finished) scheduleOnRN(save, position + steps);
        }),
        withDelay(40, withTiming(1, { duration: 200 })),
      ),
    );
  };

  const front = program.days[position % n];
  const visible = Math.min(n, DEPTH);
  // One view more than the sheets shown: the one turning away while the others move up.
  const views = visible + 1;

  const menu = (inert: boolean) => (
    <MenuButton
      inert={inert}
      icon="chevron.up.chevron.down"
      accessibilityLabel={n > 1 ? 'Passa al giorno dopo. Tieni premuto per scegliere' : 'Scegli la scheda'}
      onPrimaryAction={n > 1 ? turn : undefined}
      groups={[
        {
          title: `Giorni di ${program.name}`,
          actions: program.days.map((d) => ({
            label: d.name,
            icon: dayIcon(d.name),
            checked: d.id === front.id,
            onPress: () => pick(d.id),
          })),
        },
        { actions: [{ label: 'Cambia scheda', icon: 'list.bullet.rectangle', onPress: onChangeProgram }] },
      ]}>
      <SwitchLook />
    </MenuButton>
  );

  return (
    <Animated.View style={[{ paddingBottom: PEEK * (visible - 1) }, fadeStyle]}>
      {/* Gives the pile its height: the sheets lie over it. */}
      <View style={styles.sizer} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <SheetContent program={program} day={front} switcher={<SwitchLook />} onStart={() => {}} />
      </View>
      {Array.from({ length: views }, (_, view) => {
        // The sheet this view shows: the one turned away last (place -1), or one in the pile.
        const count = position - 1 + ((((view - (position - 1)) % views) + views) % views);
        const place = count - position;
        const day = program.days[((count % n) + n) % n];
        return (
          <Sheet key={view} place={place} bottom={PEEK * (visible - 1)}>
            <SheetContent program={program} day={day} switcher={menu(place !== 0)} onStart={() => onStart(day.id)} />
          </Sheet>
        );
      })}
    </Animated.View>
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
 * One sheet view. `place` 0 is the top of the pile, 1 and 2 the sheets behind, -1 a sheet turned
 * away. Moving up the pile it slides into place; from the top it turns away; sent from -1 to the
 * back it is already invisible, so it just reappears there.
 */
function Sheet({ place, bottom, children }: { place: number; bottom: number; children: ReactNode }) {
  const theme = useTheme();
  const at = useSharedValue(place);
  const shown = useSharedValue(place < 0 ? 0 : 1);
  const height = useSharedValue(0);
  const previous = useRef(place);
  useEffect(() => {
    const from = previous.current;
    previous.current = place;
    if (place === from) return;
    if (place < 0) {
      at.set(withTiming(place, TURN));
    } else if (place < from) {
      at.set(withSpring(place, SETTLE));
    } else {
      at.set(place);
      shown.set(0);
      shown.set(withDelay(160, withTiming(1, { duration: 260 })));
    }
  }, [at, shown, place]);
  const style = useSheetStyle(at, shown, height);
  // Only the sheet in front is written on: the ones behind are blank edges, and a sheet's words
  // come up as it reaches the front, so two days never show through each other.
  // Turning away, its words go first and only the paper turns, uncovering the day under it.
  const ink = useAnimatedStyle(() => {
    const p = at.get();
    return { opacity: p < 0 ? Math.max(0, 1 + p / 0.35) : Math.max(0, Math.min(1, 1 - p / 0.6)) };
  });
  const veil = useAnimatedStyle(() => ({ opacity: Math.max(0, Math.min(2, at.get())) * 0.28 }));
  return (
    <Animated.View
      onLayout={(event) => height.set(event.nativeEvent.layout.height)}
      pointerEvents={place === 0 ? 'box-none' : 'none'}
      accessibilityElementsHidden={place !== 0}
      importantForAccessibility={place === 0 ? 'auto' : 'no-hide-descendants'}
      // The top sheet above the others, and the one turning away above it.
      style={[styles.sheet, { bottom, zIndex: DEPTH + 1 - place, backgroundColor: theme.card }, style]}>
      <Animated.View style={ink}>{children}</Animated.View>
      {/* The sheets behind recede into the page. */}
      <Animated.View pointerEvents="none" style={[styles.veil, { backgroundColor: theme.background }, veil]} />
    </Animated.View>
  );
}

/**
 * In the pile, narrower and lower with each place back, its bottom edge showing under the sheet
 * before it. Turning away (from 0 to -1), it tips back over its top edge, as a page of a pad
 * turned over, and fades.
 */
function useSheetStyle(at: SharedValue<number>, shown: SharedValue<number>, height: SharedValue<number>) {
  return useAnimatedStyle(() => {
    const p = at.get();
    if (p < 0) {
      const t = Math.min(1, -p);
      return {
        opacity: shown.get() * (1 - Math.max(0, (t - 0.45) / 0.55)),
        transform: [{ perspective: 900 }, { translateY: -12 * t }, { rotateX: `${-80 * t}deg` }, { scale: 1 }],
      };
    }
    const scale = 1 - p * SHRINK;
    // Scaled from its top edge, so this brings its bottom edge PEEK under the one before.
    return {
      opacity: shown.get(),
      transform: [{ perspective: 900 }, { translateY: (1 - scale) * height.get() + p * PEEK }, { rotateX: '0deg' }, { scale }],
    };
  });
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
  sizer: { opacity: 0 },
  sheet: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    transformOrigin: 'top center',
    boxShadow: '0 1px 6px rgba(0, 0, 0, 0.07)',
  },
  veil: { ...StyleSheet.absoluteFill, borderRadius: Radius.lg, borderCurve: 'continuous' },
  content: { padding: Spacing.lg, gap: Spacing.xs },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 32 },
  // Over the sheet's padding, so the circle sits in its corner without pushing the name down.
  switch: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginVertical: -Spacing.xs },
  name: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.xs },
  button: { marginTop: Spacing.md },
});
