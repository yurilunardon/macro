import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Pressable, StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { getWeightsSince } from '@/db/body';
import type { CalendarData } from '@/db/calendar';
import { getDailyTotals } from '@/db/entries';
import { useLiveQuery } from '@/db/live';
import { getDoseTicks, getSupplements, takeAllDoses } from '@/db/supplements';
import { useActivityColors } from '@/hooks/use-activity-colors';
import { useTheme } from '@/hooks/use-theme';
import { busyDates, formatMinutes, isPendingDelete, itemMinutes, type ActivityType, type AgendaItem } from '@/lib/calendar';
import { daysBetween, formatDayTitle, formatShortDate, fromDateKey, type DateKey } from '@/lib/dates';
import { countLabel, formatKcal, formatNumber } from '@/lib/format';
import { dosesDue, type Supplement } from '@/lib/supplements';
import { averageClock, buildTimeline, tickTimes, workoutTimes, type DoseTick, type TimelineRow } from '@/lib/timeline';
import { formatWorkoutLength } from '@/lib/training';
import { haptics } from '@/services/haptics';
import { openAgendaItem } from '@/services/open-agenda-item';
import { startAndOpenWorkout } from '@/services/start-workout';
import { usePendingDeletes } from '@/services/undo';

import { AppText } from './app-text';
import { Icon } from './icon';

const weekdayName = new Intl.DateTimeFormat('it-IT', { weekday: 'long' });

type WeekViewProps = {
  /** Monday to Sunday. */
  week: readonly DateKey[];
  today: DateKey;
  agenda: ReadonlyMap<DateKey, readonly AgendaItem[]>;
  calendar: CalendarData | undefined;
  types: ReadonlyMap<number, ActivityType>;
  onOpenDay: (date: DateKey) => void;
};

/**
 * A week day by day, each as a line of times: when the supplements were taken, when each workout
 * and activity took place or is planned, what was eaten and the weight. On top, the week in three
 * numbers, with the usual time of the workouts and of the supplements.
 */
export function WeekView({ week, today, agenda, calendar, types, onOpenDay }: WeekViewProps) {
  const pending = usePendingDeletes();
  const from = week[0];
  const to = week[week.length - 1];
  const { data } = useLiveQuery(
    `week-view:${from}`,
    async (database) => {
      const [active, all, ticks, totals, weights] = await Promise.all([
        getSupplements(database),
        getSupplements(database, { archived: true }),
        getDoseTicks(database, from, to),
        getDailyTotals(database, from, to),
        getWeightsSince(database, from),
      ]);
      return {
        active,
        names: new Map(all.map((s) => [s.id, s.name])),
        ticks,
        kcal: new Map(totals.map((t) => [t.date, t.kcal])),
        weights: new Map(weights.filter((w) => w.date <= to).map((w) => [w.date, w.kg])),
      };
    },
    ['calendar', 'food', 'body'],
  );

  const busy = busyDates(agenda);
  const gymTypeId = calendar?.gymTypeId ?? null;
  const ticksOn = (date: DateKey) => (data?.ticks ?? []).filter((t) => t.date === date);

  // The week in numbers, up to today.
  const past = week.filter((d) => d <= today);
  const workouts = workoutTimes(agenda, from, to < today ? to : today);
  const activities = past.reduce(
    (n, d) => n + (agenda.get(d) ?? []).filter((i) => i.kind === 'activity' && i.status === 'done' && i.occurrence.typeId !== gymTypeId).length,
    0,
  );
  let due = 0;
  let taken = 0;
  for (const date of past) {
    for (const s of data?.active ?? []) {
      const d = dosesDue(s, date, busy);
      if (d === 0) continue;
      due += d;
      taken += Math.min(d, ticksOn(date).filter((t) => t.supplementId === s.id).length);
    }
  }
  const workoutAt = averageClock(workouts);
  const supplementsAt = averageClock(tickTimes(data?.ticks ?? []));

  return (
    <View style={styles.root}>
      <View style={styles.tiles}>
        <Tile value={String(workouts.length)} label={workouts.length === 1 ? 'Allenamento' : 'Allenamenti'} detail={workoutAt ? `media ${workoutAt}` : null} />
        <Tile value={String(activities)} label="Attività" detail={null} />
        <Tile
          value={due > 0 ? `${Math.round((taken / due) * 100)}%` : '—'}
          label="Integratori"
          detail={supplementsAt ? `media ${supplementsAt}` : null}
        />
      </View>

      {week.map((date) => (
        <DayCard
          key={date}
          date={date}
          today={today}
          rows={buildTimeline(
            (agenda.get(date) ?? []).filter((i) => !isPendingDelete(i, pending)),
            ticksOn(date),
          )}
          missing={date <= today ? missingOn(data?.active ?? [], date, busy, ticksOn(date)) : []}
          names={data?.names ?? new Map()}
          kcal={data?.kcal.get(date) ?? null}
          kg={data?.weights.get(date) ?? null}
          types={types}
          gymTypeId={gymTypeId}
          dayNames={calendar?.dayNames ?? new Map()}
          onOpen={() => onOpenDay(date)}
        />
      ))}
    </View>
  );
}

