/**
 * The coach where the rest of the app is: its sentence for today in the Calendar, the week on
 * Mondays, the comment at the end of a workout, and the one question ready when the diary needs it.
 * Each opens the coach over what was on screen, already knowing what it is about.
 */
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Icon } from '@/components/icon';
import { Radius, Spacing } from '@/constants/theme';
import { getCoachHome, getCoachWorkoutNote } from '@/db/coach';
import { useLiveQuery } from '@/db/live';
import { useTheme } from '@/hooks/use-theme';
import { lastWeek, readyQuestion, type CoachWeek } from '@/lib/coach';
import { weekdayOf, type DateKey } from '@/lib/dates';
import type { Targets } from '@/lib/goals';
import { coachFailure, useCoachKey } from '@/services/coach';
import { ensureDaily, ensureWeek, ensureWorkoutNote } from '@/services/coach-work';

export type CoachAbout = {
  /** What it is about, said on the sheet: "Panca piana". */
  about: string;
  /** The data the model gets with the question. */
  context?: string;
  /** A question to send at once. */
  question?: string;
  /** A finished workout, whose sets go with the question. */
  workout?: number;
};

/** The coach over the current screen, already on the subject. */
export function openCoach(router: ReturnType<typeof useRouter>, about: CoachAbout): void {
  const params: Record<string, string> = { about: about.about };
  if (about.context) params.context = about.context;
  if (about.question) params.question = about.question;
  if (about.workout !== undefined) params.workout = String(about.workout);
  router.push({ pathname: '/coach-ask', params });
}

