import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/app-text';
import { ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { Icon } from '@/components/icon';
import { useCountedNumber } from '@/components/progress';
import { Radius, Spacing } from '@/constants/theme';
import { applyPick } from '@/db/exercise-picks';
import type { Exercise } from '@/db/exercises';
import { prefetch, useLiveQuery } from '@/db/live';
import { getMuscleSuggestions, programCheckScreen, type ProgramCheck } from '@/db/program-check';
import { addDay, DEFAULT_PLAN, removeDayExercise } from '@/db/programs';
import { dayScreen } from '@/db/screens';
import { useExerciseNames } from '@/hooks/use-exercise-names';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { equipmentLabel, isMuscle, muscleLabel, type Muscle } from '@/lib/exercises';
import { isMusclePart, partLabel, partsOfMuscle, partsTrained, type MusclePart } from '@/lib/muscle-parts';
import { joinNames, levelLabel, muscleWithArticle, PART_GOOD, weakestPart, type CheckDay, type MuscleLevel, type PartCheck } from '@/lib/program-check';
import { muscleShare, WEEKLY_SETS } from '@/lib/training';
import { haptics } from '@/services/haptics';

/** How long the sheet takes to go, before what opens next. */
const SHEET_GONE_MS = 320;
/** Exercises shown in a day's card; the rest are counted. */
const CARD_ROWS = 6;
const CARD_IN = FadeIn.duration(220);

const TONE: Record<MuscleLevel, 'accent' | 'warning' | 'danger'> = { good: 'accent', low: 'warning', bad: 'danger' };

/**
 * One muscle of a program, opened from its validity: its weekly sets against the ones that make it
 * grow, the days of the program with the exercises that train it picked out, and exercises to
 * add to any day, or to a new one.
 */
export default function MuscleCheckSheet() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const today = useToday();
  const { names } = useExerciseNames();
  const params = useLocalSearchParams<{ program?: string; muscle?: string; part?: string }>();
  const programId = Number(params.program);
  const muscle: Muscle = isMuscle(params.muscle) ? params.muscle : 'chest';
  const screen = programCheckScreen(programId, today);
  const { data } = useLiveQuery(screen.key, screen.query, screen.topics);
  // The day new exercises go to: the one advised, until another is tapped.
  const [chosen, setChosen] = useState<number | null>(null);
  const check = data?.muscles.find((m) => m.muscle === muscle);
  // The part looked at: the one tapped on the body, else the one that lacks most, until another is tapped.
  const [picked, setPicked] = useState<MusclePart | null | undefined>(isMusclePart(params.part) ? params.part : undefined);
  const focus = picked === undefined ? (check ? (weakestPart(check)?.part ?? null) : null) : picked;
  // Chosen as the sheet opens or the part changes: an exercise just added stays in its row, with a tick.
  const [suggestions, setSuggestions] = useState<Exercise[]>([]);
  useEffect(() => {
    void (async () => {
      const forPart = focus ? await getMuscleSuggestions(db, programId, muscle, { part: focus }) : [];
      setSuggestions(forPart.length > 0 ? forPart : await getMuscleSuggestions(db, programId, muscle));
    })();
  }, [db, programId, muscle, focus]);

  if (!data || !check) return <View style={[styles.sheet, { backgroundColor: theme.background }]} />;

  const target = data.days.find((d) => d.id === (chosen ?? check.dayId)) ?? null;
  const planned = [...data.planned.values()];
  const tone = TONE[check.level];

  const toggle = async (exercise: Exercise) => {
    if (!target) return;
    const there = planned.find((p) => p.dayId === target.id && p.exercise.id === exercise.id);
    haptics.selection();
    if (there) await removeDayExercise(db, there.id);
    else await applyPick(db, 'day', target.id, exercise);
  };

  const newDay = () =>
    Alert.prompt('Nuovo giorno', `Per esempio «${muscleLabel(muscle)}»`, [
      { text: 'Annulla', style: 'cancel' },
      {
        text: 'Crea',
        onPress: (text?: string) => {
          const name = (text ?? '').trim();
          if (name === '') return;
          void addDay(db, programId, name).then((dayId) => {
            haptics.success();
            setChosen(dayId);
          });
        },
      },
    ]);

  // The sheet goes first, then the page it was over moves on.
  const openDay = (dayId: number, highlight?: number) => {
    void prefetch(db, dayScreen(dayId));
    router.back();
    setTimeout(() => router.push({ pathname: '/training/day', params: { id: dayId, ...(highlight ? { highlight } : {}) } }), SHEET_GONE_MS);
  };

  const above = check.sets > WEEKLY_SETS.high;
  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
      <View style={styles.padded}>
        <View style={styles.title}>
          <AppText variant="title">{muscleLabel(muscle)}</AppText>
          <AppText variant="headline" tone={tone}>
            {levelLabel(check.level)}
          </AppText>
        </View>
        <SetsGauge sets={check.sets} level={check.level} />
        <AppText variant="subhead" tone="textSecondary">
          {check.missing > 0
            ? `${check.missing === 1 ? 'Ne manca 1' : `Ne mancano ${check.missing}`} per arrivare a ${WEEKLY_SETS.low}, il minimo per crescere.`
            : above
              ? `Più di ${WEEKLY_SETS.high}: va bene solo se recuperi da un allenamento all’altro.`
              : `Tra ${WEEKLY_SETS.low} e ${WEEKLY_SETS.high}: va bene così.`}
        </AppText>
      </View>

      {check.parts.length > 0 ? (
        <View style={styles.padded}>
          <SectionTitle>Le parti</SectionTitle>
          <PartRows
            parts={check.parts}
            focus={focus}
            onPick={(part) => {
              haptics.selection();
              setPicked(part === focus ? null : part);
            }}
          />
          <SectionFooter>{`Una parte va bene da ${PART_GOOD} serie: il resto del muscolo la aiuta. Toccane una per vedere cosa la allena.`}</SectionFooter>
        </View>
      ) : null}

      <View>
        <View style={styles.padded}>
          <SectionTitle>{focus ? `La scheda · ${partLabel(focus).toLowerCase()}` : 'La scheda'}</SectionTitle>
        </View>
        <DayCards
          data={data}
          muscle={muscle}
          trains={focus ? new Set(check.parts.find((p) => p.part === focus)?.planIds) : null}
          advised={check.dayId}
          target={target?.id ?? null}
          title={(planId) => {
            const exercise = data.planned.get(planId)?.exercise;
            return exercise ? names(exercise).title : '';
          }}
          onChoose={(dayId) => {
            haptics.selection();
            setChosen(dayId);
          }}
          onOpen={openDay}
          onNew={newDay}
        />
      </View>

      {target ? (
        <View style={styles.padded}>
          <SectionTitle>{`Aggiungi a ${target.name}`}</SectionTitle>
          <ListGroup>
            {suggestions.map((exercise) => {
              const on = planned.some((p) => p.dayId === target.id && p.exercise.id === exercise.id);
              return (
                <Row
                  key={exercise.id}
                  title={names(exercise).title}
                  subtitle={[equipmentLabel(exercise.equipment), partsSubtitle(exercise, muscle), `${DEFAULT_PLAN.sets} serie`].filter(Boolean).join(' · ')}
                  detail={
                    <Pressable
                      onPress={() => void toggle(exercise)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`${on ? 'Togli' : 'Aggiungi'} ${names(exercise).title}`}
                      style={[styles.plus, { backgroundColor: on ? theme.accent : theme.accentSoft }]}>
                      <Icon name={on ? 'checkmark' : 'plus'} size={15} color={on ? theme.onAccent : theme.accent} weight="bold" />
                    </Pressable>
                  }
                />
              );
            })}
            <Row
              title={`Tutti gli esercizi per ${muscleWithArticle(muscle)}`}
              onPress={() => router.push({ pathname: '/exercise-picker', params: { target: 'day', id: target.id, muscle } })}
            />
          </ListGroup>
          {data.assumed ? <SectionFooter>In calendario non ci sono giorni di palestra: ogni giorno è contato una volta a settimana.</SectionFooter> : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

/** The scale of the gauge: a little past the most useful, so 20 does not sit at the very end. */
const GAUGE_MAX = 24;
const GAUGE_MS = 700;

/**
 * The week's sets as a number that counts up and a capsule that fills along a scale, with the
 * useful zone from 10 to 20 marked on it.
 */
function SetsGauge({ sets, level }: { sets: number; level: MuscleLevel }) {
  const theme = useTheme();
  const shown = useCountedNumber(Math.round(sets), GAUGE_MS);
  const [width, setWidth] = useState(0);
  const fill = useSharedValue(0);
  useEffect(() => {
    fill.set(withTiming(Math.min(sets, GAUGE_MAX) / GAUGE_MAX, { duration: GAUGE_MS, easing: Easing.inOut(Easing.cubic) }));
  }, [fill, sets]);
  // Slid in from the left rather than widened: a width lays out the sheet at every frame.
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (fill.get() - 1) * width }] }));
  const at = (value: number) => (value / GAUGE_MAX) * width;
  const color = theme[TONE[level]];

  return (
    <View style={styles.gauge}>
      <View style={styles.gaugeHead}>
        <AppText variant="display" numeric style={{ color }}>
          {String(shown)}
        </AppText>
        <AppText variant="subhead" tone="textSecondary">
          serie a settimana
        </AppText>
      </View>
      <View style={[styles.track, { backgroundColor: theme.track }]} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        <View style={[styles.zone, { left: at(WEEKLY_SETS.low), width: at(WEEKLY_SETS.high - WEEKLY_SETS.low), backgroundColor: theme.accentSoft }]} />
        <Animated.View style={[styles.fillBar, { backgroundColor: color }, fillStyle]} />
      </View>
      <View style={styles.marks}>
        <AppText variant="caption" tone="textSecondary" numeric style={[styles.mark, { left: at(WEEKLY_SETS.low) - 30 }]}>
          {String(WEEKLY_SETS.low)}
        </AppText>
        <AppText variant="caption" tone="accent" weight="600" style={[styles.zoneLabel, { left: at(WEEKLY_SETS.low), width: at(WEEKLY_SETS.high - WEEKLY_SETS.low) }]}>
          per crescere
        </AppText>
        <AppText variant="caption" tone="textSecondary" numeric style={[styles.mark, { left: at(WEEKLY_SETS.high) - 30 }]}>
          {String(WEEKLY_SETS.high)}
        </AppText>
      </View>
    </View>
  );
}

