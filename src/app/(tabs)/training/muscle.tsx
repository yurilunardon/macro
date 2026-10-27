import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/components/app-text';
import { Card, ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { Icon } from '@/components/icon';
import { ScreenScroll } from '@/components/screen';
import { Spacing } from '@/constants/theme';
import { useLiveQuery } from '@/db/live';
import { getWorkSetsByDay } from '@/db/workouts';
import { useExerciseNames } from '@/hooks/use-exercise-names';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { addDays, formatShortDate, weekOf, type DateKey } from '@/lib/dates';
import { isMuscle, muscleLabel, type Muscle } from '@/lib/exercises';
import { formatNumber } from '@/lib/format';
import { muscleShare, WEEKLY_SETS } from '@/lib/training';

const WEEKS = 8;

function sets(value: number): string {
  return `${formatNumber(value, value % 1 === 0 ? 0 : 1)} serie`;
}

/** One muscle: this week's sets against the useful range, the last weeks, and where they came from. */
export default function MuscleScreen() {
  const router = useRouter();
  const today = useToday();
  const { names } = useExerciseNames();
  const params = useLocalSearchParams<{ muscle?: string }>();
  const muscle: Muscle = isMuscle(params.muscle) ? params.muscle : 'chest';
  const monday = weekOf(today)[0];
  const from = addDays(monday, -7 * (WEEKS - 1));
  const { data } = useLiveQuery(`muscle:${muscle}:${monday}`, (database) => getWorkSetsByDay(database, from, addDays(monday, 6)), [
    'training',
  ]);

  if (!data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const rows = data
    .map((r) => ({ ...r, share: muscleShare(r.exercise, muscle) }))
    .filter((r) => r.share > 0);
  const weeks = Array.from({ length: WEEKS }, (_, i) => {
    const start = addDays(from, i * 7);
    const end = addDays(start, 6);
    const total = rows.filter((r) => r.date >= start && r.date <= end).reduce((sum, r) => sum + r.count * r.share, 0);
    return { start, total };
  });
  const current = weeks[WEEKS - 1].total;

  // This week's exercises, the ones that counted most first.
  const byExercise = new Map<number, { exercise: (typeof rows)[number]['exercise']; share: number; count: number }>();
  for (const r of rows.filter((x) => x.date >= monday)) {
    const entry = byExercise.get(r.exercise.id) ?? { exercise: r.exercise, share: r.share, count: 0 };
    entry.count += r.count;
    byExercise.set(r.exercise.id, entry);
  }
  const exercises = [...byExercise.values()].sort((a, b) => b.count * b.share - a.count * a.share);

  const below = current < WEEKLY_SETS.low;
  const above = current > WEEKLY_SETS.high;
  const verdict = below
    ? { title: 'Sotto la fascia utile', text: `Mancano ${sets(WEEKLY_SETS.low - current)} per arrivare a ${WEEKLY_SETS.low}.`, tone: 'warning' as const }
    : above
      ? { title: 'Sopra la fascia utile', text: 'Va bene solo se recuperi tra un allenamento e l’altro.', tone: 'warning' as const }
      : { title: 'Nella fascia utile', text: `Tra ${WEEKLY_SETS.low} e ${WEEKLY_SETS.high} serie a settimana.`, tone: 'accent' as const };

  return (
    <ScreenScroll>
      <Stack.Screen options={{ title: muscleLabel(muscle) }} />

      <Card style={styles.hero}>
        <AppText variant="footnote" weight="600" tone="textSecondary">
          QUESTA SETTIMANA
        </AppText>
        <View style={styles.big}>
          <AppText variant="display" numeric>
            {formatNumber(current, current % 1 === 0 ? 0 : 1)}
          </AppText>
          <AppText variant="headline" tone="textSecondary">
            serie
          </AppText>
        </View>
        <RangeBar value={current} />
        <View style={styles.verdict}>
          <Icon name={below || above ? 'exclamationmark.circle.fill' : 'checkmark.circle.fill'} size={18} tone={verdict.tone} />
          <View style={styles.flex}>
            <AppText variant="subhead" weight="600" tone={verdict.tone}>
              {verdict.title}
            </AppText>
            <AppText variant="subhead" tone="textSecondary">
              {verdict.text}
            </AppText>
          </View>
        </View>
      </Card>

      <SectionTitle>{`Ultime ${WEEKS} settimane`}</SectionTitle>
      <Card>
        <WeeksChart weeks={weeks} />
      </Card>

      <SectionTitle>Esercizi della settimana</SectionTitle>
      {exercises.length > 0 ? (
        <ListGroup>
          {exercises.map(({ exercise, share, count }) => (
            <Row
              key={exercise.id}
              title={names(exercise).title}
              subtitle={share === 1 ? 'Muscolo principale' : `Secondario · ${sets(count)} contano metà`}
              detail={sets(count * share)}
              onPress={() => router.push({ pathname: '/training/exercise', params: { id: exercise.id } })}
            />
          ))}
        </ListGroup>
      ) : (
        <Card>
          <AppText variant="subhead" tone="textSecondary">
            Nessuna serie questa settimana.
          </AppText>
        </Card>
      )}
      <SectionFooter>
        Contano le serie allenanti, senza riscaldamento: intere per il muscolo principale dell’esercizio, a metà per i
        secondari.
      </SectionFooter>
    </ScreenScroll>
  );
}

const SCALE_MAX = 25;

/** 0–25 sets with the useful 10–20 band shaded and a marker on this week's value. */
function RangeBar({ value }: { value: number }) {
  const theme = useTheme();
  const at = (v: number) => `${(Math.min(v, SCALE_MAX) / SCALE_MAX) * 100}%` as const;
  const inRange = value >= WEEKLY_SETS.low && value <= WEEKLY_SETS.high;
  return (
    <View style={styles.range}>
      <View style={[styles.rangeTrack, { backgroundColor: theme.track }]}>
        <View
          style={[
            styles.rangeBand,
            { left: at(WEEKLY_SETS.low), width: at(WEEKLY_SETS.high - WEEKLY_SETS.low), backgroundColor: theme.accentSoft },
          ]}
        />
        <View style={[styles.rangeFill, { width: at(value), backgroundColor: inRange ? theme.accent : theme.ringCloser }]} />
      </View>
      <View style={styles.rangeLabels}>
        <AppText variant="caption" tone="textSecondary" numeric style={[styles.rangeLabel, { left: at(WEEKLY_SETS.low) }]}>
          {String(WEEKLY_SETS.low)}
        </AppText>
        <AppText variant="caption" tone="textSecondary" numeric style={[styles.rangeLabel, { left: at(WEEKLY_SETS.high) }]}>
          {String(WEEKLY_SETS.high)}
        </AppText>
      </View>
    </View>
  );
}

const AnimatedRect = Animated.createAnimatedComponent(Rect);

/** Sets per week as bars over the shaded useful band; the bars grow in when the screen opens. */
function WeeksChart({ weeks }: { weeks: readonly { start: DateKey; total: number }[] }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const height = 150;
  const pad = { top: 8, bottom: 22 };
  const plot = height - pad.top - pad.bottom;
  const max = Math.max(SCALE_MAX, ...weeks.map((w) => w.total));
  const y = (v: number) => pad.top + (1 - v / max) * plot;
  const slot = width / weeks.length;
  const bar = Math.min(26, slot * 0.55);
  const grow = useSharedValue(0);
  useEffect(() => {
    grow.set(withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) }));
  }, [grow]);

  return (
    <View
      style={{ height }}
      onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width))}
      accessible
      accessibilityLabel={weeks.map((w) => `settimana del ${formatShortDate(w.start)}: ${sets(w.total)}`).join(', ')}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Rect
            x={0}
            width={width}
            y={y(WEEKLY_SETS.high)}
            height={y(WEEKLY_SETS.low) - y(WEEKLY_SETS.high)}
            fill={theme.accentSoft}
            rx={6}
          />
          {weeks.map((w, i) => (
            <Bar
              key={w.start}
              x={i * slot + (slot - bar) / 2}
              width={bar}
              base={pad.top + plot}
              top={y(w.total)}
              grow={grow}
              color={
                w.total === 0
                  ? theme.track
                  : w.total >= WEEKLY_SETS.low && w.total <= WEEKLY_SETS.high
                    ? theme.accent
                    : theme.ringCloser
              }
            />
          ))}
          {weeks.map((w, i) => (
            <SvgText
              key={`l${w.start}`}
              x={i * slot + slot / 2}
              y={height - 6}
              fontSize={11}
              fill={i === weeks.length - 1 ? theme.text : theme.textSecondary}
              fontWeight={i === weeks.length - 1 ? '600' : '400'}
              textAnchor="middle">
              {i === weeks.length - 1 ? 'Ora' : `${Number(w.start.slice(8))}/${Number(w.start.slice(5, 7))}`}
            </SvgText>
          ))}
        </Svg>
      ) : null}
    </View>
  );
}

function Bar({
  x,
  width,
  base,
  top,
  color,
  grow,
}: {
  x: number;
  width: number;
  base: number;
  top: number;
  color: string;
  grow: ReturnType<typeof useSharedValue<number>>;
}) {
  // An empty week still shows a sliver, so the gap reads as "nothing" rather than missing data.
  const full = Math.max(3, base - top);
  const props = useAnimatedProps(() => ({ y: base - full * grow.get(), height: full * grow.get() }));
  return <AnimatedRect x={x} width={width} rx={Math.min(5, width / 2)} fill={color} animatedProps={props} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  hero: { gap: Spacing.sm },
  big: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm },
  verdict: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  range: { gap: 4, marginTop: Spacing.xs },
  rangeTrack: { height: 10, borderRadius: 5, overflow: 'hidden' },
  rangeBand: { position: 'absolute', top: 0, bottom: 0 },
  rangeFill: { height: '100%', borderRadius: 5 },
  rangeLabels: { height: 16 },
  rangeLabel: { position: 'absolute', width: 24, marginLeft: -12, textAlign: 'center' },
});
