import { Link, Stack, useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, Keyframe, LayoutAnimationConfig, LinearTransition } from 'react-native-reanimated';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ActionRow, ListGroup, SectionFooter, SectionTitle } from '@/components/card';
import { DayBadge } from '@/components/day-badge';
import { editButton } from '@/components/edit-button';
import { EditableTitle } from '@/components/editable-title';
import { Icon } from '@/components/icon';
import { choose, confirmDestructive } from '@/components/prompt';
import { ProgramValidity } from '@/components/program-validity';
import { ScreenScroll } from '@/components/screen';
import { Segmented } from '@/components/segmented';
import { SORTABLE_ENTER_MS, SORTABLE_SHIFT, SORTABLE_TEXT_SLACK, SortableList } from '@/components/sortable-list';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { toast } from '@/components/toast';
import { Radius, Spacing } from '@/constants/theme';
import { prefetch, useLiveQuery } from '@/db/live';
import {
  addDay,
  addDraft,
  deleteDay,
  deleteProgram,
  discardDraft,
  programSnapshot,
  renameDay,
  renameProgram,
  reorderDays,
  setDayIcon,
  setActiveProgram,
  type DaySummary,
} from '@/db/programs';
import { dayScreen, programScreen } from '@/db/screens';
import { useScrollTop } from '@/hooks/use-scroll-top';
import { useTheme } from '@/hooks/use-theme';
import { muscleLabel } from '@/lib/exercises';
import { DAY_ICON_CHOICES } from '@/lib/training';
import { countLabel } from '@/lib/format';
import { haptics } from '@/services/haptics';
import { deleteWithUndo, usePendingDeletes } from '@/services/undo';

const ROW_HEIGHT = 60;

type ProgramTab = 'days' | 'check';
const TABS: readonly { key: ProgramTab; label: string }[] = [
  { key: 'days', label: 'Giorni' },
  { key: 'check', label: 'Validità' },
];
/** The tab each program was left on, while the app stays open. */
const lastTab = new Map<number, ProgramTab>();
const ROW_IN = FadeIn.duration(220);
const ROW_OUT = FadeOut.duration(180);
const ROW_LAYOUT = LinearTransition.duration(240).easing(Easing.out(Easing.cubic));
// Into edit mode and out of it the rows are drawn by another list: what they hold starts where the
// other left it and slides to its place, as in a day.
const TO_EDIT = new Keyframe({
  0: { transform: [{ translateX: -SORTABLE_SHIFT }] },
  100: { transform: [{ translateX: 0 }] },
}).duration(SORTABLE_ENTER_MS);
const FROM_EDIT = new Keyframe({
  0: { transform: [{ translateX: SORTABLE_SHIFT }] },
  100: { transform: [{ translateX: 0 }] },
}).duration(SORTABLE_ENTER_MS);

function daySummary(day: DaySummary): string {
  return [countLabel(day.exerciseCount, 'esercizio', 'esercizi'), day.muscles.map(muscleLabel).join(', ')].filter(Boolean).join(' · ');
}

/** A day's name and what it holds, as wide in edit mode as out of it. */
function DayText({ day }: { day: DaySummary }) {
  return (
    <View style={styles.flex}>
      <AppText numberOfLines={1}>{day.name}</AppText>
      <AppText variant="footnote" tone="textSecondary" numberOfLines={1}>
        {daySummary(day)}
      </AppText>
    </View>
  );
}

