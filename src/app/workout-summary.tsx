import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState, type ComponentProps } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  ZoomIn,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { Radius, Spacing } from '@/constants/theme';
import { useLiveQuery } from '@/db/live';
import { getPreviousOfSameDay, getRecords, getWorkout, type Workout } from '@/db/workouts';
import { useExerciseNames } from '@/hooks/use-exercise-names';
import { useTheme } from '@/hooks/use-theme';
import { formatLongDate } from '@/lib/dates';
import { MUSCLES } from '@/lib/exercises';
import { formatNumber } from '@/lib/format';
import { bestOneRepMax, formatSet, formatWorkoutLength, isWorkSet, setsPerMuscle, tonnage } from '@/lib/training';
import { haptics } from '@/services/haptics';

function totals(workout: Workout) {
  const sets = workout.exercises.flatMap((e) => e.sets);
  const work = sets.filter(isWorkSet);
  return {
    seconds: workout.endedAt ? (new Date(workout.endedAt).getTime() - new Date(workout.startedAt).getTime()) / 1000 : 0,
    volume: tonnage(sets),
    sets: work.length,
    reps: work.reduce((sum, s) => sum + (s.reps ?? 0), 0),
  };
}

/**
 * The end of a workout, as a moment: the badge pops with a burst of confetti, the numbers count
 * up, then the records and what was done arrive one after the other.
 */
