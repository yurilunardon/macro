import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card, ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { DayBadge } from '@/components/day-badge';
import { Icon } from '@/components/icon';
import { MenuButton } from '@/components/menu-button';
import { confirmDestructive } from '@/components/prompt';
import { PressableScale } from '@/components/pressable-scale';
import { ProgressBar } from '@/components/progress';
import { ScreenScroll } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Radius, Spacing } from '@/constants/theme';
import { ACTIVE_WORKOUT_KEY, ACTIVE_WORKOUT_TOPICS, loadActiveWorkout } from '@/db/active-workout';
import { prefetchLiveQuery, useLiveQuery } from '@/db/live';
import { getNextDay, getPrograms, setNextDay } from '@/db/programs';
import { deleteWorkout, getActiveWorkout, getWorkoutHistory, getWorkSetsBetween, startWorkout } from '@/db/workouts';
import { useClock } from '@/hooks/use-clock';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { formatDayTitle, weekOf } from '@/lib/dates';
import { MUSCLES, muscleLabel } from '@/lib/exercises';
import { countLabel, formatNumber } from '@/lib/format';
import { dayIcon, formatDuration, formatWorkoutLength, setsPerMuscle, WEEKLY_SETS } from '@/lib/training';
import { endWorkout } from '@/services/end-workout';
import { haptics } from '@/services/haptics';

const { low: VOLUME_LOW, high: VOLUME_HIGH } = WEEKLY_SETS;

