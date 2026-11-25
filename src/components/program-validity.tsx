import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useLiveQuery } from '@/db/live';
import { programCheckScreen, type ProgramCheck } from '@/db/program-check';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { muscleLabel, type Muscle } from '@/lib/exercises';
import { partLabel, type MusclePart } from '@/lib/muscle-parts';
import { joinNames, levelLabel, type MuscleCheck, type MuscleLevel } from '@/lib/program-check';
import { WEEKLY_SETS } from '@/lib/training';

import { AppText } from './app-text';
import { ListGroup, SectionFooter, SectionTitle } from './card';
import { Icon } from './icon';
import { DayRing } from './plan-day';

const TONE: Record<MuscleLevel, 'accent' | 'warning' | 'danger'> = { good: 'accent', low: 'warning', bad: 'danger' };
const SOFT: Record<MuscleLevel, 'accentSoft' | 'warningSoft' | 'dangerSoft'> = { good: 'accentSoft', low: 'warningSoft', bad: 'dangerSoft' };
const RANK: Record<MuscleLevel, number> = { bad: 0, low: 1, good: 2 };
/** The scale of a muscle's line, in weekly sets: the zone that makes it grow sits in the middle. */
const SCALE = 24;

/**
 * Whether a program does what it is for, growing muscle: how many muscles get the weekly sets that
 * make them grow, and each muscle against them. A tap on a muscle opens it, with what to add and where.
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
      <SectionFooter>
        {`Serie a settimana. Per crescere ne servono tra ${WEEKLY_SETS.low} e ${WEEKLY_SETS.high}: dove un muscolo aiuta soltanto, una serie conta metà. `}
        {data.assumed
          ? 'Nessun giorno di palestra in calendario: ogni giorno contato una volta a settimana.'
          : `Giorni di palestra dal calendario: ${formatTimes(Math.round(data.days.reduce((sum, d) => sum + d.perWeek, 0) * 10) / 10)} a settimana.`}
      </SectionFooter>

    </View>
  );
}

/**
 * At the top: a ring with how many muscles get enough sets to grow, and beside it only the names
 * of those that do not, each in its colour. How often the program comes up is said under the list.
 */
function Verdict({ data }: { data: ProgramCheck }) {
  const theme = useTheme();
  const good = data.muscles.filter((m) => m.level === 'good').length;
  const total = data.muscles.length;
  const lacking = data.muscles.filter((m) => m.level !== 'good').sort((a, b) => RANK[a.level] - RANK[b.level] || a.sets - b.sets);

  return (
    <View style={[styles.verdict, { backgroundColor: theme.card }]}>
      <DayRing done={good} total={total} size={88} stroke={9} label={`${good} muscoli a posto su ${total}`} />
      <View style={styles.verdictText}>
        <AppText variant="headline">{lacking.length === 0 ? 'Tutti i muscoli a posto' : 'Muscoli a posto'}</AppText>
        {lacking.length > 0 ? (
          <View style={styles.chips}>
            {lacking.map((m) => (
              <View key={m.muscle} style={[styles.chip, { backgroundColor: theme[SOFT[m.level]] }]}>
                <AppText variant="footnote" weight="600" style={{ color: theme[TONE[m.level]] }}>
                  {muscleLabel(m.muscle)}
                </AppText>
              </View>
            ))}
          </View>
        ) : (
          <AppText variant="subhead" tone="textSecondary">
            Ognuno ha le serie che servono per crescere.
          </AppText>
        )}
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

/** "3 volte", "1 volta", "2,5 volte". */
function formatTimes(times: number): string {
  const text = String(times).replace('.', ',');
  return `${text} ${times === 1 ? 'volta' : 'volte'}`;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: { paddingVertical: Spacing.xxl, alignItems: 'center' },
  verdict: { borderRadius: Radius.lg, borderCurve: 'continuous', padding: Spacing.lg, flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  verdictText: { flex: 1, gap: Spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderCurve: 'continuous' },
  muscle: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: Spacing.sm },
  muscleHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  zone: { position: 'absolute', top: 0, bottom: 0 },
  fill: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: 3 },
});