export default function WorkoutSummaryScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { names } = useExerciseNames();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Number(params.id);
  // Read once: the screen is a moment, it does not follow later edits.
  const { data } = useLiveQuery(`summary:${id}`, async (database) => {
    const [workout, records, previous] = await Promise.all([
      getWorkout(database, id),
      getRecords(database, id),
      getPreviousOfSameDay(database, id),
    ]);
    return { workout, records, previous };
  }, []);

  useEffect(() => {
    if (!data?.workout) return;
    const timers = [setTimeout(() => haptics.success(), 180)];
    // A tap for each record as it lands.
    data.records.forEach((_, i) => timers.push(setTimeout(() => haptics.light(), RECORDS_AT + i * 140)));
    return () => timers.forEach(clearTimeout);
  }, [data]);

  // It may lie over the workout sheet it was ended from: closing goes back past both.
  const close = () => router.dismissAll();

  if (!data) return <View style={[styles.flex, { backgroundColor: theme.background }]} />;
  const { workout, records, previous } = data;
  if (!workout) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <AppText tone="textSecondary">Allenamento eliminato.</AppText>
        <Button title="Chiudi" variant="plain" onPress={close} />
      </View>
    );
  }

  const now = totals(workout);
  const before = previous ? totals(previous) : null;
  const change = before && before.volume > 0 ? (now.volume - before.volume) / before.volume : null;
  const muscles = setsPerMuscle(
    workout.exercises.map((e) => ({
      muscle: e.exercise.muscle,
      secondary: e.exercise.secondary,
      count: e.sets.filter(isWorkSet).length,
    })),
  );
  const worked = MUSCLES.filter((m) => (muscles.get(m.key) ?? 0) >= 1).sort(
    (a, b) => (muscles.get(b.key) ?? 0) - (muscles.get(a.key) ?? 0),
  );
  const exercisesAt = RECORDS_AT + records.length * 140 + (records.length > 0 ? 200 : 0);

  return (
    <View style={[styles.flex, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.xxl, paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Burst />
          <Badge trophy={records.length > 0} />
          <Animated.View entering={FadeInDown.delay(260).duration(420)} style={styles.heroText}>
            <AppText variant="title" align="center">
              {records.length > 0 ? 'Nuovo record!' : 'Allenamento completato'}
            </AppText>
            <AppText variant="subhead" tone="textSecondary" align="center">
              {`${workout.name} · ${formatLongDate(workout.date)}`}
            </AppText>
          </Animated.View>
        </View>

        <View style={styles.grid}>
          <Stat index={0} label="Durata" value={now.seconds} format={formatWorkoutLength} icon="stopwatch" />
          <Stat index={1} label="Volume" value={now.volume} format={(v) => `${formatNumber(v, 0)} kg`} icon="scalemass" />
          <Stat index={2} label="Serie" value={now.sets} format={(v) => formatNumber(v, 0)} icon="square.stack.3d.up" />
          <Stat index={3} label="Ripetizioni" value={now.reps} format={(v) => formatNumber(v, 0)} icon="repeat" />
        </View>

        {change !== null && Math.abs(change) >= 0.01 ? (
          <Animated.View
            entering={FadeIn.delay(STATS_AT + 500).duration(300)}
            style={[styles.change, { backgroundColor: change > 0 ? theme.accentSoft : theme.fill }]}>
            <Icon name={change > 0 ? 'arrow.up.right' : 'arrow.down.right'} size={14} weight="semibold" tone={change > 0 ? 'accent' : 'textSecondary'} />
            <AppText variant="subhead" weight="600" tone={change > 0 ? 'accent' : 'textSecondary'}>
              {`${change > 0 ? '+' : '−'}${formatNumber(Math.abs(change) * 100, 0)}% di volume rispetto all’ultima volta`}
            </AppText>
          </Animated.View>
        ) : null}

        {records.length > 0 ? (
          <View style={styles.section}>
            <Animated.View entering={FadeIn.delay(RECORDS_AT - 100)}>
              <AppText variant="footnote" weight="600" tone="textSecondary" style={styles.sectionTitle}>
                {records.length === 1 ? 'RECORD' : `${records.length} RECORD`}
              </AppText>
            </Animated.View>
            {records.map((r, i) => (
              <Animated.View
                key={r.exercise.id}
                entering={ZoomIn.delay(RECORDS_AT + i * 140).springify().damping(14)}
                style={[styles.record, { backgroundColor: theme.card }]}>
                <View style={[styles.trophy, { backgroundColor: `${theme.ringCloser}26` }]}>
                  <Icon name="trophy.fill" size={20} color={theme.ringCloser} />
                </View>
                <View style={styles.flex}>
                  <AppText variant="headline" numberOfLines={1}>
                    {names(r.exercise).title}
                  </AppText>
                  <AppText variant="footnote" tone="textSecondary" numeric>
                    {`Massimale stimato ${formatNumber(r.oneRepMax, 1)} kg`}
                  </AppText>
                </View>
                <AppText variant="subhead" weight="700" numeric style={{ color: theme.ringCloser }}>
                  {`+${formatNumber(r.oneRepMax - r.previous, 1)} kg`}
                </AppText>
              </Animated.View>
            ))}
          </View>
        ) : null}

        <Animated.View entering={FadeInDown.delay(exercisesAt).duration(380)} style={styles.section}>
          <AppText variant="footnote" weight="600" tone="textSecondary" style={styles.sectionTitle}>
            ESERCIZI
          </AppText>
          <View style={[styles.list, { backgroundColor: theme.card }]}>
            {workout.exercises.map((ex, i) => {
              const work = ex.sets.filter(isWorkSet);
              const best = work.reduce<(typeof work)[number] | null>(
                (a, b) => (a === null || (bestOneRepMax([b]) ?? 0) > (bestOneRepMax([a]) ?? 0) ? b : a),
                null,
              );
              return (
                <View
                  key={ex.id}
                  style={[styles.exercise, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator }]}>
                  <Icon name="checkmark.circle.fill" size={20} tone="accent" />
                  <View style={styles.flex}>
                    <AppText numberOfLines={1}>{names(ex.exercise).title}</AppText>
                    <AppText variant="footnote" tone="textSecondary" numeric numberOfLines={1}>
                      {[`${work.length} serie`, best ? `migliore ${formatSet(best, ex.exercise.kind)}` : null].filter(Boolean).join(' · ')}
                    </AppText>
                  </View>
                </View>
              );
            })}
          </View>
        </Animated.View>

        {worked.length > 0 ? (
          <Animated.View entering={FadeInDown.delay(exercisesAt + 120).duration(380)} style={styles.section}>
            <AppText variant="footnote" weight="600" tone="textSecondary" style={styles.sectionTitle}>
              MUSCOLI
            </AppText>
            <View style={styles.chips}>
              {worked.map((m) => (
                <View key={m.key} style={[styles.chip, { backgroundColor: theme.card }]}>
                  <AppText variant="subhead">{m.label}</AppText>
                  <AppText variant="subhead" tone="textSecondary" numeric>
                    {formatNumber(muscles.get(m.key) ?? 0, (muscles.get(m.key) ?? 0) % 1 === 0 ? 0 : 1)}
                  </AppText>
                </View>
              ))}
            </View>
          </Animated.View>
        ) : null}
      </ScrollView>

      <Animated.View
        entering={FadeIn.delay(STATS_AT).duration(300)}
        style={[styles.footer, { paddingBottom: insets.bottom + Spacing.sm, backgroundColor: theme.background }]}>
        <Button title="Fine" onPress={close} />
        <Button
          title="Vedi tutte le serie"
          variant="plain"
          compact
          onPress={() => {
            close();
            router.push({ pathname: '/training/session', params: { id: workout.id } });
          }}
        />
      </Animated.View>
    </View>
  );
}

const STATS_AT = 420;
const RECORDS_AT = 1100;

