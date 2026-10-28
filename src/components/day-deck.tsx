import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
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
const PEEK = 7;
/** How much narrower each sheet behind is, on each side. */
const INSET = 10;
const OUT = { duration: 150, easing: Easing.in(Easing.quad) };
const IN = { duration: 240, easing: Easing.out(Easing.cubic) };

type DayDeckProps = {
  program: Program;
  /** The next day, as saved. */
  dayId: number;
  /** A day picked from the menu: save it as the next one. */
  onPick: (dayId: number) => void;
  onStart: (dayId: number) => void;
  onChangeProgram: () => void;
};

/**
 * The next workout, as the top sheet of a pile of the program's days: the days after it show as
 * edges under it. ⌃⌄ lists the days; when one is picked, the top sheet's words slide away, the
 * edges lift a little, as when leafing through, and the day picked comes up in their place.
 *
 * One card and fixed edges behind it: nothing is mounted, unmounted or moved between layers, so
 * the change is two short animations of the same views.
 */
export function DayDeck({ program, dayId, onPick, onStart, onChangeProgram }: DayDeckProps) {
  const theme = useTheme();
  // The day on the sheet trails the saved one by the time its words take to slide away.
  const [shownId, setShownId] = useState(dayId);
  const day = program.days.find((d) => d.id === shownId) ?? program.days.find((d) => d.id === dayId) ?? program.days[0];
  // -1 just below, 0 in place, 1 gone above.
  const words = useSharedValue(0);

  useEffect(() => {
    if (dayId === shownId) return;
    words.set(
      withTiming(1, OUT, (finished) => {
        'worklet';
        if (!finished) return;
        // Still invisible: the new day is written below, then comes up.
        words.set(-1);
        scheduleOnRN(setShownId, dayId);
      }),
    );
  }, [dayId, shownId, words]);
  useEffect(() => {
    words.set(withTiming(0, IN));
  }, [shownId, words]);

  const wordsStyle = useAnimatedStyle(() => {
    const w = words.get();
    return { opacity: 1 - Math.min(1, Math.abs(w)), transform: [{ translateY: -14 * w }] };
  });
  const lift = useAnimatedStyle(() => ({ transform: [{ translateY: -3 * Math.min(1, Math.abs(words.get())) }] }));

  const behind = Math.min(program.days.length - 1, 2);

  return (
    <View style={{ paddingBottom: PEEK * behind }}>
      {/* The days after the next one, as the edges of the sheets under it, the farthest first. */}
      {Array.from({ length: behind }, (_, i) => behind - i).map((place) => (
        <Animated.View
          key={place}
          pointerEvents="none"
          style={[
            styles.edge,
            { top: PEEK * place, bottom: PEEK * (behind - place), left: INSET * place, right: INSET * place, backgroundColor: theme.card },
            lift,
          ]}>
          <View style={[styles.veil, { backgroundColor: theme.background, opacity: 0.3 * place }]} />
        </Animated.View>
      ))}
      <View style={[styles.sheet, { backgroundColor: theme.card }]}>
        <View style={styles.top}>
          <AppText variant="footnote" weight="600" tone="textSecondary" style={styles.flex} numberOfLines={1}>
            {`PROSSIMO · ${program.name.toUpperCase()}`}
          </AppText>
          {/* ⌃⌄ in the corner: the program's days, to pick the next one, and other programs. */}
          <MenuButton
            icon="chevron.up.chevron.down"
            accessibilityLabel={`Prossimo giorno: ${day.name}. Scegli un altro giorno`}
            groups={[
              {
                title: `Giorni di ${program.name}`,
                actions: program.days.map((d) => ({
                  label: d.name,
                  icon: dayIcon(d.name),
                  checked: d.id === dayId,
                  onPress: () => {
                    if (d.id === dayId) return;
                    haptics.selection();
                    onPick(d.id);
                  },
                })),
              },
              { actions: [{ label: 'Cambia scheda', icon: 'list.bullet.rectangle', onPress: onChangeProgram }] },
            ]}>
            <View style={[styles.switch, { backgroundColor: theme.fill }]}>
              <Icon name="chevron.up.chevron.down" size={16} tone="accent" weight="semibold" />
            </View>
          </MenuButton>
        </View>
        <Animated.View style={wordsStyle}>
          <DayWords day={day} />
          <View style={styles.button}>
            <Button title="Inizia" onPress={() => onStart(day.id)} />
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

/** The day's name with its badge, and what it trains. */
function DayWords({ day }: { day: DaySummary }) {
  return (
    <View style={styles.words}>
      <View style={styles.name}>
        <DayBadge name={day.name} size={40} />
        <AppText variant="title" numberOfLines={1} style={styles.shrink}>
          {day.name}
        </AppText>
      </View>
      <AppText variant="subhead" tone="textSecondary" numberOfLines={1}>
        {[countLabel(day.exerciseCount, 'esercizio', 'esercizi'), day.muscles.map(muscleLabel).join(', ')].filter(Boolean).join(' · ')}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  sheet: { padding: Spacing.lg, gap: Spacing.xs, borderRadius: Radius.lg, borderCurve: 'continuous', boxShadow: '0 1px 4px rgba(0, 0, 0, 0.06)' },
  edge: { position: 'absolute', borderRadius: Radius.lg, borderCurve: 'continuous', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)' },
  veil: { ...StyleSheet.absoluteFill, borderRadius: Radius.lg, borderCurve: 'continuous' },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 32 },
  // Over the sheet's padding, so the circle sits in its corner without pushing the name down.
  switch: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginVertical: -Spacing.xs },
  words: { gap: Spacing.xs },
  name: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.xs },
  button: { marginTop: Spacing.md },
});