export default function TrainingScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const today = useToday();
  const week = weekOf(today);
  const { data } = useLiveQuery(`training-home:${week[0]}`, async (database) => {
    const [active, next, programs, history, volume] = await Promise.all([
      getActiveWorkout(database),
      getNextDay(database),
      getPrograms(database),
      getWorkoutHistory(database, 20),
      getWorkSetsBetween(database, week[0], week[6]),
    ]);
    return { active, next, programs, history, volume };
  }, ['training']);
  const now = useClock(1000, Boolean(data?.active));
  const breath = useBreath(Boolean(data?.active));
  // While the workout sheet rises, this page stays as it was; the card changes once covered.
  const [starting, setStarting] = useState(false);

  const start = async (dayId: number | null) => {
    setStarting(true);
    await startWorkout(db, { dayId });
    // The sheet rises with the exercises already in it.
    await prefetchLiveQuery(db, ACTIVE_WORKOUT_KEY, loadActiveWorkout, ACTIVE_WORKOUT_TOPICS);
    haptics.success();
    router.push('/workout');
    setTimeout(() => setStarting(false), 700);
  };

  const endActive = async () => {
    if (!data?.active) return;
    const id = data.active.id;
    if ((await endWorkout(db, id, { confirm: true })) === 'finished') {
      router.push({ pathname: '/workout-summary', params: { id } });
    }
  };

  const pick = (dayId: number) => {
    haptics.selection();
    void setNextDay(db, dayId);
  };

  const confirmWorkout = () =>
    confirmDestructive({
      title: 'Eliminare l’allenamento?',
      message: 'Sparisce dallo storico e dai record.',
      action: 'Elimina allenamento',
    });

  const programs = data?.programs ?? [];
  const activeProgram = programs.find((p) => p.active);
  const thisWeek = (data?.history ?? []).filter((w) => w.date >= week[0]);
  const muscles = setsPerMuscle(data?.volume ?? []);
  const trained = MUSCLES.filter((m) => (muscles.get(m.key) ?? 0) > 0).sort(
    (a, b) => (muscles.get(b.key) ?? 0) - (muscles.get(a.key) ?? 0),
  );
  const next = data?.next ?? null;

  return (
    <ScreenScroll>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="plus" accessibilityLabel="Nuovo">
          <Stack.Toolbar.MenuAction icon="figure.strengthtraining.traditional" onPress={() => void start(null)}>
            Allenamento libero
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="list.bullet.rectangle" onPress={() => router.push('/training/new')}>
            Nuova scheda
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      {/* The one thing to do here comes first: the workout in progress, or the next one. */}
      {data?.active && !starting ? (
        // The workout keeps running: the whole card opens it, and it can be ended from here.
        <Animated.View key="active" entering={HERO_IN} exiting={HERO_OUT}>
        <PressableScale
          onPressIn={() => void prefetchLiveQuery(db, ACTIVE_WORKOUT_KEY, loadActiveWorkout, ACTIVE_WORKOUT_TOPICS)}
          onPress={() => router.push('/workout')}
          accessibilityRole="button"
          accessibilityHint="Apre l’allenamento">
            <Card style={styles.hero}>
              <Breathing breath={breath} />
              <View style={styles.heroTop}>
                <LiveDot breath={breath} />
                <AppText variant="footnote" weight="600" tone="accent" style={styles.flex}>
                  IN CORSO
                </AppText>
                <Icon name="chevron.right" size={14} tone="accent" weight="semibold" />
              </View>
              <View style={styles.heroName}>
                <DayBadge name={data.active?.name ?? ''} size={40} />
                <View style={styles.flex}>
                  <AppText variant="title" numberOfLines={1}>
                    {data.active?.name}
                  </AppText>
                  <AppText variant="subhead" tone="textSecondary" numeric>
                    {formatDuration((now - new Date(data.active?.startedAt ?? now).getTime()) / 1000)}
                  </AppText>
                </View>
                {/* Small and to the side: ending is a rare, deliberate act here. */}
                <Pressable
                  onPress={() => void endActive()}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Termina allenamento"
                  style={({ pressed }) => [styles.end, { backgroundColor: theme.fill }, pressed && styles.pressed]}>
                  <AppText variant="subhead" weight="600" tone="danger">
                    Termina
                  </AppText>
                </Pressable>
              </View>
            </Card>
        </PressableScale>
        </Animated.View>
      ) : next ? (
        <Animated.View key="next" entering={HERO_IN} exiting={HERO_OUT}>
        <Card style={styles.hero}>
          <View style={styles.heroTop}>
            <AppText variant="footnote" weight="600" tone="textSecondary" style={styles.flex} numberOfLines={1}>
              {`PROSSIMO · ${next.program.name.toUpperCase()}`}
            </AppText>
          </View>
          {/*
            The day reads as a value to pick (name and ⌃⌄), as pop-up buttons on iOS: it changes
            the day within this program; another program is one step further, in the same menu.
          */}
          <MenuButton
            icon="chevron.up.chevron.down"
            accessibilityLabel={`Prossimo giorno: ${next.day.name}. Scegli un altro giorno`}
            groups={[
              {
                title: `Giorni di ${next.program.name}`,
                actions: next.program.days.map((d) => ({
                  label: d.name,
                  icon: dayIcon(d.name),
                  checked: d.id === next.day.id,
                  onPress: () => pick(d.id),
                })),
              },
              {
                actions: [{ label: 'Cambia scheda', icon: 'list.bullet.rectangle', onPress: () => router.push('/training/programs') }],
              },
            ]}>
            <View style={styles.heroName}>
              <DayBadge name={next.day.name} size={40} />
              <AppText variant="title" numberOfLines={1} style={styles.shrink}>
                {next.day.name}
              </AppText>
              <Icon name="chevron.up.chevron.down" size={13} tone="textSecondary" weight="semibold" />
            </View>
          </MenuButton>
          <AppText variant="subhead" tone="textSecondary" numberOfLines={2}>
            {[countLabel(next.day.exerciseCount, 'esercizio', 'esercizi'), next.day.muscles.map(muscleLabel).join(', ')]
              .filter(Boolean)
              .join(' · ')}
          </AppText>
          <View style={styles.heroButton}>
            <Button title="Inizia" onPress={() => void start(next.day.id)} />
          </View>
        </Card>
        </Animated.View>
      ) : data ? (
        <Card style={styles.hero}>
          <Icon name="list.bullet.rectangle.portrait" size={28} tone="accent" />
          <AppText variant="title2">Crea una scheda</AppText>
          <AppText variant="subhead" tone="textSecondary">
            Da un modello, come Push Pull Legs, o da zero.
          </AppText>
          <View style={styles.heroButton}>
            <Button title="Nuova scheda" onPress={() => router.push('/training/new')} />
            <Button title="Allenamento libero" variant="plain" compact onPress={() => void start(null)} />
          </View>
        </Card>
      ) : null}

      {/*
        Each block below slides to its new place, and what comes and goes fades, so deleting
        workouts reshapes the page in one movement instead of a series of jumps.
      */}
      {(data?.history ?? []).length > 0 ? (
        <Animated.View key="recent" layout={HERO_LAYOUT} entering={SECTION_IN} exiting={SECTION_OUT}>
          <SectionTitle>Recenti</SectionTitle>
          <ListGroup>
            {(data?.history ?? []).slice(0, 3).map((w) => (
              <SwipeToDelete key={w.id} confirm={confirmWorkout} onDelete={() => void deleteWorkout(db, w.id)}>
                <Row
                  icon={<DayBadge name={w.name} />}
                  title={w.name}
                  subtitle={`${formatDayTitle(w.date, today)} · ${formatWorkoutLength(
                    (new Date(w.endedAt).getTime() - new Date(w.startedAt).getTime()) / 1000,
                  )} · ${countLabel(w.workSets, 'serie', 'serie')}`}
                  onPress={() => router.push({ pathname: '/training/session', params: { id: w.id } })}
                />
              </SwipeToDelete>
            ))}
            <Row title="Tutti gli allenamenti" onPress={() => router.push('/training/history')} />
          </ListGroup>
        </Animated.View>
      ) : null}

      <Animated.View layout={HERO_LAYOUT}>
      <SectionTitle>Questa settimana</SectionTitle>
      <Card style={styles.week} layout={HERO_LAYOUT}>
        <AppText variant="headline">
          {`${countLabel(thisWeek.length, 'allenamento', 'allenamenti')} · ${countLabel(
            thisWeek.reduce((sum, w) => sum + w.workSets, 0),
            'serie',
            'serie',
          )}`}
        </AppText>
        {trained.length > 0 ? (
          trained.map((m) => {
            const sets = muscles.get(m.key) ?? 0;
            return (
              <Animated.View key={m.key} layout={HERO_LAYOUT} entering={SECTION_IN} exiting={SECTION_OUT}>
              <Pressable
                onPress={() => router.push({ pathname: '/training/muscle', params: { muscle: m.key } })}
                accessibilityRole="button"
                accessibilityLabel={`${m.label}: ${formatNumber(sets, 1)} serie. Dettagli`}
                style={({ pressed }) => [styles.muscle, pressed && styles.pressed]}>
                <View style={styles.muscleTop}>
                  <AppText variant="subhead" style={styles.flex}>
                    {m.label}
                  </AppText>
                  <AppText variant="subhead" tone="textSecondary" numeric>
                    {`${formatNumber(sets, sets % 1 === 0 ? 0 : 1)} serie`}
                  </AppText>
                  <Icon name="chevron.right" size={12} tone="textTertiary" weight="semibold" />
                </View>
                <ProgressBar
                  value={sets}
                  target={VOLUME_HIGH}
                  color={sets >= VOLUME_LOW ? theme.accent : theme.warning}
                  height={5}
                />
              </Pressable>
              </Animated.View>
            );
          })
        ) : (
          <Animated.View entering={SECTION_IN}>
            <AppText variant="subhead" tone="textSecondary">
              Nessuna serie questa settimana.
            </AppText>
          </Animated.View>
        )}
      </Card>
      <SectionFooter>{`Serie allenanti per muscolo. Obiettivo: ${VOLUME_LOW}–${VOLUME_HIGH} a settimana.`}</SectionFooter>
      </Animated.View>

      <Animated.View layout={HERO_LAYOUT}>
      {/* Set up once, opened rarely: last. */}
      <SectionTitle>Libreria</SectionTitle>
      <ListGroup>
        <Row
          title="Schede"
          subtitle={activeProgram ? `In uso: ${activeProgram.name}` : countLabel(programs.length, 'scheda', 'schede')}
          icon={<Icon name="list.bullet.rectangle" size={18} tone="accent" />}
          onPress={() => router.push('/training/programs')}
        />
        <Row
          title="Esercizi"
          icon={<Icon name="books.vertical" size={18} tone="accent" />}
          onPress={() => router.push('/training/exercises')}
        />
      </ListGroup>
      </Animated.View>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { gap: Spacing.xs },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 32 },
  pressed: { opacity: 0.6 },
  heroName: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.xs },
  heroButton: { marginTop: Spacing.md, gap: Spacing.xs },
  shrink: { flexShrink: 1 },
  end: { paddingHorizontal: Spacing.md, height: 32, borderRadius: 16, justifyContent: 'center' },
  glow: { ...StyleSheet.absoluteFill, borderRadius: Radius.lg, borderCurve: 'continuous' },
  live: { width: 8, height: 8, alignItems: 'center', justifyContent: 'center' },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveRing: { position: 'absolute', width: 8, height: 8, borderRadius: 4 },
  week: { gap: Spacing.md },
  muscle: { gap: Spacing.xs },
  muscleTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
});