/** The round badge: it pops in with a bounce while a ring spreads out of it and fades. */
function Badge({ trophy }: { trophy: boolean }) {
  const theme = useTheme();
  const pop = useSharedValue(0);
  const wave = useSharedValue(0);
  useEffect(() => {
    pop.set(withSpring(1, { duration: 650, dampingRatio: 0.45 }));
    wave.set(withDelay(120, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) })));
  }, [pop, wave]);
  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.get() }] }));
  const waveStyle = useAnimatedStyle(() => ({ opacity: 0.5 * (1 - wave.get()), transform: [{ scale: 1 + wave.get() * 0.9 }] }));
  const color = trophy ? theme.ringCloser : theme.accent;
  return (
    <View style={styles.badgeSlot}>
      <Animated.View style={[styles.badge, { backgroundColor: color }, waveStyle]} />
      <Animated.View style={[styles.badge, { backgroundColor: color }, badgeStyle]}>
        <Icon name={trophy ? 'trophy.fill' : 'checkmark'} size={52} weight="bold" color="#FFFFFF" />
      </Animated.View>
    </View>
  );
}

/** A number that counts up from zero, with its label, in a tile. */
function Stat({
  index,
  label,
  value,
  format,
  icon,
}: {
  index: number;
  label: string;
  value: number;
  format: (v: number) => string;
  icon: ComponentProps<typeof Icon>['name'];
}) {
  const theme = useTheme();
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const delay = STATS_AT + index * 80;
    const duration = 900;
    let frame = 0;
    const startAt = Date.now() + delay;
    const tick = () => {
      const t = Math.min(1, Math.max(0, (Date.now() - startAt) / duration));
      // Ease out: fast at first, settling on the value.
      setShown(value * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [index, value]);
  return (
    <Animated.View entering={FadeInDown.delay(STATS_AT + index * 80).duration(380)} style={[styles.stat, { backgroundColor: theme.card }]}>
      <Icon name={icon} size={16} tone="accent" weight="semibold" />
      <AppText variant="title2" numeric numberOfLines={1} adjustsFontSizeToFit>
        {format(shown)}
      </AppText>
      <AppText variant="footnote" tone="textSecondary">
        {label}
      </AppText>
    </Animated.View>
  );
}

const PIECES = 40;

/** Confetti thrown up from behind the badge, falling and spinning out of sight. */
function Burst() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const colors = [theme.accent, theme.ringCloser, theme.ringFar, theme.carbs, theme.fat, theme.protein];
  const [pieces] = useState(() =>
    Array.from({ length: PIECES }, (_, i) => {
      // Mostly upwards, fanned out to both sides.
      const angle = (-90 + (Math.random() - 0.5) * 150) * (Math.PI / 180);
      const speed = 380 + Math.random() * 420;
      return {
        vx: Math.cos(angle) * speed * (width / 400),
        vy: Math.sin(angle) * speed,
        spin: (Math.random() - 0.5) * 1440,
        w: 6 + Math.random() * 5,
        h: 9 + Math.random() * 7,
        color: i,
      };
    }),
  );
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withDelay(80, withTiming(1, { duration: 1800, easing: Easing.linear })));
  }, [t]);
  return (
    <View pointerEvents="none" style={styles.burst}>
      {pieces.map((p, i) => (
        <Piece key={i} t={t} piece={p} color={colors[p.color % colors.length]} />
      ))}
    </View>
  );
}

function Piece({
  t,
  piece,
  color,
}: {
  t: SharedValue<number>;
  piece: { vx: number; vy: number; spin: number; w: number; h: number };
  color: string;
}) {
  const style = useAnimatedStyle(() => {
    const seconds = t.get() * 1.8;
    const gravity = 900;
    return {
      opacity: t.get() === 0 ? 0 : 1 - Math.max(0, (t.get() - 0.6) / 0.4),
      transform: [
        { translateX: piece.vx * seconds * 0.8 },
        { translateY: piece.vy * seconds + 0.5 * gravity * seconds * seconds },
        { rotate: `${piece.spin * t.get()}deg` },
      ],
    };
  });
  return <Animated.View style={[styles.piece, { width: piece.w, height: piece.h, backgroundColor: color }, style]} />;
}

const BADGE = 112;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.lg },
  hero: { alignItems: 'center', gap: Spacing.lg, marginBottom: Spacing.sm },
  heroText: { gap: Spacing.xs, alignItems: 'center' },
  badgeSlot: { width: BADGE, height: BADGE, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', width: BADGE, height: BADGE, borderRadius: BADGE / 2, alignItems: 'center', justifyContent: 'center' },
  burst: { position: 'absolute', top: BADGE / 2, left: '50%', width: 0, height: 0, zIndex: 1 },
  piece: { position: 'absolute', borderRadius: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  stat: { flexBasis: '47%', flexGrow: 1, padding: Spacing.lg, borderRadius: Radius.lg, borderCurve: 'continuous', gap: 2 },
  change: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
  },
  section: { gap: Spacing.sm },
  sectionTitle: { paddingHorizontal: Spacing.lg },
  record: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    paddingRight: Spacing.lg,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
  },
  trophy: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  list: { borderRadius: Radius.lg, borderCurve: 'continuous', overflow: 'hidden' },
  exercise: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { flexDirection: 'row', gap: 6, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.pill },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, gap: Spacing.xs },
});
