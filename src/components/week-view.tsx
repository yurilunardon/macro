import type { SymbolViewProps } from 'expo-symbols';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { getWeightsSince } from '@/db/body';
import type { CalendarData } from '@/db/calendar';
import { getDailyTotals } from '@/db/entries';
import { useLiveQuery } from '@/db/live';
import { getDoseTicks, getSupplements } from '@/db/supplements';
import { useActivityColors } from '@/hooks/use-activity-colors';
import { useClock } from '@/hooks/use-clock';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { busyDates, isPendingDelete, itemMinutes, type ActivityType, type AgendaItem } from '@/lib/calendar';
import { formatLongDate, formatWeekdayInitial, type DateKey } from '@/lib/dates';
import { formatKcal, formatNumber } from '@/lib/format';
import { dosesDue } from '@/lib/supplements';
import { averageClock, buildTimeline, clockOf, tickTimes, workoutTimes } from '@/lib/timeline';
import { hourRange, minutesOfClock, placeInLanes, type Span } from '@/lib/week-layout';
import { openAgendaItem } from '@/services/open-agenda-item';
import { usePendingDeletes } from '@/services/undo';

import { AppText } from './app-text';
import { Icon } from './icon';

/** Height of an hour in the grid, and the column of the hours on the left. */
const HOUR = 34;
const GUTTER = 30;
/** A block never gets shorter than this, so its name fits. */
const MIN_BLOCK = 22;
const PAD = Spacing.sm;
const DOSE = 16;

type WeekViewProps = {
  /** Monday to Sunday. */
  week: readonly DateKey[];
  today: DateKey;
  agenda: ReadonlyMap<DateKey, readonly AgendaItem[]>;
  calendar: CalendarData | undefined;
  types: ReadonlyMap<number, ActivityType>;
  onOpenDay: (date: DateKey) => void;
};

type Block = Span & {
  key: string;
  item: AgendaItem;
  color: string;
  title: string;
  symbol: string | undefined;
  planned: boolean;
  skipped: boolean;
};

