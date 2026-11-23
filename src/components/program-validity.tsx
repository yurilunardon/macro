import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { restFor } from '@/db/exercises';
import { useLiveQuery } from '@/db/live';
import { programCheckScreen, type ProgramCheck } from '@/db/program-check';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { muscleLabel, type Muscle } from '@/lib/exercises';
import { partLabel, type MusclePart } from '@/lib/muscle-parts';
import { joinNames, levelLabel, type MuscleCheck, type MuscleLevel } from '@/lib/program-check';
import { WEEKLY_SETS } from '@/lib/training';

import { AppText } from './app-text';
import { ListGroup, Row, SectionFooter, SectionTitle } from './card';
import { Icon } from './icon';
import { useCountedNumber } from './progress';

const TONE: Record<MuscleLevel, 'accent' | 'warning' | 'danger'> = { good: 'accent', low: 'warning', bad: 'danger' };
const RANK: Record<MuscleLevel, number> = { bad: 0, low: 1, good: 2 };
/** The scale of a muscle's line, in weekly sets: the zone that makes it grow sits in the middle. */
const SCALE = 24;
/** A day's length: each set with its rest and ~40 s of work, a minute to set up each exercise, 10 of warm-up. */
const SET_WORK_S = 40;
const SETUP_S = 60;
const WARM_UP_S = 10 * 60;
/** Two sides of a pair are balanced while neither has more than this many times the other's sets. */
const BALANCED = 1.5;

/**
 * Whether a program does what it is for, growing muscle: how many muscles get the weekly sets that
 * make them grow, each muscle against them, the pairs that should go together, and how long each
 * day takes. A tap on a muscle opens it, with what to add and where.
 */
export function ProgramValidity({ programId, onOpen }: { programId: number; onOpen: (muscle: Muscle, part: MusclePart | null) => void }) {
  const today = useToday();
  const screen = programCheckScreen(programId, today);
  const { data } = useLiveQuery(screen.key, screen.query, screen.topics);

  if (!data) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  }
  const muscles = [...data.muscles].sort((a, b) => RANK[a.level] - RANK[b.level] || a.sets - b.sets);
  return (
    <View>
      <Verdict data={data} />

      <SectionTitle>Muscoli</SectionTitle>
      <ListGroup>
        {muscles.map((m) => (
          <MuscleRow key={m.muscle} check={m} onPress={() => onOpen(m.muscle, null)} />
        ))}
      </ListGroup>
      <SectionFooter>{`Serie a settimana. Per crescere ne servono tra ${WEEKLY_SETS.low} e ${WEEKLY_SETS.high}: dove un muscolo aiuta soltanto, una serie conta metà.`}</SectionFooter>

      <SectionTitle>Equilibrio</SectionTitle>
      <ListGroup>
        <Balance label="Spinta e tirata" left={sum(data, ['chest', 'triceps'])} right={sum(data, ['back', 'biceps'])} more={['Più spinta', 'Più tirata']} />
        <Balance label="Quadricipiti e femorali" left={sum(data, ['quads'])} right={sum(data, ['hamstrings'])} more={['Più quadricipiti', 'Più femorali']} />
      </ListGroup>
      <SectionFooter>Petto e tricipiti contro dorso e bicipiti; davanti e dietro la coscia.</SectionFooter>

      <SectionTitle>Durata dei giorni</SectionTitle>
      <ListGroup>
        {data.days.map((day) => (
          <Row key={day.id} title={day.name} detail={`circa ${dayMinutes(data, day.id)} min`} />
        ))}
      </ListGroup>
      <SectionFooter>Con il recupero di ogni esercizio e 10 minuti di riscaldamento.</SectionFooter>
    </View>
  );
}

/** At the top: how many muscles are in the zone, one dot per muscle, and how often the program comes up. */
function Verdict({ data }: { data: ProgramCheck }) {
  const theme = useTheme();
  const good = data.muscles.filter((m) => m.level === 'good').length;
  const total = data.muscles.length;
  const counted = useCountedNumber(good);
  const lacking = data.muscles.filter((m) => m.level !== 'good');
  const perWeek = Math.round(data.days.reduce((sum, d) => sum + d.perWeek, 0) * 10) / 10;
  const word = lacking.length === 0 ? 'Completa' : lacking.length <= 2 ? 'Quasi completa' : 'Da completare';
  const tone = lacking.length === 0 ? 'accent' : lacking.length <= 2 ? 'warning' : 'danger';
  const ordered = [...data.muscles].sort((a, b) => RANK[b.level] - RANK[a.level]);

  return (
    <View style={[styles.verdict, { backgroundColor: theme.card }]}>
      <AppText variant="headline" tone={tone}>
        {word}
      </AppText>
      <View style={styles.verdictNumber}>
        <AppText variant="display" numeric>
          {String(counted)}
        </AppText>
        <AppText variant="title3" tone="textSecondary" numeric>
          {`su ${total}`}
        </AppText>
      </View>
      <AppText variant="subhead" tone="textSecondary">
        muscoli allenati abbastanza per crescere
      </AppText>
      <View style={styles.dots}>
        {ordered.map((m) => (
          <View key={m.muscle} style={[styles.dot, { backgroundColor: theme[TONE[m.level]] }]} />
        ))}
      </View>
      {lacking.length > 0 ? (
        <AppText variant="subhead">{`Da rinforzare: ${joinNames(lacking.sort((a, b) => a.sets - b.sets).map((m) => muscleLabel(m.muscle).toLowerCase()))}.`}</AppText>
      ) : null}
      <View style={[styles.divider, { backgroundColor: theme.separator }]} />
      <View style={styles.week}>
        <Icon name="calendar" size={15} tone="textSecondary" />
        <AppText variant="footnote" tone="textSecondary" style={styles.flex}>
          {data.assumed
            ? 'Nessun giorno di palestra in calendario: ogni giorno contato una volta a settimana.'
            : `${formatTimes(perWeek)} a settimana, dai giorni di palestra del calendario.`}
        </AppText>
      </View>
    </View>
  );
}