/**
 * The days of the program side by side, each with its exercises: the ones that train the muscle
 * stand out and open the day on them; a tap on a card picks the day to add to.
 */
function DayCards({
  data,
  muscle,
  trains,
  advised,
  target,
  title,
  onChoose,
  onOpen,
  onNew,
}: {
  data: ProgramCheck;
  muscle: Muscle;
  /** With a part looked at, the rows that train it; the others are not picked out. */
  trains: ReadonlySet<number> | null;
  advised: number | null;
  target: number | null;
  title: (planId: number) => string;
  onChoose: (dayId: number) => void;
  onOpen: (dayId: number, highlight?: number) => void;
  onNew: () => void;
}) {
  const theme = useTheme();
  const window = useWindowDimensions();
  const width = Math.min(300, window.width * 0.72);
  // The advised day first, the others in the program's order.
  const days = [...data.days].sort((a, b) => (a.id === advised ? -1 : b.id === advised ? 1 : 0));

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={width + Spacing.md} decelerationRate="fast" contentContainerStyle={styles.cards}>
      {days.map((day) => (
        <DayCard
          key={day.id}
          day={day}
          muscle={muscle}
          trains={trains}
          width={width}
          advised={day.id === advised}
          chosen={day.id === target}
          title={title}
          onChoose={() => onChoose(day.id)}
          onOpen={(highlight) => onOpen(day.id, highlight)}
        />
      ))}
      <Pressable
        onPress={onNew}
        accessibilityRole="button"
        style={({ pressed }) => [styles.newDay, { width: width * 0.6, borderColor: theme.separator }, pressed && { backgroundColor: theme.cardPressed }]}>
        <Icon name="plus" size={22} tone="accent" weight="semibold" />
        <AppText tone="accent" align="center">
          Nuovo giorno
        </AppText>
      </Pressable>
    </ScrollView>
  );
}