function clockText(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * The week as in Calendar: a column per day and the hours down the side, each workout and
 * activity a block at its time and as long as it lasted, a dot where supplements were ticked, and
 * a red line at the time now. Under the grid, a line per day for the supplements, the calories and
 * the weight; then the week's usual times.
 */
export function WeekView({ week, today, agenda, calendar, types, onOpenDay }: WeekViewProps) {
  const router = useRouter();
  const theme = useTheme();
  const scheme = useColorScheme();
  const colors = useActivityColors();
  const pending = usePendingDeletes();
  const { width: screen } = useWindowDimensions();
  const clock = new Date(useClock(60_000));
  const from = week[0];
  const to = week[6];

  const { data } = useLiveQuery(
    `week-view:${from}`,
    async (database) => {
      const [active, ticks, totals, weights] = await Promise.all([
        getSupplements(database),
        getDoseTicks(database, from, to),
        getDailyTotals(database, from, to),
        getWeightsSince(database, from),
      ]);
      return {
        active,
        ticks,
        kcal: new Map(totals.map((t) => [t.date, t.kcal])),
        weights: new Map(weights.filter((w) => w.date <= to).map((w) => [w.date, w.kg])),
      };
    },
    ['calendar', 'food', 'body'],
  );

  const gymTypeId = calendar?.gymTypeId ?? null;
  const busy = busyDates(agenda);
  const ticksOn = (date: DateKey) => (data?.ticks ?? []).filter((t) => t.date === date);
  // Translucent fills, as Calendar's events; lighter while still to do.
  const fill = (color: string, done: boolean) => `${color}${scheme === 'dark' ? (done ? '59' : '26') : done ? '3D' : '17'}`;
  const nowMinutes = clock.getHours() * 60 + clock.getMinutes();

  // What each day holds: blocks at a time, chips for what has none, dots for the supplements.
  const days = week.map((date) => {
    const items = (agenda.get(date) ?? []).filter((i) => !isPendingDelete(i, pending));
    const blocks: Block[] = [];
    const allDay: Block[] = [];
    for (const item of items) {
      const typeId = item.kind === 'workout' ? gymTypeId : item.occurrence.typeId;
      const type = typeId === null ? undefined : types.get(typeId);
      const isGym = typeId === gymTypeId;
      const dayName = item.kind === 'activity' && item.dayId !== null ? (calendar?.dayNames.get(item.dayId) ?? null) : null;
      const base = {
        key: item.key,
        item,
        color: type ? colors[type.color] : theme.accent,
        title: item.kind === 'workout' ? item.workout.name : isGym ? (dayName ?? type?.name ?? 'Palestra') : (type?.name ?? 'Attività'),
        symbol: type?.symbol,
        planned: item.kind === 'activity' && item.status === 'planned',
        skipped: item.kind === 'activity' && item.status === 'skipped',
      };
      if (item.kind === 'workout') {
        const start = minutesOfClock(clockOf(item.workout.startedAt));
        // Running: down to now.
        const end = item.workout.endedAt ? minutesOfClock(clockOf(item.workout.endedAt)) : date === today ? nowMinutes : start + 60;
        blocks.push({ ...base, start, end: end > start ? end : 24 * 60 });
      } else if (item.occurrence.time) {
        const start = minutesOfClock(item.occurrence.time);
        blocks.push({ ...base, start, end: Math.min(24 * 60, start + (itemMinutes(item, types) || 60)) });
      } else {
        allDay.push({ ...base, start: 0, end: 0 });
      }
    }
    const doses = buildTimeline([], ticksOn(date)).flatMap((r) =>
      r.kind === 'doses' && r.time !== null ? [{ time: minutesOfClock(r.time), count: r.supplementIds.length }] : [],
    );
    let due = 0;
    let taken = 0;
    if (date <= today) {
      for (const s of data?.active ?? []) {
        const d = dosesDue(s, date, busy);
        if (d === 0) continue;
        due += d;
        taken += Math.min(d, ticksOn(date).filter((t) => t.supplementId === s.id).length);
      }
    }
    return { date, blocks: placeInLanes(blocks), allDay, doses, due, taken };
  });

  const range = hourRange([
    ...days.flatMap((d) => d.blocks),
    ...days.flatMap((d) => d.doses.map((x) => ({ start: x.time, end: x.time + 15 }))),
    ...(week.includes(today) ? [{ start: nowMinutes, end: nowMinutes }] : []),
  ]);
  const y = (minutes: number) => ((minutes - range.from * 60) / 60) * HOUR;
  const hours = Array.from({ length: range.to - range.from + 1 }, (_, i) => range.from + i);
  const gridWidth = Math.min(screen, MaxContentWidth) - 2 * Spacing.lg - 2 * PAD;
  const column = (gridWidth - GUTTER) / 7;
  const hasAllDay = days.some((d) => d.allDay.length > 0);

  const workouts = workoutTimes(agenda, from, to < today ? to : today);
  const workoutAt = averageClock(workouts);
  const supplementsAt = averageClock(tickTimes(data?.ticks ?? []));
  const due = days.reduce((n, d) => n + d.due, 0);
  const taken = days.reduce((n, d) => n + d.taken, 0);
  const activities = days.reduce(
    (n, d) => n + (agenda.get(d.date) ?? []).filter((i) => i.kind === 'activity' && i.status === 'done' && i.occurrence.typeId !== gymTypeId).length,
    0,
  );

  return (
    <View style={styles.root}>
      <View style={[styles.card, { backgroundColor: theme.card }]}>
        {/* The days, as in Calendar: the initial and the date, today in a green circle. */}
        <View style={styles.row}>
          <View style={{ width: GUTTER }} />
          {week.map((date) => {
            const isToday = date === today;
            return (
              <Pressable
                key={date}
                onPress={() => onOpenDay(date)}
                accessibilityRole="button"
                accessibilityLabel={`${formatLongDate(date)}. Apri il giorno`}
                style={({ pressed }) => [styles.dayHead, { width: column }, pressed && styles.pressed]}>
                <AppText variant="caption" weight="600" tone={isToday ? 'accent' : 'textSecondary'}>
                  {formatWeekdayInitial(date)}
                </AppText>
                <View style={[styles.dateCircle, isToday && { backgroundColor: theme.accent }]}>
                  <AppText weight={isToday ? '700' : '500'} numeric style={[styles.dateText, { color: isToday ? theme.onAccent : theme.text }]}>
                    {String(Number(date.slice(8)))}
                  </AppText>
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Activities without a time, as all-day events. */}
        {hasAllDay ? (
          <View style={[styles.row, styles.allDayRow, { borderColor: theme.separator }]}>
            <View style={{ width: GUTTER }} />
            {days.map((d) => (
              <View key={d.date} style={[styles.allDayCell, { width: column }]}>
                {d.allDay.map((b) => (
                  <Pressable
                    key={b.key}
                    onPress={() => openAgendaItem(router, b.item)}
                    accessibilityRole="button"
                    accessibilityLabel={b.title}
                    style={[
                      styles.chip,
                      { backgroundColor: fill(b.color, !b.planned) },
                      b.planned && [styles.planned, { borderColor: b.color }],
                      b.skipped && styles.skipped,
                    ]}>
                    <AppText numberOfLines={1} style={[styles.blockTitle, { color: theme.text }]}>
                      {b.title}
                    </AppText>
                  </Pressable>
                ))}
              </View>
            ))}
          </View>
        ) : null}

        {/* The hours: a line at each, the days side by side. */}
        <View style={[styles.grid, { height: (range.to - range.from) * HOUR }]}>
          {hours.map((h) => (
            <View key={h} pointerEvents="none" style={[styles.hourRow, { top: y(h * 60) }]}>
              <AppText variant="caption" tone="textTertiary" numeric style={styles.hourLabel}>
                {String(h % 24).padStart(2, '0')}
              </AppText>
              <View style={[styles.hourLine, { backgroundColor: theme.separator }]} />
            </View>
          ))}
          {/* Today's column a shade of green, the others split by a hairline. */}
          {week.map((date, i) =>
            date === today ? (
              <View key={`t${date}`} pointerEvents="none" style={[styles.todayColumn, { left: GUTTER + i * column, width: column, backgroundColor: `${theme.accent}12` }]} />
            ) : null,
          )}
          {week.map((date, i) =>
            i > 0 ? <View key={date} pointerEvents="none" style={[styles.dayLine, { left: GUTTER + i * column, backgroundColor: theme.separator }]} /> : null,
          )}

          {days.map((d, i) => (
            <View key={d.date} pointerEvents="box-none" style={[styles.dayColumn, { left: GUTTER + i * column, width: column }]}>
              {d.blocks.map((b) => {
                const top = y(b.start);
                const height = Math.max(MIN_BLOCK, y(b.end) - top);
                const laneWidth = (column - 3) / b.lanes;
                return (
                  <Pressable
                    key={b.key}
                    onPress={() => openAgendaItem(router, b.item)}
                    accessibilityRole="button"
                    accessibilityLabel={`${b.title}, ${clockText(b.start)}`}
                    style={[
                      styles.block,
                      { top, height, left: 1.5 + b.lane * laneWidth, width: laneWidth - 1, backgroundColor: fill(b.color, !b.planned), borderLeftColor: b.color },
                      b.planned && [styles.planned, { borderColor: b.color }],
                      b.skipped && styles.skipped,
                    ]}>
                    {height >= 36 && b.symbol ? <Icon name={b.symbol as SymbolViewProps['name']} size={11} color={b.color} weight="semibold" /> : null}
                    <AppText numberOfLines={height >= 52 ? 2 : 1} style={[styles.blockTitle, { color: theme.text }]}>
                      {b.title}
                    </AppText>
                  </Pressable>
                );
              })}
              {/* The supplements ticked, at their time, on the right edge. */}
              {d.doses.map((x) => (
                <Pressable
                  key={x.time}
                  onPress={() => onOpenDay(d.date)}
                  accessibilityRole="button"
                  accessibilityLabel={`${x.count === 1 ? 'Un integratore' : `${x.count} integratori`} alle ${clockText(x.time)}`}
                  style={[styles.dose, { top: y(x.time) - DOSE / 2, backgroundColor: colors.indigo, borderColor: theme.card }]}>
                  <AppText weight="700" numeric style={styles.doseText}>
                    {String(x.count)}
                  </AppText>
                </Pressable>
              ))}
              {d.date === today && nowMinutes >= range.from * 60 && nowMinutes <= range.to * 60 ? (
                <View pointerEvents="none" style={[styles.now, { top: y(nowMinutes) - 1, backgroundColor: theme.danger }]}>
                  <View style={[styles.nowDot, { backgroundColor: theme.danger }]} />
                </View>
              ) : null}
            </View>
          ))}
        </View>

        {/* Each day's supplements, calories and weight, under its column. */}
        <View style={[styles.facts, { borderColor: theme.separator }]}>
          <FactRow symbol="pills.fill" color={colors.indigo} label="Integratori presi" column={column}>
            {days.map((d) =>
              d.due > 0 ? (
                <AppText key={d.date} variant="caption" weight="600" numeric style={{ color: d.taken >= d.due ? theme.accent : theme.warning }}>
                  {`${d.taken}/${d.due}`}
                </AppText>
              ) : (
                <AppText key={d.date} variant="caption" tone="textTertiary">
                  –
                </AppText>
              ),
            )}
          </FactRow>
          <FactRow symbol="fork.knife" color={colors.orange} label="Calorie" column={column}>
            {days.map((d) => (
              <AppText key={d.date} variant="caption" tone={data?.kcal.has(d.date) ? 'textSecondary' : 'textTertiary'} numeric numberOfLines={1}>
                {data?.kcal.has(d.date) ? formatKcal(data.kcal.get(d.date) ?? 0) : '–'}
              </AppText>
            ))}
          </FactRow>
          <FactRow symbol="scalemass.fill" color={colors.blue} label="Peso" column={column}>
            {days.map((d) => (
              <AppText key={d.date} variant="caption" tone={data?.weights.has(d.date) ? 'textSecondary' : 'textTertiary'} numeric numberOfLines={1}>
                {data?.weights.has(d.date) ? formatNumber(data.weights.get(d.date) ?? 0, 1) : '–'}
              </AppText>
            ))}
          </FactRow>
        </View>
      </View>

      {/* The week in three numbers, with the usual times. */}
      <View style={styles.tiles}>
        <Tile value={String(workouts.length)} label="Palestra" detail={workoutAt ? `media ${workoutAt}` : null} />
        <Tile value={String(activities)} label="Attività" detail={null} />
        <Tile value={due > 0 ? `${Math.round((taken / due) * 100)}%` : '—'} label="Integratori" detail={supplementsAt ? `media ${supplementsAt}` : null} />
      </View>
    </View>
  );
}

/** A line of facts under the grid: a symbol in the hours' column, a value under each day. */
function FactRow({ symbol, color, label, column, children }: { symbol: SymbolViewProps['name']; color: string; label: string; column: number; children: ReactNode[] }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={label}>
      <View style={[styles.factIcon, { width: GUTTER }]}>
        <Icon name={symbol} size={13} color={color} />
      </View>
      {children.map((child, i) => (
        <View key={i} style={[styles.factCell, { width: column }]}>
          {child}
        </View>
      ))}
    </View>
  );
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

const styles = StyleSheet.create({
  root: { gap: Spacing.md },
  card: { borderRadius: Radius.lg, borderCurve: 'continuous', padding: PAD, paddingTop: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center' },
  pressed: { opacity: 0.6 },
  dayHead: { alignItems: 'center', gap: 2 },
  dateCircle: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  dateText: { fontSize: 16, lineHeight: 20 },
  allDayRow: { marginTop: Spacing.sm, paddingTop: Spacing.xs, alignItems: 'flex-start', borderTopWidth: StyleSheet.hairlineWidth },
  allDayCell: { paddingHorizontal: 1.5, gap: 2 },
  chip: { height: 20, borderRadius: 5, paddingHorizontal: 3, justifyContent: 'center' },
  grid: { marginTop: Spacing.md },
  hourRow: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', height: 14, marginTop: -7 },
  hourLabel: { width: GUTTER - 4, fontSize: 10, lineHeight: 14 },
  hourLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dayLine: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth },
  dayColumn: { position: 'absolute', top: 0, bottom: 0 },
  todayColumn: { position: 'absolute', top: 0, bottom: 0 },
  block: { position: 'absolute', borderRadius: 5, borderLeftWidth: 3, paddingHorizontal: 3, paddingVertical: 2, overflow: 'hidden', gap: 1 },
  planned: { borderWidth: 1, borderStyle: 'dashed' },
  skipped: { opacity: 0.4 },
  blockTitle: { fontSize: 10, lineHeight: 12, fontWeight: '600' },
  dose: { position: 'absolute', right: 1, width: DOSE, height: DOSE, borderRadius: DOSE / 2, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  doseText: { fontSize: 9, lineHeight: 11, color: '#FFFFFF' },
  now: { position: 'absolute', left: 0, right: 0, height: 2 },
  nowDot: { position: 'absolute', left: -4, top: -3, width: 8, height: 8, borderRadius: 4 },
  facts: { marginTop: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, gap: Spacing.sm },
  factIcon: { alignItems: 'flex-start', paddingLeft: 2 },
  factCell: { alignItems: 'center' },
  tiles: { flexDirection: 'row', gap: Spacing.sm },
  tile: { flex: 1, padding: Spacing.md, borderRadius: Radius.lg, borderCurve: 'continuous', gap: 1 },
});