/** The supplements due on a day and not all ticked. */
function missingOn(supplements: readonly Supplement[], date: DateKey, busy: ReadonlySet<DateKey>, ticks: readonly DoseTick[]): Supplement[] {
  return supplements.filter((s) => {
    const d = dosesDue(s, date, busy);
    return d > 0 && ticks.filter((t) => t.supplementId === s.id).length < d;
  });
}

function Tile({ value, label, detail }: { value: string; label: string; detail: string | null }) {
  const theme = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: theme.card }]}>
      <AppText variant="title2" numeric numberOfLines={1}>
        {value}
      </AppText>
      <AppText variant="footnote" weight="600" tone="textSecondary" numberOfLines={1}>
        {label}
      </AppText>
      <AppText variant="caption" tone="textSecondary" numeric numberOfLines={1}>
        {detail ?? ' '}
      </AppText>
    </View>
  );
}

type DayCardProps = {
  date: DateKey;
  today: DateKey;
  rows: TimelineRow[];
  missing: Supplement[];
  names: ReadonlyMap<number, string>;
  kcal: number | null;
  kg: number | null;
  types: ReadonlyMap<number, ActivityType>;
  gymTypeId: number | null;
  dayNames: ReadonlyMap<number, string>;
  onOpen: () => void;
};

