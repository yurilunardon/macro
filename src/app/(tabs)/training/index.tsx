import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card, ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { DayBadge } from '@/components/day-badge';
import { Icon } from '@/components/icon';
import { MenuButton } from '@/components/menu-button';
import { confirmDestructive } from '@/components/prompt';
import { ProgressBar } from '@/components/progress';
import { ScreenScroll } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Spacing } from '@/constants/theme';
import { useLiveQuery } from '@/db/live';
import { getNextDay, getPrograms, setNextDay } from '@/db/programs';
import { deleteWorkout, getActiveWorkout, getWorkoutHistory, getWorkSetsBetween, startWorkout } from '@/db/workouts';
import { useClock } from '@/hooks/use-clock';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { formatDayTitle, weekOf } from '@/lib/dates';
import { MUSCLES, muscleLabel } from '@/lib/exercises';
import { countLabel, formatNumber } from '@/lib/format';
import { dayIcon, formatDuration, formatWorkoutLength, setsPerMuscle } from '@/lib/training';
import { endWorkout } from '@/services/end-workout';
import { haptics } from '@/services/haptics';

/** Weekly hard sets per muscle that research links with growth, roughly. */
const VOLUME_LOW = 10;
const VOLUME_HIGH = 20;

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

  const start = async (dayId: number | null) => {
    await startWorkout(db, { dayId });
    haptics.success();
    router.push('/workout');
  };

  const endActive = async () => {
    if (!data?.active) return;
    const id = data.active.id;
    if ((await endWorkout(db, id, { confirm: true })) === 'finished') {
      router.push({ pathname: '/training/session', params: { id, done: '1' } });
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
      {data?.active ? (
        // The workout keeps running: the whole card opens it, and it can be ended from here.
        <Pressable onPress={() => router.push('/workout')} accessibilityRole="button" accessibilityHint="Apre l’allenamento">
          {({ pressed }) => (
            <Card style={[styles.hero, pressed && styles.pressed]}>
              <View style={styles.heroTop}>
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
              </View>
              <View style={styles.heroButton}>
                <Button
                  title="Termina allenamento"
                  variant="stop"
                  icon={<Icon name="flag.checkered" size={16} tone="danger" weight="semibold" />}
                  onPress={() => void endActive()}
                />
              </View>
            </Card>
          )}
        </Pressable>
      ) : next ? (
        <Card style={styles.hero}>
          <View style={styles.heroTop}>
            <AppText variant="footnote" weight="600" tone="textSecondary" style={styles.flex} numberOfLines={1}>
              {`PROSSIMO · ${next.program.name.toUpperCase()}`}
            </AppText>
            {next.program.days.length > 1 ? (
              <MenuButton
                icon="arrow.left.arrow.right"
                title="Cambia"
                accessibilityLabel="Scegli il prossimo giorno"
                groups={[
                  {
                    title: 'Prossimo allenamento',
                    actions: next.program.days.map((d) => ({
                      label: d.name,
                      icon: dayIcon(d.name),
                      checked: d.id === next.day.id,
                      onPress: () => pick(d.id),
                    })),
                  },
                ]}
              />
            ) : null}
          </View>
          <View style={styles.heroName}>
            <DayBadge name={next.day.name} size={40} />
            <AppText variant="title" style={styles.flex} numberOfLines={1}>
              {next.day.name}
            </AppText>
          </View>
          <AppText variant="subhead" tone="textSecondary" numberOfLines={2}>
            {[countLabel(next.day.exerciseCount, 'esercizio', 'esercizi'), next.day.muscles.map(muscleLabel).join(', ')]
              .filter(Boolean)
              .join(' · ')}
          </AppText>
          <View style={styles.heroButton}>
            <Button title="Inizia" onPress={() => void start(next.day.id)} />
          </View>
        </Card>
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

      {(data?.history ?? []).length > 0 ? (
        <>
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
        </>
      ) : null}

      <SectionTitle>Questa settimana</SectionTitle>
      <Card style={styles.week}>
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
              <View key={m.key} style={styles.muscle}>
                <View style={styles.muscleTop}>
                  <AppText variant="subhead" style={styles.flex}>
                    {m.label}
                  </AppText>
                  <AppText variant="subhead" tone="textSecondary" numeric>
                    {`${formatNumber(sets, sets % 1 === 0 ? 0 : 1)} serie`}
                  </AppText>
                </View>
                <ProgressBar
                  value={sets}
                  target={VOLUME_HIGH}
                  color={sets >= VOLUME_LOW ? theme.accent : theme.warning}
                  height={5}
                />
              </View>
            );
          })
        ) : (
          <AppText variant="subhead" tone="textSecondary">
            Nessuna serie questa settimana.
          </AppText>
        )}
      </Card>
      <SectionFooter>{`Serie allenanti per muscolo. Obiettivo: ${VOLUME_LOW}–${VOLUME_HIGH} a settimana.`}</SectionFooter>

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
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { gap: Spacing.xs },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 32 },
  pressed: { opacity: 0.7 },
  heroName: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.xs },
  heroButton: { marginTop: Spacing.md, gap: Spacing.xs },
  week: { gap: Spacing.md },
  muscle: { gap: Spacing.xs },
  muscleTop: { flexDirection: 'row', alignItems: 'center' },
});