function DayCard({
  day,
  muscle,
  trains,
  width,
  advised,
  chosen,
  title,
  onChoose,
  onOpen,
}: {
  day: CheckDay;
  muscle: Muscle;
  trains: ReadonlySet<number> | null;
  width: number;
  advised: boolean;
  chosen: boolean;
  title: (planId: number) => string;
  onChoose: () => void;
  onOpen: (highlight?: number) => void;
}) {
  const theme = useTheme();
  const sets = day.exercises.reduce((sum, e) => sum + (muscleShare(e, muscle) === 1 ? e.sets : 0), 0);
  const shown = day.exercises.slice(0, CARD_ROWS);
  const more = day.exercises.length - shown.length;

  return (
    <Pressable
      onPress={onChoose}
      accessibilityRole="button"
      accessibilityState={{ selected: chosen }}
      accessibilityHint="Gli esercizi nuovi vanno in questo giorno"
      style={[styles.card, { width, backgroundColor: theme.card, borderColor: chosen ? theme.accent : 'transparent' }]}>
      <View style={styles.cardHead}>
        <AppText variant="headline" numberOfLines={1} style={styles.flex}>
          {day.name}
        </AppText>
        <Pressable onPress={() => onOpen()} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Apri ${day.name}`}>
          <Icon name="arrow.up.right" size={15} tone="textSecondary" weight="semibold" />
        </Pressable>
      </View>
      <AppText variant="footnote" tone={advised ? 'accent' : 'textSecondary'} numberOfLines={1}>
        {[advised ? 'Consigliato' : null, sets > 0 ? `${sets} serie per ${muscleWithArticle(muscle)}` : `Niente per ${muscleWithArticle(muscle)}`]
          .filter(Boolean)
          .join(' · ')}
      </AppText>
      <View style={styles.cardRows}>
        {shown.length === 0 ? (
          <AppText variant="subhead" tone="textTertiary">
            Ancora nessun esercizio
          </AppText>
        ) : null}
        {shown.map((e) => {
          const share = trains && !trains.has(e.planId) ? 0 : muscleShare(e, muscle);
          return (
            <Animated.View key={e.planId} entering={CARD_IN}>
              <Pressable
                onPress={() => onOpen(e.planId)}
                accessibilityRole="button"
                accessibilityHint={`Apre ${day.name}`}
                style={({ pressed }) => [styles.cardRow, share > 0 && { backgroundColor: share === 1 ? theme.accentSoft : theme.fill }, pressed && { opacity: 0.6 }]}>
                <AppText variant="subhead" tone={share > 0 ? 'text' : 'textTertiary'} weight={share === 1 ? '600' : '400'} numberOfLines={1} style={styles.flex}>
                  {title(e.planId)}
                </AppText>
                {share > 0 ? (
                  <AppText variant="footnote" tone={share === 1 ? 'accent' : 'textSecondary'} numeric numberOfLines={1}>
                    {share === 1 ? `${e.sets} serie` : 'aiuta'}
                  </AppText>
                ) : null}
              </Pressable>
            </Animated.View>
          );
        })}
        {more > 0 ? (
          <AppText variant="footnote" tone="textTertiary" style={styles.more}>
            {`e altri ${more}`}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

/** "laterale", "dorsali e parte alta": what of the muscle an exercise trains, when it is not all of it. */
function partsSubtitle(exercise: { ref: string | null }, muscle: Muscle): string | null {
  const all = partsOfMuscle(muscle);
  const trained = partsTrained(exercise, muscle);
  if (all.length === 0 || trained.length === all.length) return null;
  return joinNames(trained.map((p) => partLabel(p).toLowerCase()));
}

/** Each part of the muscle with its sets on a short line, the one looked at tinted. */
function PartRows({ parts, focus, onPick }: { parts: PartCheck[]; focus: MusclePart | null; onPick: (part: MusclePart) => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.parts, { backgroundColor: theme.card }]}>
      {parts.map((p) => {
        const on = p.part === focus;
        const color = theme[TONE[p.level]];
        return (
          <Pressable
            key={p.part}
            onPress={() => onPick(p.part)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={({ pressed }) => [styles.part, on && { backgroundColor: theme.accentSoft }, pressed && { opacity: 0.6 }]}>
            <AppText weight={on ? '600' : '400'} style={styles.partName} numberOfLines={1}>
              {partLabel(p.part)}
            </AppText>
            <View style={[styles.partTrack, { backgroundColor: theme.track }]}>
              <View style={[styles.partFill, { width: `${(Math.min(p.sets, PART_SCALE) / PART_SCALE) * 100}%`, backgroundColor: color }]} />
              <View style={[styles.partMark, { left: `${(PART_GOOD / PART_SCALE) * 100}%`, backgroundColor: theme.textTertiary }]} />
            </View>
            <AppText variant="subhead" tone="textSecondary" numeric style={styles.partSets}>
              {`${p.shown} serie`}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The scale of a part's line: twice what it needs, so "enough" sits in the middle. */
const PART_SCALE = PART_GOOD * 2;

const styles = StyleSheet.create({
  sheet: { flexGrow: 1, gap: Spacing.lg, paddingTop: Spacing.xl },
  padded: { paddingHorizontal: Spacing.lg, gap: Spacing.sm },
  title: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.md },
  flex: { flex: 1 },
  gauge: { gap: Spacing.sm },
  gaugeHead: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm },
  track: { height: 14, borderRadius: 7, overflow: 'hidden' },
  zone: { position: 'absolute', top: 0, bottom: 0 },
  fillBar: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, borderRadius: 7 },
  marks: { height: 16 },
  mark: { position: 'absolute', width: 60, textAlign: 'center' },
  zoneLabel: { position: 'absolute', textAlign: 'center' },
  cards: { gap: Spacing.md, paddingHorizontal: Spacing.lg },
  card: { borderRadius: Radius.lg, borderCurve: 'continuous', borderWidth: 2, padding: Spacing.md, gap: 2 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  cardRows: { marginTop: Spacing.sm, gap: 2 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 32, paddingHorizontal: Spacing.sm, borderRadius: Radius.sm, borderCurve: 'continuous' },
  more: { paddingHorizontal: Spacing.sm, paddingTop: 2 },
  newDay: {
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    padding: Spacing.md,
  },
  parts: { borderRadius: Radius.lg, borderCurve: 'continuous', padding: Spacing.xs },
  part: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 44, paddingHorizontal: Spacing.md, borderRadius: Radius.md, borderCurve: 'continuous' },
  partName: { width: 118 },
  partTrack: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  partFill: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: 3 },
  partMark: { position: 'absolute', top: 0, bottom: 0, width: 2 },
  partSets: { width: 64, textAlign: 'right' },
  plus: { width: 32, height: 32, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
});