// The card of the next workout and the one of the workout in progress cross-fade into each
// other, and what is below slides to its new place instead of jumping.
const HERO_IN = FadeIn.duration(260);
const HERO_OUT = FadeOut.duration(160);
const HERO_LAYOUT = LinearTransition.duration(260);
const SECTION_IN = FadeIn.duration(200);
const SECTION_OUT = FadeOut.duration(140);

/** One beat shared by the card and its dot, so they breathe together: 0 → 1 → 0, about once a second each way. */
function useBreath(running: boolean): SharedValue<number> {
  const reduced = useReducedMotion();
  const breath = useSharedValue(0);
  useEffect(() => {
    if (reduced || !running) return;
    breath.set(withRepeat(withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.sin) }), -1, true));
    return () => breath.set(0);
  }, [breath, reduced, running]);
  return breath;
}

/** A soft green glow over the card of the workout in progress, as if it breathed. */
function Breathing({ breath }: { breath: SharedValue<number> }) {
  const theme = useTheme();
  const style = useAnimatedStyle(() => ({ opacity: breath.get() * 0.16 }));
  return <Animated.View pointerEvents="none" style={[styles.glow, { backgroundColor: theme.accent }, style]} />;
}

/** A small green dot with a halo that swells and fades in time with the card. */
function LiveDot({ breath }: { breath: SharedValue<number> }) {
  const theme = useTheme();
  const style = useAnimatedStyle(() => ({ opacity: 0.45 * breath.get(), transform: [{ scale: 1 + breath.get() * 1.3 }] }));
  return (
    <View style={styles.live}>
      <Animated.View style={[styles.liveRing, { backgroundColor: theme.accent }, style]} />
      <View style={[styles.liveDot, { backgroundColor: theme.accent }]} />
    </View>
  );
}
