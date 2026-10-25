import { Stack, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ActionRow, Card, ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { Icon } from '@/components/icon';
import { MenuButton } from '@/components/menu-button';
import { ProgressBar } from '@/components/progress';
import { ScreenScroll } from '@/components/screen';
import { Spacing } from '@/constants/theme';
import { useLiveQuery } from '@/db/live';
import { getNextDay, getPrograms } from '@/db/programs';
import { getActiveWorkout, getWorkoutHistory, getWorkSetsBetween, startWorkout } from '@/db/workouts';
import { useClock } from '@/hooks/use-clock';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { formatDayTitle, weekOf } from '@/lib/dates';
import { MUSCLES, muscleLabel } from '@/lib/exercises';
import { countLabel, formatNumber } from '@/lib/format';
import { formatDuration, formatWorkoutLength, setsPerMuscle } from '@/lib/training';
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
  });
  const now = useClock(1000, Boolean(data?.active));

  const start = async (dayId: number | null) => {
    await startWorkout(db, { dayId });
    haptics.success();
    router.push('/workout');
  };

  const thisWeek = (data?.history ?? []).filter((w) => w.date >= week[0]);
  const muscles = setsPerMuscle(data?.volume ?? []);
  const trained = MUSCLES.filter((m) => (muscles.get(m.key) ?? 0) > 0).sort(
    (a, b) => (muscles.get(b.key) ?? 0) - (muscles.get(a.key) ?? 0),
  );

  return (
    <ScreenScroll>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="plus" accessibilityLabel="Nuovo">
          <Stack.Toolbar.MenuAction icon="list.bullet.rectangle" onPress={() => router.push('/training/new')}>
            Nuova scheda
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="figure.strengthtraining.traditional" onPress={() => void start(null)}>
            Allenamento libero
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      {data?.active ? (
        <Card style={[styles.hero, { backgroundColor: theme.accentSoft }]}>
          <AppText variant="footnote" weight="600" tone="accent">
            IN CORSO
          </AppText>
          <AppText variant="title">{data.active.name}</AppText>
          <AppText variant="subhead" tone="textSecondary" numeric>
            {`Iniziato da ${formatDuration((now - new Date(data.active.startedAt).getTime()) / 1000)}`}
          </AppText>
          <Button title="Riprendi" onPress={() => router.push('/workout')} />
        </Card>
      ) : data?.next ? (
        <Card style={styles.hero}>
          <AppText variant="footnote" weight="600" tone="textSecondary">
            {`PROSSIMO · ${data.next.program.name.toUpperCase()}`}
          </AppText>
          <View style={styles.heroTitle}>
            <AppText variant="title" style={styles.flex}>
              {data.next.day.name}
            </AppText>
            <MenuButton
              icon="arrow.left.arrow.right"
              title="Altro giorno"
              accessibilityLabel="Scegli un altro giorno della scheda"
              groups={[
                {
                  title: 'Inizia un altro giorno',
                  actions: data.next.program.days.map((d) => ({
                    label: d.name,
                    icon: 'figure.strengthtraining.traditional' as const,
                    checked: d.id === data.next?.day.id,
                    onPress: () => void start(d.id),
                  })),
                },
              ]}
            />
          </View>
          <AppText variant="subhead" tone="textSecondary">
            {[countLabel(data.next.day.exerciseCount, 'esercizio', 'esercizi'), data.next.day.muscles.map(muscleLabel).join(', ')]
              .filter(Boolean)
              .join(' · ')}
          </AppText>
          <Button title={`Inizia ${data.next.day.name}`} onPress={() => void start(data.next?.day.id ?? null)} />
          <Button title="Allenamento libero" variant="plain" compact onPress={() => void start(null)} />
        </Card>
      ) : data ? (
        <Card style={styles.hero}>
          <Icon name="list.bullet.rectangle.portrait" size={28} tone="accent" />
          <AppText variant="title2">Crea la tua scheda</AppText>
          <AppText variant="subhead" tone="textSecondary">
            Parti da un modello collaudato, come Push Pull Legs, o scrivi la tua. Poi qui troverai ogni volta il prossimo
            allenamento, con i carichi dell’ultima volta.
          </AppText>
          <Button title="Nuova scheda" onPress={() => router.push('/training/new')} />
          <Button title="Allenamento libero" variant="plain" compact onPress={() => void start(null)} />
        </Card>
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
            Qui vedrai le serie allenanti di ogni muscolo nella settimana.
          </AppText>
        )}
      </Card>
      <SectionFooter>
        {`Serie allenanti, esclusi i riscaldamenti: una serie conta intera per il muscolo principale e mezza per quelli secondari. Per crescere ne servono indicativamente ${VOLUME_LOW}–${VOLUME_HIGH} a settimana per muscolo: in arancione quelli sotto ${VOLUME_LOW}.`}
      </SectionFooter>

      <SectionTitle>Schede</SectionTitle>
      <ListGroup>
        {(data?.programs ?? []).map((p) => (
          <Row
            key={p.id}
            title={p.name}
            subtitle={`${countLabel(p.days.length, 'giorno', 'giorni')}${p.active ? ' · in uso' : ''}`}
            icon={<Icon name={p.active ? 'checkmark.circle.fill' : 'list.bullet.rectangle'} size={20} tone={p.active ? 'accent' : 'textSecondary'} />}
            onPress={() => router.push({ pathname: '/training/program', params: { id: p.id } })}
          />
        ))}
        <ActionRow label="Nuova scheda" onPress={() => router.push('/training/new')} />
      </ListGroup>

      <SectionTitle>Recenti</SectionTitle>
      <ListGroup>
        {(data?.history ?? []).slice(0, 3).map((w) => (
          <Row
            key={w.id}
            title={w.name}
            subtitle={`${formatDayTitle(w.date, today)} · ${formatWorkoutLength(
              (new Date(w.endedAt).getTime() - new Date(w.startedAt).getTime()) / 1000,
            )} · ${countLabel(w.workSets, 'serie', 'serie')}`}
            onPress={() => router.push({ pathname: '/training/session', params: { id: w.id } })}
          />
        ))}
        <Row
          title="Tutto lo storico"
          icon={<Icon name="calendar" size={18} tone="accent" />}
          onPress={() => router.push('/training/history')}
        />
        <Row
          title="Libreria esercizi"
          icon={<Icon name="books.vertical" size={18} tone="accent" />}
          onPress={() => router.push('/training/exercises')}
        />
      </ListGroup>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { gap: Spacing.sm },
  heroTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  week: { gap: Spacing.md },
  muscle: { gap: Spacing.xs },
  muscleTop: { flexDirection: 'row', alignItems: 'center' },
});