/** A program: its days in the order they rotate, and whether it is the one in use. */
export default function ProgramScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Number(params.id);
  const screen = programScreen(id);
  const { data: program } = useLiveQuery(screen.key, screen.query, screen.topics);
  const hidden = usePendingDeletes();
  // "Modifica", as in the workout and in Clock: rows get a red ⊖ and a ≡ handle to drag.
  const [editing, setEditing] = useState(false);
  // Giorni or Muscoli, as it was left for this program.
  const [tab, setTab] = useState<ProgramTab>(() => lastTab.get(id) ?? 'days');
  const scroll = useScrollTop();

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
          title: 'Salvare la scheda tra le tue?',
          message: 'L’hai modificata.',
          actions: [{ label: 'Salva tra le mie schede' }, { label: 'Elimina modifiche', destructive: true }],
        });
        if (choice === null) return;
        keep = choice === 0;
      }
      if (keep) {
        await addDraft(db, id);
        toast.show('Salvata tra le tue schede', 'checkmark.circle.fill');
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
      // The day's page slides in with its name already in it.
      await prefetch(db, dayScreen(dayId));
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

  // Under the days, and still there while editing, dimmed, as in a day: nothing disappears.
  const addDayRow = (
    <View style={editing && styles.dimmed} pointerEvents={editing ? 'none' : 'auto'}>
      <ActionRow label="Aggiungi giorno" onPress={newDay} />
    </View>
  );

  const switchTab = (next: ProgramTab) => {
    setEditing(false);
    lastTab.set(program.id, next);
    setTab(next);
  };

  return (
    <ScreenScroll scroll={scroll}>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button {...editButton({ editing, disabled: days.length === 0 || tab !== 'days', onChange: setEditing })} />
        {/* The only action besides editing: no menu to hold it. */}
        {program.draft ? null : (
          <Stack.Toolbar.Button separateBackground icon="trash" accessibilityLabel="Elimina scheda" onPress={() => void remove()} />
        )}
      </Stack.Toolbar>

      {/* Over the name, as on the training tab: a label of the program, apart from what follows. */}
      {program.active && !program.draft ? (
        <View style={styles.status}>
          <Icon name="checkmark.circle.fill" size={13} tone="accent" />
          <AppText variant="footnote" weight="600" tone="accent">
            SCHEDA IN USO
          </AppText>
        </View>
      ) : null}
      <EditableTitle value={program.name} accessibilityLabel="Nome della scheda" onChange={(name) => void renameProgram(db, program.id, name)} />

      {program.draft ? (
        // A box that says what the page is, with its button inside: apart from the list below,
        // so saving the program is never mistaken for adding a day.
        <Animated.View exiting={ROW_OUT} style={[styles.draft, { backgroundColor: theme.accentSoft }]}>
          <AppText variant="headline">Questo è un modello</AppText>
          <AppText variant="subhead" tone="textSecondary">
            Cambialo come vuoi. Se torni indietro senza salvarlo, non resta.
          </AppText>
          <View style={styles.draftButton}>
            <Button
              title="Salva tra le mie schede"
              onPress={() => {
                haptics.success();
                void addDraft(db, program.id);
                toast.show('Salvata tra le tue schede', 'checkmark.circle.fill');
              }}
            />
          </View>
        </Animated.View>
      ) : program.active ? null : (
        <View style={styles.use}>
          <Button
            title="Usa questa scheda"
            variant="tinted"
            onPress={() => {
              haptics.success();
              void setActiveProgram(db, program.id);
            }}
          />
        </View>
      )}

      {days.length > 0 && !program.draft ? (
        <View style={styles.segmented}>
          <Segmented options={TABS} value={tab} onChange={switchTab} />
        </View>
      ) : null}

      {tab === 'check' && days.length > 0 && !program.draft ? (
        <ProgramValidity
          programId={program.id}
          onOpen={(muscle, part) => {
            haptics.selection();
            router.push({ pathname: '/muscle-check', params: { program: program.id, muscle, ...(part ? { part } : {}) } });
          }}
        />
      ) : (
      <>
      <SectionTitle>Giorni</SectionTitle>
      <LayoutAnimationConfig skipEntering>
      {editing ? (
        <SortableList
          items={days}
          keyOf={(day) => String(day.id)}
          rowHeight={ROW_HEIGHT}
          onReorder={(keys) => void reorderDays(db, keys.map(Number))}
          onRemove={removeDay}
          footer={addDayRow}
          renderRow={(day) => (
            <Animated.View entering={TO_EDIT} style={styles.editRow}>
              <DayBadge icon={day.icon} />
              <DayText day={day} />
            </Animated.View>
          )}
        />
      ) : (
        <ListGroup>
          {days.map((day) => (
            // A new day fades in and one deleted fades out, the rows around moving smoothly.
            <Animated.View key={day.id} entering={ROW_IN} exiting={ROW_OUT} layout={ROW_LAYOUT}>
            <SwipeToDelete onDelete={() => removeDay(day)}>
              <Link href={{ pathname: '/training/day', params: { id: day.id } }} asChild>
                <Link.Trigger>
                  <Pressable accessibilityRole="button" onPressIn={() => void prefetch(db, dayScreen(day.id))}>
                    {({ pressed }) => (
                      <View style={[styles.day, pressed && { backgroundColor: theme.cardPressed }]}>
                        <Animated.View entering={FROM_EDIT} style={[styles.editRow, styles.slack]}>
                          <DayBadge icon={day.icon} />
                          <DayText day={day} />
                        </Animated.View>
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
                  <Link.Menu title="Icona" icon={day.icon}>
                    {DAY_ICON_CHOICES.map((c) => (
                      <Link.MenuAction
                        key={c.icon}
                        icon={c.icon}
                        isOn={c.icon === day.icon}
                        onPress={() => {
                          haptics.selection();
                          void setDayIcon(db, day.id, c.icon);
                        }}>
                        {c.label}
                      </Link.MenuAction>
                    ))}
                  </Link.Menu>
                  <Link.MenuAction icon="trash" destructive onPress={() => removeDay(day)}>
                    Elimina
                  </Link.MenuAction>
                </Link.Menu>
              </Link>
            </SwipeToDelete>
            </Animated.View>
          ))}
          {addDayRow}
        </ListGroup>
      )}
      </LayoutAnimationConfig>
      {/* The same words in edit mode: nothing under the list moves. */}
      <SectionFooter>I giorni si alternano in quest’ordine, poi si riparte dal primo.</SectionFooter>
      </>
      )}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  draft: { gap: Spacing.xs, padding: Spacing.lg, borderRadius: Radius.lg, borderCurve: 'continuous' },
  draftButton: { marginTop: Spacing.sm },
  segmented: { marginBottom: Spacing.sm },
  status: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingHorizontal: Spacing.xs, marginBottom: 2 },
  use: { marginBottom: Spacing.md },
  dimmed: { opacity: 0.35 },
  editRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  slack: { marginRight: SORTABLE_TEXT_SLACK },
  // Fixed height and room left at the end of the text, so the row is the same in edit mode.
  day: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    height: ROW_HEIGHT,
  },
});