function DayCard({ date, today, rows, missing, names, kcal, kg, types, gymTypeId, dayNames, onOpen }: DayCardProps) {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const colors = useActivityColors();
  const isToday = date === today;
  const near = Math.abs(daysBetween(today, date)) <= 1;
  const title = near ? formatDayTitle(date, today) : capitalize(weekdayName.format(fromDateKey(date)));
  const empty = rows.length === 0 && missing.length === 0;

  const lines: LineProps[] = rows.map((row) => {
    if (row.kind === 'doses') {
      return {
        key: row.key,
        time: row.time,
        color: colors.indigo,
        hollow: false,
        title: row.supplementIds.map((id) => names.get(id) ?? 'Integratore').join(', '),
        detail: row.time === null ? 'spuntati dopo' : null,
        onPress: onOpen,
      };
    }
    const item = row.item;
    const typeId = item.kind === 'workout' ? gymTypeId : item.occurrence.typeId;
    const type = typeId === null ? undefined : types.get(typeId);
    const color = type ? colors[type.color] : theme.accent;
    if (item.kind === 'workout') {
      const w = item.workout;
      const running = w.endedAt === null;
      return {
        key: row.key,
        time: row.time,
        color,
        hollow: false,
        title: w.name,
        detail: running
          ? 'in corso'
          : [formatWorkoutLength((new Date(w.endedAt ?? w.startedAt).getTime() - new Date(w.startedAt).getTime()) / 1000), countLabel(w.workSets, 'serie', 'serie')].join(' · '),
        trailing: running ? undefined : 'done',
        onPress: () => openAgendaItem(router, item),
      };
    }
    const isGym = item.occurrence.typeId === gymTypeId;
    const dayName = item.dayId === null ? null : (dayNames.get(item.dayId) ?? null);
    const minutes = itemMinutes(item, types);
    return {
      key: row.key,
      time: row.time,
      color,
      hollow: item.status === 'planned',
      faded: item.status === 'skipped',
      title: isGym ? (dayName ?? type?.name ?? 'Palestra') : (type?.name ?? 'Attività'),
      detail: item.status === 'skipped' ? 'saltata' : minutes > 0 ? formatMinutes(minutes) : null,
      trailing:
        item.status === 'done'
          ? 'done'
          : isGym && isToday && item.status === 'planned'
            ? { label: 'Inizia', onPress: () => void startAndOpenWorkout(db, router, item.dayId) }
            : undefined,
      onPress: () => openAgendaItem(router, item),
    };
  });
  if (missing.length > 0) {
    lines.push({
      key: 'missing',
      time: null,
      color: colors.indigo,
      hollow: true,
      faded: !isToday,
      title: missing.map((s) => s.name).join(', '),
      detail: isToday ? 'da prendere' : 'non presi',
      // Today they are ticked from here in one tap; another day opens it to tick them one by one.
      trailing: isToday
        ? {
            label: 'Presi',
            onPress: () =>
              void takeAllDoses(
                db,
                missing.map((s) => s.id),
                date,
              ).then(() => haptics.success()),
          }
        : undefined,
      onPress: onOpen,
    });
  }

  return (
    <View style={[styles.card, { backgroundColor: theme.card }, isToday && { borderColor: theme.accent, borderWidth: 1.5 }]}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${formatShortDate(date)}. Apri il giorno`}
        style={({ pressed }) => [styles.head, pressed && styles.pressed]}>
        <View style={[styles.badge, { backgroundColor: isToday ? theme.accent : theme.fill }]}>
          <AppText weight="700" numeric style={[styles.badgeText, { color: isToday ? theme.onAccent : theme.text }]}>
            {String(Number(date.slice(8)))}
          </AppText>
        </View>
        <AppText variant="headline" style={[styles.flex, isToday && { color: theme.accent }]} numberOfLines={1}>
          {title}
        </AppText>
        <Icon name="chevron.right" size={13} tone="textTertiary" weight="semibold" />
      </Pressable>

      {empty ? (
        <AppText variant="subhead" tone="textTertiary" style={styles.empty}>
          {date > today ? 'Niente in programma' : 'Riposo'}
        </AppText>
      ) : (
        <View style={styles.lines}>
          {lines.map(({ key, ...line }, i) => (
            <Line key={key} {...line} first={i === 0} last={i === lines.length - 1} />
          ))}
        </View>
      )}

      {kcal !== null || kg !== null ? (
        <View style={[styles.foot, { borderTopColor: theme.separator }]}>
          {kcal !== null ? (
            <View style={styles.footItem}>
              <Icon name="fork.knife" size={12} tone="textSecondary" />
              <AppText variant="footnote" tone="textSecondary" numeric>{`${formatKcal(kcal)} kcal`}</AppText>
            </View>
          ) : null}
          {kg !== null ? (
            <View style={styles.footItem}>
              <Icon name="scalemass" size={12} tone="textSecondary" />
              <AppText variant="footnote" tone="textSecondary" numeric>{`${formatNumber(kg, 1)} kg`}</AppText>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

type LineProps = {
  key: string;
  time: string | null;
  color: string;
  /** Still to do: a ring instead of a dot. */
  hollow: boolean;
  faded?: boolean;
  title: string;
  detail: string | null;
  trailing?: 'done' | { label: string; onPress: () => void };
  onPress: () => void;
};

/** One moment of the day: the time, a dot on the line of the day, what it was. */
function Line({ time, color, hollow, faded, title, detail, trailing, onPress, first, last }: Omit<LineProps, 'key'> & { first: boolean; last: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[time, title, detail].filter(Boolean).join(', ')}
      style={({ pressed }) => [styles.line, pressed && styles.pressed]}>
      <AppText variant="footnote" tone="textSecondary" numeric style={styles.time}>
        {time ?? ''}
      </AppText>
      <View style={styles.rail}>
        {!first ? <View style={[styles.railTop, { backgroundColor: theme.separator }]} /> : null}
        {!last ? <View style={[styles.railBottom, { backgroundColor: theme.separator }]} /> : null}
        <View style={[styles.dot, hollow ? { borderColor: color, borderWidth: 2, backgroundColor: theme.card } : { backgroundColor: color }]} />
      </View>
      <AppText numberOfLines={1} style={[styles.flex, faded && styles.faded]}>
        <AppText weight="600">{title}</AppText>
        {detail ? <AppText tone="textSecondary">{` · ${detail}`}</AppText> : null}
      </AppText>
      {trailing === 'done' ? (
        <Icon name="checkmark.circle.fill" size={18} tone="accent" />
      ) : trailing ? (
        <Pressable
          onPress={trailing.onPress}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${trailing.label}: ${title}`}
          style={({ pressed }) => [styles.action, { backgroundColor: theme.accent }, pressed && styles.pressed]}>
          <AppText variant="footnote" weight="700" style={{ color: theme.onAccent }}>
            {trailing.label}
          </AppText>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const DOT = 10;
const LINE = 40;
const TIME = 40;
const RAIL = 16;
/** Where the text of the lines starts, for what lines up under it. */
const TEXT = Spacing.lg + TIME + Spacing.sm + RAIL + Spacing.sm;

const styles = StyleSheet.create({
  root: { gap: Spacing.md },
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },
  faded: { opacity: 0.5 },
  tiles: { flexDirection: 'row', gap: Spacing.sm },
  tile: { flex: 1, padding: Spacing.md, borderRadius: Radius.lg, borderCurve: 'continuous', gap: 1 },
  card: { borderRadius: Radius.lg, borderCurve: 'continuous', paddingVertical: Spacing.sm, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.xs, minHeight: 48 },
  badge: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 16, lineHeight: 20 },
  empty: { paddingLeft: TEXT, paddingRight: Spacing.lg, paddingBottom: Spacing.sm },
  lines: { paddingBottom: Spacing.xs },
  line: { flexDirection: 'row', alignItems: 'center', minHeight: LINE, paddingHorizontal: Spacing.lg, gap: Spacing.sm },
  time: { width: TIME, textAlign: 'right' },
  rail: { width: RAIL, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  railTop: { position: 'absolute', top: 0, height: '50%', width: 2 },
  railBottom: { position: 'absolute', bottom: 0, height: '50%', width: 2 },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  action: { minHeight: 28, paddingHorizontal: Spacing.md, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  foot: {
    flexDirection: 'row',
    gap: Spacing.lg,
    marginTop: Spacing.xs,
    paddingTop: Spacing.sm,
    paddingLeft: TEXT,
    paddingRight: Spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