/** A muscle: its name and how it is doing, a short line against the zone, its weekly sets. */
function MuscleRow({ check, onPress }: { check: MuscleCheck; onPress: () => void }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const color = theme[TONE[check.level]];
  const at = (value: number) => (Math.min(value, SCALE) / SCALE) * width;
  const weak = check.parts.filter((p) => p.level !== 'good');
  const subtitle =
    check.level !== 'good'
      ? check.missing === 1
        ? 'Manca 1 serie'
        : `Mancano ${check.missing} serie`
      : weak.length > 0
        ? `Poco: ${joinNames(weak.map((p) => partLabel(p.part).toLowerCase()))}`
        : levelLabel(check.level);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${muscleLabel(check.muscle)}, ${check.shown} serie a settimana, ${subtitle}`}
      style={({ pressed }) => [styles.muscle, pressed && { backgroundColor: theme.cardPressed }]}>
      <View style={styles.muscleHead}>
        <View style={styles.flex}>
          <AppText numberOfLines={1}>{muscleLabel(check.muscle)}</AppText>
          <AppText
            variant="footnote"
            numberOfLines={1}
            style={{ color: check.level !== 'good' ? color : weak.length > 0 ? theme.warning : theme.textSecondary }}>
            {subtitle}
          </AppText>
        </View>
        <AppText variant="title3" numeric style={{ color }}>
          {String(check.shown)}
        </AppText>
        <Icon name="chevron.right" size={13} tone="textTertiary" weight="semibold" />
      </View>
      <View style={[styles.track, { backgroundColor: theme.track }]} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        <View style={[styles.zone, { left: at(WEEKLY_SETS.low), width: at(WEEKLY_SETS.high) - at(WEEKLY_SETS.low), backgroundColor: theme.accentSoft }]} />
        <View style={[styles.fill, { width: Math.max(at(check.sets), check.sets > 0 ? 4 : 0), backgroundColor: color }]} />
      </View>
    </Pressable>
  );
}

/** Two sides that should go together, their sets, and which one is ahead if one is. */
function Balance({ label, left, right, more }: { label: string; left: number; right: number; more: [string, string] }) {
  const theme = useTheme();
  const ratio = Math.max(left, right) / Math.max(1, Math.min(left, right));
  const even = left + right === 0 || ratio <= BALANCED;
  const word = left + right === 0 ? 'Nessuna serie' : even ? 'Bilanciato' : left > right ? more[0] : more[1];
  return (
    <View style={styles.balance}>
      <View style={styles.flex}>
        <AppText>{label}</AppText>
        <AppText variant="footnote" tone="textSecondary" numeric>
          {`${Math.round(left)} e ${Math.round(right)} serie`}
        </AppText>
      </View>
      <View style={styles.balanceWord}>
        <Icon name={even ? 'checkmark.circle.fill' : 'exclamationmark.circle.fill'} size={15} tone={even ? 'accent' : 'warning'} />
        <AppText variant="subhead" weight="600" style={{ color: even ? theme.accent : theme.warning }}>
          {word}
        </AppText>
      </View>
    </View>
  );
}

function sum(data: ProgramCheck, muscles: readonly Muscle[]): number {
  return data.muscles.filter((m) => muscles.includes(m.muscle)).reduce((total, m) => total + m.sets, 0);
}

/** About how long a day takes, to the nearest 5 minutes. */
function dayMinutes(data: ProgramCheck, dayId: number): number {
  const day = data.days.find((d) => d.id === dayId);
  if (!day) return 0;
  const seconds = day.exercises.reduce((total, e) => {
    const planned = data.planned.get(e.planId);
    const rest = planned ? (planned.restSeconds ?? restFor(planned.exercise)) : 90;
    return total + e.sets * (rest + SET_WORK_S) + SETUP_S;
  }, WARM_UP_S);
  return Math.max(5, Math.round(seconds / 60 / 5) * 5);
}

/** "3 volte", "1 volta", "2,5 volte". */
function formatTimes(times: number): string {
  const text = String(times).replace('.', ',');
  return `${text} ${times === 1 ? 'volta' : 'volte'}`;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: { paddingVertical: Spacing.xxl, alignItems: 'center' },
  verdict: { borderRadius: Radius.lg, borderCurve: 'continuous', padding: Spacing.lg, gap: Spacing.xs },
  verdictNumber: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm, marginTop: Spacing.xs },
  dots: { flexDirection: 'row', gap: 6, marginVertical: Spacing.sm },
  dot: { flex: 1, height: 8, borderRadius: 4 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.sm },
  week: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  muscle: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: Spacing.sm },
  muscleHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  zone: { position: 'absolute', top: 0, bottom: 0 },
  fill: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: 3 },
  balance: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, minHeight: 56 },
  balanceWord: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
});
