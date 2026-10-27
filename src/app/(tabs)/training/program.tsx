import { Link, Stack, useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ActionRow, ListGroup, SectionFooter, SectionTitle } from '@/components/card';
import { DayBadge } from '@/components/day-badge';
import { EditButton } from '@/components/edit-button';
import { EditableTitle } from '@/components/editable-title';
import { Icon } from '@/components/icon';
import { choose, confirmDestructive } from '@/components/prompt';
import { ScreenScroll } from '@/components/screen';
import { SortableList } from '@/components/sortable-list';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { toast } from '@/components/toast';
import { Spacing } from '@/constants/theme';
import { useLiveQuery } from '@/db/live';
import {
  addDay,
  addDraft,
  deleteDay,
  deleteProgram,
  discardDraft,
  getProgram,
  programSnapshot,
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
  // "Modifica", as in the workout and in Clock: rows get a red ⊖ and a ≡ handle to drag.
  const [editing, setEditing] = useState(false);

  // A template opened from "Nuova scheda" is only being looked at: going back leaves nothing
  // behind, unless it was changed, and then it asks whether to keep it.
  const draft = program?.draft === true;
  const original = useRef<string | null>(null);
  useEffect(() => {
    if (draft && original.current === null) void programSnapshot(db, id).then((snapshot) => (original.current = snapshot));
  }, [db, id, draft]);
  // Leaving is let through once decided; the effect runs after the prevention is lifted.
  const [leave, setLeave] = useState<(() => void) | null>(null);
  usePreventRemove(draft && leave === null, ({ repeat }) => {
    void (async () => {
      const changed = original.current !== null && (await programSnapshot(db, id)) !== original.current;
      let keep = false;
      if (changed) {
        const choice = await choose({
          title: 'Aggiungere la scheda alle tue?',
          message: 'L’hai modificata.',
          actions: [{ label: 'Aggiungi alle mie schede' }, { label: 'Elimina modifiche', destructive: true }],
        });
        if (choice === null) return;
        keep = choice === 0;
      }
      if (keep) {
        await addDraft(db, id);
        toast.show('Aggiunta alle tue schede', 'checkmark.circle.fill');
      }
      setLeave(() => () => {
        repeat();
        // Dropped once the screen is gone, so it does not empty while sliding away.
        if (!keep) setTimeout(() => void discardDraft(db, id), 800);
      });
    })();
  });
  useEffect(() => {
    leave?.();
  }, [leave]);

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
        <EditButton editing={editing} disabled={days.length === 0} onChange={setEditing} />
        <Stack.Toolbar.Menu separateBackground icon="ellipsis" accessibilityLabel="Azioni sulla scheda" hidden={program.draft}>
          <Stack.Toolbar.MenuAction icon="trash" destructive onPress={() => void remove()}>
            Elimina scheda
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      <EditableTitle value={program.name} accessibilityLabel="Nome della scheda" onChange={(name) => void renameProgram(db, program.id, name)} />

      {program.draft ? (
        <>
          <Button
            title="Aggiungi alle mie schede"
            icon={<Icon name="plus" size={16} tone="onAccent" weight="semibold" />}
            onPress={() => {
              haptics.success();
              void addDraft(db, program.id);
              toast.show('Aggiunta alle tue schede', 'checkmark.circle.fill');
            }}
          />
          <AppText variant="footnote" tone="textSecondary" style={styles.draftNote}>
            Anteprima: se torni indietro non viene salvata.
          </AppText>
        </>
      ) : program.active ? (
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
      {editing ? (
        <SortableList
          items={days}
          keyOf={(day) => String(day.id)}
          rowHeight={ROW_HEIGHT}
          onReorder={(keys) => void reorderDays(db, keys.map(Number))}
          onRemove={removeDay}
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
        {editing
          ? 'Trascina ≡ per cambiare l’ordine.'
          : 'I giorni si alternano in quest’ordine, poi si riparte dal primo.'}
      </SectionFooter>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  draftNote: { paddingHorizontal: Spacing.xs },
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
