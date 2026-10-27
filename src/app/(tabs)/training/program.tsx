import { Link, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ActionRow, ListGroup, SectionFooter, SectionTitle } from '@/components/card';
import { DayBadge } from '@/components/day-badge';
import { EditableTitle } from '@/components/editable-title';
import { Icon } from '@/components/icon';
import { confirmDestructive } from '@/components/prompt';
import { ScreenScroll } from '@/components/screen';
import { SortableList } from '@/components/sortable-list';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Spacing } from '@/constants/theme';
import { useLiveQuery } from '@/db/live';
import {
  addDay,
  deleteDay,
  deleteProgram,
  getProgram,
  renameDay,
  renameProgram,
  reorderDays,
  setActiveProgram,
  type DaySummary,
} from '@/db/programs';
import { useTheme } from '@/hooks/use-theme';
import { muscleLabel } from '@/lib/exercises';
import { countLabel } from '@/lib/format';
import { haptics } from '@/services/haptics';
import { deleteWithUndo, usePendingDeletes } from '@/services/undo';

const ROW_HEIGHT = 60;

function daySummary(day: DaySummary): string {
  return [countLabel(day.exerciseCount, 'esercizio', 'esercizi'), day.muscles.map(muscleLabel).join(', ')].filter(Boolean).join(' · ');
}

/** A program: its days in the order they rotate, and whether it is the one in use. */
export default function ProgramScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Number(params.id);
  const { data: program } = useLiveQuery(`program:${id}`, (database) => getProgram(database, id), ['training']);
  const hidden = usePendingDeletes();
  const [reordering, setReordering] = useState(false);

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
        <AppText tone="textSecondary">Scheda eliminata</AppText>
      </View>
    );
  }

  const days = program.days.filter((d) => !hidden.has(`day:${d.id}`));

  const prompt = (title: string, initial: string, onSave: (name: string) => void) =>
    Alert.prompt(
      title,
      undefined,
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
    prompt('Nuovo giorno', '', async (name) => {
      const dayId = await addDay(db, program.id, name);
      haptics.success();
      router.push({ pathname: '/training/day', params: { id: dayId } });
    });

  const remove = async () => {
    const ok = await confirmDestructive({
      title: `Eliminare ${program.name}?`,
      message: 'Gli allenamenti fatti restano nello storico.',
      action: 'Elimina scheda',
    });
    if (!ok) return;
    await deleteProgram(db, program.id);
    router.back();
  };

  const removeDay = (day: DaySummary) =>
    deleteWithUndo({ key: `day:${day.id}`, title: `${day.name} eliminato`, run: () => deleteDay(db, day.id) });

  return (
    <ScreenScroll>
      <Stack.Screen options={{ title: '' }} />
      <Stack.Toolbar placement="right">
        {reordering ? (
          <Stack.Toolbar.Button variant="done" onPress={() => setReordering(false)}>
            Fine
          </Stack.Toolbar.Button>
        ) : (
          <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Azioni sulla scheda">
            <Stack.Toolbar.MenuAction icon="arrow.up.arrow.down" disabled={days.length < 2} onPress={() => setReordering(true)}>
              Riordina i giorni
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction icon="trash" destructive onPress={() => void remove()}>
              Elimina scheda
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
        )}
      </Stack.Toolbar>

      <EditableTitle value={program.name} accessibilityLabel="Nome della scheda" onChange={(name) => void renameProgram(db, program.id, name)} />

      {program.active ? (
        <View style={styles.status}>
          <Icon name="checkmark.circle.fill" size={17} tone="accent" />
          <AppText variant="subhead" weight="600" tone="accent">
            Scheda in uso
          </AppText>
        </View>
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
      {reordering ? (
        <SortableList
          items={days}
          keyOf={(day) => String(day.id)}
          rowHeight={ROW_HEIGHT}
          onReorder={(keys) => void reorderDays(db, keys.map(Number))}
          renderRow={(day) => (
            <View>
              <AppText numberOfLines={1}>{day.name}</AppText>
              <AppText variant="footnote" tone="textSecondary" numberOfLines={1}>
                {daySummary(day)}
              </AppText>
            </View>
          )}
        />
      ) : (
        <ListGroup>
          {days.map((day) => (
            <SwipeToDelete key={day.id} onDelete={() => removeDay(day)}>
              <Link href={{ pathname: '/training/day', params: { id: day.id } }} asChild>
                <Link.Trigger>
                  <Pressable accessibilityRole="button">
                    {({ pressed }) => (
                      <View style={[styles.day, pressed && { backgroundColor: theme.cardPressed }]}>
                        <DayBadge name={day.name} />
                        <View style={styles.flex}>
                          <AppText numberOfLines={1}>{day.name}</AppText>
                          <AppText variant="footnote" tone="textSecondary" numberOfLines={1}>
                            {daySummary(day)}
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
                    onPress={() => prompt('Rinomina giorno', day.name, (name) => void renameDay(db, day.id, name))}>
                    Rinomina
                  </Link.MenuAction>
                  <Link.MenuAction icon="arrow.up.arrow.down" onPress={() => setReordering(true)}>
                    Riordina
                  </Link.MenuAction>
                  <Link.MenuAction icon="trash" destructive onPress={() => removeDay(day)}>
                    Elimina
                  </Link.MenuAction>
                </Link.Menu>
              </Link>
            </SwipeToDelete>
          ))}
          <ActionRow label="Aggiungi giorno" onPress={newDay} />
        </ListGroup>
      )}
      <SectionFooter>
        {reordering
          ? 'Tieni premuto un giorno e trascinalo.'
          : 'I giorni si alternano in quest’ordine, poi si riparte dal primo.'}
      </SectionFooter>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  status: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs + 2, paddingHorizontal: Spacing.xs },
  day: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    minHeight: ROW_HEIGHT,
  },
});
