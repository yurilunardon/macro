import { Link, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ActionRow, Card, ListGroup, SectionFooter, SectionTitle } from '@/components/card';
import { Icon } from '@/components/icon';
import { confirmDestructive } from '@/components/prompt';
import { ScreenScroll } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Spacing } from '@/constants/theme';
import { useLiveQuery } from '@/db/live';
import {
  addDay,
  deleteDay,
  deleteProgram,
  getProgram,
  moveDay,
  renameDay,
  renameProgram,
  setActiveProgram,
  type DaySummary,
} from '@/db/programs';
import { useTheme } from '@/hooks/use-theme';
import { muscleLabel } from '@/lib/exercises';
import { countLabel } from '@/lib/format';
import { haptics } from '@/services/haptics';

/** A program: its days in the order they rotate, and whether it is the one in use. */
export default function ProgramScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Number(params.id);
  const { data: program } = useLiveQuery(`program:${id}`, (database) => getProgram(database, id));

  if (program === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  if (program === null) {
    return (
      <View style={styles.center}>
        <AppText tone="textSecondary">Scheda eliminata.</AppText>
      </View>
    );
  }

  const prompt = (title: string, message: string, initial: string, onSave: (name: string) => void) =>
    Alert.prompt(
      title,
      message,
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Salva',
          onPress: (text?: string) => {
            const name = (text ?? '').trim();
            if (name !== '') onSave(name);
          },
        },
      ],
      'plain-text',
      initial,
    );

  const newDay = () =>
    prompt('Nuovo giorno', 'Es. Push, Upper A, Gambe.', '', async (name) => {
      const dayId = await addDay(db, program.id, name);
      haptics.success();
      router.push({ pathname: '/training/day', params: { id: dayId } });
    });

  const remove = async () => {
    const ok = await confirmDestructive({
      title: `Eliminare «${program.name}»?`,
      message: 'Gli allenamenti già fatti restano nello storico.',
      action: 'Elimina',
    });
    if (!ok) return;
    await deleteProgram(db, program.id);
    router.back();
  };

  const confirmDay = (day: DaySummary) => () =>
    confirmDestructive({ title: `Eliminare «${day.name}»?`, message: 'Gli allenamenti già fatti restano nello storico.', action: 'Elimina' });

  return (
    <ScreenScroll>
      <Stack.Screen options={{ title: program.name }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis.circle" accessibilityLabel="Azioni sulla scheda">
          <Stack.Toolbar.MenuAction
            icon="pencil"
            onPress={() => prompt('Rinomina la scheda', '', program.name, (name) => void renameProgram(db, program.id, name))}>
            Rinomina
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="trash" destructive onPress={() => void remove()}>
            Elimina scheda
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      {program.active ? (
        <Card style={[styles.status, { backgroundColor: theme.accentSoft }]}>
          <Icon name="checkmark.circle.fill" size={20} tone="accent" />
          <AppText variant="subhead" style={styles.flex}>
            È la scheda in uso: il prossimo allenamento parte da qui.
          </AppText>
        </Card>
      ) : (
        <Button
          title="Usa questa scheda"
          variant="tinted"
          onPress={() => {
            haptics.success();
            void setActiveProgram(db, program.id);
          }}
        />
      )}

      <SectionTitle>Giorni</SectionTitle>
      <ListGroup>
        {program.days.map((day, index) => (
          <SwipeToDelete key={day.id} confirm={confirmDay(day)} onDelete={() => void deleteDay(db, day.id)}>
            <Link href={{ pathname: '/training/day', params: { id: day.id } }} asChild>
              <Link.Trigger>
                <Pressable accessibilityRole="button" accessibilityHint="Tieni premuto per spostarlo o rinominarlo">
                  {({ pressed }) => (
                    <View style={[styles.day, pressed && { backgroundColor: theme.cardPressed }]}>
                      <View style={[styles.number, { backgroundColor: theme.track }]}>
                        <AppText variant="subhead" weight="700" numeric>
                          {String(index + 1)}
                        </AppText>
                      </View>
                      <View style={styles.flex}>
                        <AppText>{day.name}</AppText>
                        <AppText variant="footnote" tone="textSecondary" numberOfLines={1}>
                          {[countLabel(day.exerciseCount, 'esercizio', 'esercizi'), day.muscles.map(muscleLabel).join(', ')]
                            .filter(Boolean)
                            .join(' · ')}
                        </AppText>
                      </View>
                      <Icon name="chevron.right" size={13} tone="textTertiary" weight="semibold" />
                    </View>
                  )}
                </Pressable>
              </Link.Trigger>
              <Link.Menu>
                <Link.MenuAction
                  icon="pencil"
                  onPress={() => prompt('Rinomina il giorno', '', day.name, (name) => void renameDay(db, day.id, name))}>
                  Rinomina
                </Link.MenuAction>
                {index > 0 ? (
                  <Link.MenuAction icon="arrow.up" onPress={() => void moveDay(db, day.id, -1)}>
                    Sposta prima
                  </Link.MenuAction>
                ) : null}
                {index < program.days.length - 1 ? (
                  <Link.MenuAction icon="arrow.down" onPress={() => void moveDay(db, day.id, 1)}>
                    Sposta dopo
                  </Link.MenuAction>
                ) : null}
                <Link.MenuAction
                  icon="trash"
                  destructive
                  onPress={async () => {
                    if (await confirmDay(day)()) void deleteDay(db, day.id);
                  }}>
                  Elimina
                </Link.MenuAction>
              </Link.Menu>
            </Link>
          </SwipeToDelete>
        ))}
        <ActionRow label="Aggiungi giorno" onPress={newDay} />
      </ListGroup>
      <SectionFooter>
        I giorni si alternano in quest’ordine: dopo l’ultimo si riparte dal primo, comunque tu distribuisca gli
        allenamenti nella settimana.
      </SectionFooter>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  status: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  day: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    minHeight: 56,
  },
  number: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
});
