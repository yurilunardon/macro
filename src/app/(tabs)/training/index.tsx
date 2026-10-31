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
import { DayDeck } from '@/components/day-deck';
import { Icon } from '@/components/icon';
import { confirmDestructive } from '@/components/prompt';
import { PressableScale } from '@/components/pressable-scale';
import { ProgressBar } from '@/components/progress';
import { ScreenScroll } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Radius, Spacing } from '@/constants/theme';
import { ACTIVE_WORKOUT_KEY, ACTIVE_WORKOUT_TOPICS, loadActiveWorkout } from '@/db/active-workout';
import { setOccurrenceDay } from '@/db/calendar';
import { prefetchLiveQuery, useLiveQuery } from '@/db/live';
import { getNextDay, getPrograms, setNextDay } from '@/db/programs';
import { deleteWorkout, getActiveWorkout, getWorkoutHistory, getWorkSetsBetween, startWorkout } from '@/db/workouts';
import { useAgenda } from '@/hooks/use-agenda';
import { useClock } from '@/hooks/use-clock';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { addDays, daysFrom, formatDayTitle, formatSoon, weekOf } from '@/lib/dates';
import { MUSCLES } from '@/lib/exercises';
import { countLabel, formatNumber } from '@/lib/format';
import { formatDuration, formatWorkoutLength, setsPerMuscle, WEEKLY_SETS } from '@/lib/training';
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
  // The next gym day in the calendar, so this page says the same: "Oggi" and the same day of the program.
  const soon = useAgenda(today, addDays(today, 13), today);
  const gymTypeId = soon.data?.gymTypeId ?? null;
  const nextGym =
    daysFrom(today, addDays(today, 13))
      .flatMap((date) => soon.agenda.get(date) ?? [])
      .find((i) => i.kind === 'activity' && i.status === 'planned' && i.occurrence.typeId === gymTypeId) ?? null;
  const gymPlanned = nextGym?.kind === 'activity' ? nextGym : null;
  const hasGymDays = (soon.data?.plans ?? []).some((p) => p.typeId === gymTypeId);
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
  // A day of the program fixed by hand in the calendar wins over the rotation.
  const plannedDay = gymPlanned?.dayId ?? null;
  const deckDay = next && plannedDay !== null && next.program.days.some((d) => d.id === plannedDay) ? plannedDay : (next?.day.id ?? null);
  const pickDay = (dayId: number) => {
    if (gymPlanned && gymPlanned.occurrence.dayId !== null) void setOccurrenceDay(db, gymPlanned.occurrence, dayId);
    else void setNextDay(db, dayId);
  };

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
                <DayBadge icon={data.active.icon} size={40} />
                <View style={styles.flex}>
                  <AppText variant="title" numberOfLines={1}>
                    {data.active?.name}
                  </AppText>
                  <Elapsed since={data.active.startedAt} />
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
          {/* The next day on a pile of the program's days; ⌃⌄ picks another. */}
          <DayDeck
            program={next.program}
            dayId={deckDay ?? next.day.id}
            when={gymPlanned ? formatSoon(gymPlanned.occurrence.date, today) : null}
            onPick={pickDay}
            onStart={(dayId) => void start(dayId)}
            onChangeProgram={() => router.push('/training/programs')}
          />
          {/* Without gym days in the calendar there is no "today": one tap sets them up. */}
          {soon.data && gymTypeId !== null && !hasGymDays ? (
            <ListGroup style={styles.setup}>
              <Row
                icon={<Icon name="calendar.badge.plus" size={20} tone="accent" />}
                title="Scegli i giorni di palestra"
                subtitle="Il calendario ti dirà cosa fare ogni giorno"
                onPress={() => router.push({ pathname: '/activity', params: { type: gymTypeId, repeat: '1' } })}
              />
            </ListGroup>
          ) : null}
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
                  icon={<DayBadge icon={w.icon} />}
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
  end: { paddingHorizontal: Spacing.md, height: 32, borderRadius: 16, justifyContent: 'center' },
  glow: { ...StyleSheet.absoluteFill, borderRadius: Radius.lg, borderCurve: 'continuous' },
  live: { width: 8, height: 8, alignItems: 'center', justifyContent: 'center' },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveRing: { position: 'absolute', width: 8, height: 8, borderRadius: 4 },
  week: { gap: Spacing.md },
  setup: { marginTop: Spacing.md },
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

/**
 * The time since the workout started. It ticks on its own: the clock in the screen redrew the
 * whole page every second while a workout ran.
 */
function Elapsed({ since }: { since: string }) {
  const now = useClock(1000);
  return (
    <AppText variant="subhead" tone="textSecondary" numeric>
      {formatDuration((now - new Date(since).getTime()) / 1000)}
    </AppText>
  );
}

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