/** A line of the coach: the sparkles, what it says and what a tap does. */
function CoachLine({ text, action, busy = false, onPress }: { text: string; action?: string; busy?: boolean; onPress?: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={`Coach: ${text}`}
      style={({ pressed }) => [styles.line, { backgroundColor: theme.card }, pressed && { backgroundColor: theme.cardPressed }]}>
      <Icon name="sparkles" size={17} tone="accent" />
      <AppText variant="subhead" tone={busy ? 'textSecondary' : 'text'} style={styles.flex}>
        {text}
      </AppText>
      {busy ? <ActivityIndicator /> : action ? (
        <AppText variant="subhead" tone="accent">
          {action}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/**
 * Above today in the Calendar: the coach's sentence for the day, written the first time the
 * Calendar is opened that day; on Mondays, the week before in three points.
 */
export function CoachToday({ today }: { today: DateKey }) {
  const db = useSQLiteContext();
  const router = useRouter();
  const { key } = useCoachKey();
  const { data } = useLiveQuery('coach-home', getCoachHome, ['settings']);
  const [failure, setFailure] = useState<string | null>(null);
  const weekFrom = lastWeek(today).from;
  const week = data?.weeks.find((w) => w.from === weekFrom) ?? null;
  const daily = data?.daily?.date === today ? data.daily : null;
  const loaded = data !== undefined;
  const hasWeek = week !== null;
  const hasDaily = daily !== null;

  useEffect(() => {
    if (!key || !loaded) return;
    if (!hasDaily) ensureDaily(db, today).catch((e: unknown) => setFailure(coachFailure(e)));
    if (!hasWeek) ensureWeek(db, today).catch(() => undefined);
  }, [db, key, loaded, hasDaily, hasWeek, today]);

  if (!key) return <CoachLine text="Collega Gemini: il coach ti scrive qui ogni mattina cosa conta oggi." action="Collega" onPress={() => router.push('/coach')} />;
  if (!data) return null;
  if (week && weekdayOf(today) === 1) return <WeekCard week={week} onPress={() => router.push({ pathname: '/coach', params: { tab: 'week' } })} />;
  if (daily) return <CoachLine text={daily.text} onPress={() => openCoach(router, { about: 'Il consiglio di oggi', context: daily.text })} />;
  if (failure) {
    return (
      <CoachLine
        text={`Il coach non ha risposto: ${failure.charAt(0).toLowerCase()}${failure.slice(1)}.`}
        action="Riprova"
        onPress={() => {
          setFailure(null);
          ensureDaily(db, today, true).catch((e: unknown) => setFailure(coachFailure(e)));
        }}
      />
    );
  }
  return <CoachLine text="Il coach sta guardando la giornata…" busy />;
}

/** A week in three points, with the way to the whole analysis. */
export function WeekCard({ week, onPress }: { week: CoachWeek; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.week, { backgroundColor: theme.card }, pressed && { backgroundColor: theme.cardPressed }]}>
      <View style={styles.row}>
        <Icon name="sparkles" size={17} tone="accent" />
        <AppText variant="headline" style={styles.flex}>
          La settimana scorsa
        </AppText>
        <AppText variant="footnote" tone="textSecondary">
          {weekSpan(week)}
        </AppText>
      </View>
      {week.summary.map((point, i) => (
        <View key={i} style={styles.point}>
          <AppText variant="subhead">•</AppText>
          <AppText variant="subhead" style={styles.flex}>
            {point}
          </AppText>
        </View>
      ))}
      <AppText variant="subhead" tone="accent">
        {week.proposals.length > 0 ? `Leggi l’analisi · ${week.proposals.length === 1 ? '1 proposta' : `${week.proposals.length} proposte`}` : 'Leggi l’analisi'}
      </AppText>
    </Pressable>
  );
}

/** "16–22 nov". */
export function weekSpan(week: Pick<CoachWeek, 'from' | 'to'>): string {
  const months = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  const [, fm, fd] = week.from.split('-').map(Number);
  const [, tm, td] = week.to.split('-').map(Number);
  return fm === tm ? `${fd}–${td} ${months[tm - 1]}` : `${fd} ${months[fm - 1]} – ${td} ${months[tm - 1]}`;
}

/**
 * Under the recap of a workout: two sentences of the coach on it. Written by itself for a workout
 * just ended; for an older one, only when asked.
 */
export function CoachWorkoutComment({ workoutId, today, recent }: { workoutId: number; today: DateKey; recent: boolean }) {
  const db = useSQLiteContext();
  const router = useRouter();
  const { key } = useCoachKey();
  const { data } = useLiveQuery(`coach-workout:${workoutId}`, (database) => getCoachWorkoutNote(database, workoutId), ['settings']);
  // 'tried': written by itself or nothing to write; any other text is what went wrong.
  const [state, setState] = useState<string>('idle');
  const loaded = data !== undefined;
  const has = Boolean(data);

  const write = (force: boolean) => {
    setState('busy');
    ensureWorkoutNote(db, today, workoutId, force)
      .then(() => setState('tried'))
      .catch((e: unknown) => setState(coachFailure(e)));
  };

  // A workout just ended gets its comment by itself; meanwhile it shows as on its way.
  const auto = Boolean(key) && loaded && !has && recent;
  useEffect(() => {
    if (auto)
      ensureWorkoutNote(db, today, workoutId)
        .then(() => setState('tried'))
        .catch((e: unknown) => setState(coachFailure(e)));
  }, [auto, db, today, workoutId]);

  if (!key || !loaded) return null;
  const ask = (context: string) => openCoach(router, { about: 'Questo allenamento', workout: workoutId, context });
  if (data) {
    return (
      <View style={styles.comment}>
        <CommentCard text={data.text} onReply={() => ask(`Il tuo commento: ${data.text}`)} />
      </View>
    );
  }
  if (state === 'busy' || (auto && state === 'idle')) return <View style={styles.comment}><CoachLine text="Il coach sta guardando l’allenamento…" busy /></View>;
  if (state !== 'idle' && state !== 'tried') return <View style={styles.comment}><CoachLine text={state} action="Riprova" onPress={() => write(true)} /></View>;
  return (
    <View style={styles.comment}>
      <CoachLine text="Chiedi al coach un commento su questo allenamento" action="Chiedi" onPress={() => write(true)} />
    </View>
  );
}

function CommentCard({ text, onReply }: { text: string; onReply: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.week, { backgroundColor: theme.card }]}>
      <View style={styles.row}>
        <Icon name="sparkles" size={17} tone="accent" />
        <AppText variant="headline" style={styles.flex}>
          Il coach
        </AppText>
      </View>
      <AppText variant="subhead">{text}</AppText>
      <Pressable onPress={onReply} accessibilityRole="button" hitSlop={8} style={styles.reply}>
        <AppText variant="subhead" tone="accent">
          Rispondi
        </AppText>
      </Pressable>
    </View>
  );
}

/** Under the rings of today, when the numbers say there is something to ask. */
export function ReadyQuestion({ eaten, target, summary }: { eaten: { kcal: number; protein: number }; target: Targets | null; summary: string }) {
  const theme = useTheme();
  const router = useRouter();
  const { key } = useCoachKey();
  const question = readyQuestion(new Date().getHours(), eaten, target);
  if (!key || !question) return null;
  return (
    <Pressable
      onPress={() => openCoach(router, { about: 'Il diario di oggi', context: summary, question })}
      accessibilityRole="button"
      style={({ pressed }) => [styles.ready, { backgroundColor: theme.accentSoft }, pressed && styles.pressed]}>
      <Icon name="sparkles" size={14} tone="accent" />
      <AppText variant="subhead" weight="600" tone="accent" numberOfLines={1} style={styles.shrink}>
        {question}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, borderRadius: Radius.lg, borderCurve: 'continuous', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  week: { gap: Spacing.sm, borderRadius: Radius.lg, borderCurve: 'continuous', padding: Spacing.lg },
  point: { flexDirection: 'row', gap: 6 },
  comment: { marginTop: Spacing.lg },
  reply: { alignSelf: 'flex-start' },
  ready: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 36, paddingHorizontal: 12, borderRadius: 18 },
  pressed: { opacity: 0.7 },
});
