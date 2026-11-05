import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, useColorScheme, useWindowDimensions, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Spacing } from '@/constants/theme';
import { moveOccurrence } from '@/db/calendar';
import { setDoseTaken } from '@/db/supplements';
import { useActivityColors } from '@/hooks/use-activity-colors';
import { useClock } from '@/hooks/use-clock';
import { useDayPlan } from '@/hooks/use-day-plan';
import { useFrozen } from '@/hooks/use-frozen';
import { useTheme } from '@/hooks/use-theme';
import { describeVolley, volleyInTheWay, workSpan, type AgendaItem } from '@/lib/calendar';
import { formatDaySubtitle, formatDayTitle, type DateKey } from '@/lib/dates';
import { clockOfMinutes, firstHourFor, GUTTER, gridHeight, HOUR_HEIGHT, placeBlocks, SNAP_MINUTES, yOfMinute, type Placed } from '@/lib/day-grid';
import { formatNumber } from '@/lib/format';
import { addMinutes, clockOf, isoAt, type DayEntry } from '@/lib/plan';
import { formatDose } from '@/lib/supplements';
import { minutesOfClock } from '@/lib/week-layout';
import { calendarDrag, dayLayouts, useDraftOn, useLiftedKey, useSelectedKey, type DayBlock } from '@/services/calendar-drag';
import { haptics } from '@/services/haptics';
import { openAgendaItem } from '@/services/open-agenda-item';
import { useWorkoutStarting } from '@/services/start-workout';

import { AppText } from './app-text';
import type { DayPageProps } from './day-pager';
import { Icon } from './icon';
import { activityName, DayRing } from './plan-day';
import { toast } from './toast';

const FADE_IN = FadeIn.duration(180);
/** Where a block goes when it moves in its day, e.g. ticked at another time. */
const BLOCK_MOVE = LinearTransition.duration(260);
const HEADING = 72;

/** The colours of a block, as in Calendar: a tint with a bar, or filled when picked up. */
export function blockTone(color: string, scheme: 'light' | 'dark' | null | undefined): { fill: string; bar: string; ink: string; solid: string; onSolid: string } {
  const channel = (i: number) => parseInt(color.slice(i, i + 2), 16);
  const mix = (toward: number, amount: number) =>
    `#${[1, 3, 5]
      .map((i) =>
        Math.round(channel(i) + (toward - channel(i)) * amount)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`;
  const luminance = (0.299 * channel(1) + 0.587 * channel(3) + 0.114 * channel(5)) / 255;
  return {
    fill: `${color}${scheme === 'dark' ? '40' : '2E'}`,
    bar: color,
    // Against its own tint the plain hue is hard to read: lighter on dark, deeper on light.
    ink: scheme === 'dark' ? mix(255, 0.45) : mix(0, 0.5),
    solid: color,
    onSolid: luminance > 0.55 ? '#000000' : '#FFFFFF',
  };
}

/**
 * One day of the calendar, a page of the pager as in the food diary: its title and how much of it
 * is done, then the hours at their true scale, as in Calendar. Touching and holding is handled above
 * the pages (see calendar-drag); here a tap on a block opens it, and its circle ticks it.
 */
export const CalendarDay = memo(function CalendarDay({ date, today, onReady }: { date: DateKey; today: DateKey } & DayPageProps) {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const colors = useActivityColors();
  const scheme = useColorScheme();
  const { width: windowWidth } = useWindowDimensions();
  const now = clockOf(new Date(useClock(60_000)).toISOString());
  // As a workout starts the page stays as it was; under its sheet the queries wait by themselves.
  const starting = useWorkoutStarting();
  const plan = useFrozen(useDayPlan(date, today), starting);
  const gymTypeId = plan.calendar?.gymTypeId ?? null;
  const dayNames = plan.calendar?.dayNames;
  const lifted = useLiftedKey(date);
  const selected = useSelectedKey(date);
  const draft = useDraftOn(date);

  const { ready } = plan;
  useEffect(() => {
    if (ready) onReady(date);
  }, [ready, date, onReady]);

  // A tick shows at once, before the database has it: what the tap set, as long as the stored
  // state is still the one it was tapped from.
  const [ticks, setTicks] = useState<Map<string, { done: boolean; from: boolean; at: string }>>(new Map());

  const width = windowWidth - Spacing.lg * 2 - GUTTER;
  const { blocks, firstHour } = useMemo(() => {
    const list: DayBlock[] = [];
    for (const item of plan.items) {
      const block = itemBlock(item, plan.types, gymTypeId, dayNames ?? new Map(), colors);
      if (block) list.push(block);
    }
    for (const stored of plan.entries) {
      const tick = ticks.get(stored.key);
      const entry: DayEntry = tick && tick.from === stored.done && stored.kind === 'supplement' ? { ...stored, done: tick.done, takenAt: tick.done ? tick.at : null, at: tick.done ? (date === today ? clockOf(tick.at) : stored.planned) : stored.planned } : stored;
      list.push(entryBlock(entry, colors));
    }
    const first = firstHourFor(list.map((b) => b.start));
    return { blocks: placeBlocks(list, first, width), firstHour: first };
  }, [plan.items, plan.entries, plan.types, gymTypeId, dayNames, colors, ticks, width, date, today]);

  // What is under a finger is told by the drag, above the pages, from here.
  const grid = useRef<ComponentRef<typeof View>>(null);
  useEffect(() => {
    dayLayouts.set(date, { firstHour, blocks, grid });
    return () => {
      dayLayouts.delete(date);
    };
  }, [date, firstHour, blocks]);

  const main = plan.items.find((i) => i.kind === 'workout' || i.status !== 'skipped');
  const subtitle = [formatDaySubtitle(date, today), ready ? (main ? activityName(main, plan.types, gymTypeId, dayNames ?? new Map()) : 'Riposo') : null]
    .filter(Boolean)
    .join(' · ');

  const open = (block: DayBlock) => {
    if (calendarDrag.justDropped()) return;
    if (block.item?.kind === 'workout') {
      openAgendaItem(router, block.item);
      return;
    }
    router.push({ pathname: '/calendar-item', params: { date, key: block.key } });
  };

  const tick = (entry: DayEntry) => {
    if (entry.kind !== 'supplement' || calendarDrag.justDropped()) return;
    const done = !entry.done;
    const at = date === today ? new Date().toISOString() : isoAt(date, entry.planned);
    setTicks(new Map(ticks).set(entry.key, { done, from: plan.entries.find((e) => e.key === entry.key)?.done ?? entry.done, at }));
    // The last thing of the day gets the success tap; every other tick the light one.
    if (done && plan.progress.done + 1 === plan.progress.total) haptics.success();
    else haptics.selection();
    void setDoseTaken(db, entry.supplement.id, date, entry.index, done, done ? at : undefined);
  };

  /** The block's length changed by its grab points: this time only. */
  const resize = async (block: DayBlock, start: number, minutes: number) => {
    const item = block.item;
    if (item?.kind !== 'activity') return;
    const kinds = plan.calendar?.kinds;
    const volley = kinds && item.occurrence.typeId === kinds.gym ? volleyInTheWay(plan.items, kinds, start, minutes, block.key) : null;
    if (volley) {
      haptics.warning();
      toast.show(describeVolley(date, volley), 'exclamationmark.triangle.fill');
      return;
    }
    const undo = await moveOccurrence(db, item.occurrence, { date, time: clockOfMinutes(start), minutes });
    toast.show(`${block.name}, ${clockOfMinutes(start)} – ${addMinutes(clockOfMinutes(start), minutes)}`, 'checkmark.circle.fill', { label: 'Annulla', onPress: () => void undo() });
  };

  const span = plan.workHours ? workSpan(plan.workHours, date) : null;
  const nowMinute = date === today ? minutesOfClock(now) : null;

  return (
    <View>
      <View style={styles.heading}>
        <View style={styles.flex}>
          <AppText variant="title" numberOfLines={1} adjustsFontSizeToFit>
            {formatDayTitle(date, today)}
          </AppText>
          <AppText variant="subhead" tone="textSecondary" numberOfLines={1}>
            {subtitle}
          </AppText>
        </View>
        {plan.progress.total > 0 ? <DayRing done={plan.progress.done} total={plan.progress.total} /> : null}
      </View>

      <View ref={grid} collapsable={false} style={{ height: gridHeight(firstHour) }}>
        {selected ? <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={() => calendarDrag.set({ selected: null })} /> : null}
        {span ? (
          <View pointerEvents="none" style={[styles.work, { top: yOfMinute(span.from, firstHour), height: yOfMinute(span.to, firstHour) - yOfMinute(span.from, firstHour), left: GUTTER, backgroundColor: theme.fill }]}>
            <AppText variant="caption" tone="textSecondary" style={styles.workLabel}>
              Lavoro
            </AppText>
          </View>
        ) : null}
        <Hours firstHour={firstHour} />

        {ready ? (
          <Animated.View entering={FADE_IN} pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            {blocks.map((block) =>
              block.key === lifted ? null : (
                <Block
                  key={block.key}
                  block={block}
                  scheme={scheme}
                  picked={block.key === selected}
                  onOpen={open}
                  onTick={tick}
                  onResize={resize}
                />
              ),
            )}
          </Animated.View>
        ) : null}

        {draft ? <Draft minute={draft.minute} minutes={draft.minutes} firstHour={firstHour} color={theme.accent} scheme={scheme} /> : null}

        {nowMinute !== null ? (
          <View pointerEvents="none" style={[styles.now, { top: yOfMinute(nowMinute, firstHour) }]}>
            <AppText variant="caption" weight="700" numeric style={[styles.nowLabel, { color: theme.danger, backgroundColor: theme.background }]}>
              {now}
            </AppText>
            <View style={[styles.nowDot, { backgroundColor: theme.danger }]} />
            <View style={[styles.nowLine, { backgroundColor: theme.danger }]} />
          </View>
        ) : null}
      </View>
    </View>
  );
});

function itemBlock(item: AgendaItem, types: ReadonlyMap<number, { color: keyof ReturnType<typeof useActivityColors>; minutes: number | null }>, gymTypeId: number | null, dayNames: ReadonlyMap<number, string>, colors: ReturnType<typeof useActivityColors>): DayBlock | null {
  const name = activityName(item, types as never, gymTypeId, dayNames);
  if (item.kind === 'workout') {
    const start = minutesOfClock(clockOf(item.workout.startedAt));
    const type = gymTypeId === null ? undefined : types.get(gymTypeId);
    const end = item.workout.endedAt ? minutesOfClock(clockOf(item.workout.endedAt)) : start + 60;
    return {
      key: item.key,
      name,
      sub: item.workout.endedAt ? `${clockOf(item.workout.startedAt)} – ${clockOf(item.workout.endedAt)}` : `In corso dalle ${clockOf(item.workout.startedAt)}`,
      start,
      minutes: Math.max(15, end - start),
      color: colors[type?.color ?? 'green'],
      item,
      entry: null,
      done: item.workout.endedAt !== null,
      skipped: false,
    };
  }
  const o = item.occurrence;
  // One with no time goes where the evening's usually do: it can then be moved to its own.
  const time = o.time ?? '21:00';
  const minutes = o.minutes ?? types.get(o.typeId)?.minutes ?? 60;
  const type = types.get(o.typeId);
  const span = o.time ? `${o.time} – ${addMinutes(o.time, minutes)}` : 'Senza ora';
  return {
    key: item.key,
    name,
    sub: [span, o.location?.split(',')[0]].filter(Boolean).join(' · '),
    start: minutesOfClock(time),
    minutes,
    color: colors[type?.color ?? 'green'],
    item,
    entry: null,
    done: item.status === 'done',
    skipped: item.status === 'skipped',
  };
}

function entryBlock(entry: DayEntry, colors: ReturnType<typeof useActivityColors>): DayBlock {
  if (entry.kind === 'weighIn') {
    return {
      key: entry.key,
      name: entry.kg !== null ? `Pesata · ${formatNumber(entry.kg, 1)} kg` : 'Pesata',
      sub: null,
      start: minutesOfClock(entry.at),
      minutes: 0,
      color: colors.teal,
      item: null,
      entry,
      done: entry.done,
      skipped: false,
    };
  }
  const s = entry.supplement;
  return {
    key: entry.key,
    name: s.name,
    sub: formatDose(s.dose, s.unit),
    start: minutesOfClock(entry.at),
    minutes: 0,
    color: colors.indigo,
    item: null,
    entry,
    done: entry.done,
    skipped: entry.skipped,
  };
}

const Hours = memo(function Hours({ firstHour }: { firstHour: number }) {
  const theme = useTheme();
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Array.from({ length: 24 - firstHour }, (_, i) => (
        <View key={i} style={[styles.hour, { top: i * HOUR_HEIGHT }]}>
          <AppText variant="caption" tone="textSecondary" numeric style={styles.hourLabel}>
            {`${String(firstHour + i).padStart(2, '0')}:00`}
          </AppText>
          <View style={[styles.hourLine, { backgroundColor: theme.separator }]} />
        </View>
      ))}
    </View>
  );
});

function Block({
  block,
  scheme,
  picked,
  onOpen,
  onTick,
  onResize,
}: {
  block: Placed<DayBlock>;
  scheme: 'light' | 'dark' | null | undefined;
  picked: boolean;
  onOpen: (block: DayBlock) => void;
  onTick: (entry: DayEntry) => void;
  onResize: (block: DayBlock, start: number, minutes: number) => void;
}) {
  const tone = blockTone(block.color, scheme);
  // While its grab points are dragged it is drawn at the new length, then the day takes over.
  const [resizing, setResizing] = useState<{ start: number; minutes: number } | null>(null);
  const start = resizing?.start ?? block.start;
  const minutes = resizing?.minutes ?? block.minutes;
  const top = resizing ? block.top + ((start - block.start) / 60) * HOUR_HEIGHT : block.top;
  const height = resizing ? Math.max(HOUR_HEIGHT / 2, (minutes / 60) * HOUR_HEIGHT) - 2 : block.height;
  const showSub = block.sub !== null && (height >= 42 || block.entry?.kind === 'supplement');
  const ink = picked ? tone.onSolid : tone.ink;
  const strike = block.skipped;
  const line = (
    <View style={[styles.blockText, showSub && height >= 42 ? styles.blockTextTop : null]}>
      <AppText numberOfLines={1} style={[styles.blockName, { color: ink }, strike && styles.strike]}>
        {block.name}
      </AppText>
      {showSub && height >= 42 ? (
        <AppText numberOfLines={1} style={[styles.blockSub, { color: ink }]}>
          {block.sub}
        </AppText>
      ) : null}
    </View>
  );
  const entry = block.entry;
  const canResize = block.item?.kind === 'activity';
  return (
    <Animated.View
      layout={BLOCK_MOVE}
      style={[styles.block, { top, left: GUTTER + block.left, width: block.width, height, backgroundColor: picked ? tone.solid : tone.fill, opacity: block.done || block.skipped ? 0.65 : 1, zIndex: picked ? 3 : 1 }]}>
      <View style={[styles.blockBar, { backgroundColor: tone.bar }]} />
      <Pressable
        onPress={() => onOpen(block)}
        accessibilityRole="button"
        accessibilityLabel={[block.name, block.sub, clockOfMinutes(block.start), block.done ? 'fatto' : null].filter(Boolean).join(', ')}
        style={styles.blockBody}>
        {entry?.kind === 'supplement' ? (
          <Pressable
            onPress={() => onTick(entry)}
            hitSlop={8}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: entry.done }}
            accessibilityLabel={`Segna ${block.name}`}
            style={[styles.circle, { borderColor: entry.done ? tone.bar : ink, backgroundColor: entry.done ? tone.bar : 'transparent' }]}>
            {entry.done ? <Icon name="checkmark" size={10} color={tone.onSolid} weight="bold" /> : null}
          </Pressable>
        ) : block.done ? (
          <Icon name="checkmark.circle.fill" size={16} color={tone.bar} />
        ) : null}
        {line}
      </Pressable>
      {picked && canResize ? (
        <>
          <GrabPoint color={tone.bar} side="start" block={block} onChange={setResizing} onDone={onResize} />
          <GrabPoint color={tone.bar} side="end" block={block} onChange={setResizing} onDone={onResize} />
        </>
      ) : null}
    </Animated.View>
  );
}

/** One of the two points to pull on what was picked up, as in Calendar: top right and bottom left. */
function GrabPoint({
  color,
  side,
  block,
  onChange,
  onDone,
}: {
  color: string;
  side: 'start' | 'end';
  block: DayBlock;
  onChange: (next: { start: number; minutes: number } | null) => void;
  onDone: (block: DayBlock, start: number, minutes: number) => void;
}) {
  const steps = useRef(0);
  const shape = (quarters: number) => {
    const moved = quarters * SNAP_MINUTES;
    if (side === 'end') return { start: block.start, minutes: Math.max(SNAP_MINUTES, block.minutes + moved) };
    const start = Math.min(block.start + block.minutes - SNAP_MINUTES, block.start + moved);
    return { start, minutes: block.start + block.minutes - start };
  };
  const step = (quarters: number) => {
    if (quarters === steps.current) return;
    steps.current = quarters;
    haptics.selection();
    onChange(shape(quarters));
  };
  const finish = () => {
    calendarDrag.markDropped();
    const next = shape(steps.current);
    const moved = steps.current !== 0;
    steps.current = 0;
    onChange(null);
    if (moved) onDone(block, next.start, next.minutes);
  };
  const pan = usePanGesture({
    minDistance: 0,
    onUpdate: (event) => {
      'worklet';
      scheduleOnRN(step, Math.round((event.translationY / HOUR_HEIGHT) * 4));
    },
    onDeactivate: () => {
      'worklet';
      scheduleOnRN(finish);
    },
  });
  return (
    <GestureDetector gesture={pan}>
      <View style={[styles.grab, side === 'start' ? styles.grabStart : styles.grabEnd]} accessibilityElementsHidden>
        <View style={[styles.grabDot, { borderColor: color }]} />
      </View>
    </GestureDetector>
  );
}

function Draft({ minute, minutes, firstHour, color, scheme }: { minute: number; minutes: number; firstHour: number; color: string; scheme: 'light' | 'dark' | null | undefined }) {
  const tone = blockTone(color, scheme);
  return (
    <Animated.View
      layout={BLOCK_MOVE}
      pointerEvents="none"
      style={[styles.block, { top: yOfMinute(minute, firstHour) + 1, left: GUTTER, right: 0, height: (minutes / 60) * HOUR_HEIGHT - 2, backgroundColor: tone.solid, zIndex: 4 }]}>
      <View style={styles.blockBody}>
        <View style={[styles.blockText, styles.blockTextTop]}>
          <AppText numberOfLines={1} style={[styles.blockName, { color: tone.onSolid }]}>
            Nuovo
          </AppText>
          <AppText numberOfLines={1} style={[styles.blockSub, { color: tone.onSolid }]}>
            {`${clockOfMinutes(minute)} – ${clockOfMinutes(minute + minutes)}`}
          </AppText>
        </View>
      </View>
    </Animated.View>
  );
}

export const CALENDAR_HEADING = HEADING;

const NOW_GUTTER = GUTTER - 6;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, height: HEADING },
  hour: { position: 'absolute', left: 0, right: 0, height: 0 },
  hourLabel: { position: 'absolute', left: 0, top: -8, width: NOW_GUTTER },
  hourLine: { position: 'absolute', left: GUTTER, right: 0, top: 0, height: StyleSheet.hairlineWidth },
  work: { position: 'absolute', right: 0, opacity: 0.45, alignItems: 'flex-end', paddingRight: Spacing.sm, paddingTop: 2 },
  workLabel: { opacity: 0.9 },
  now: { position: 'absolute', left: 0, right: 0, height: 14, marginTop: -7, flexDirection: 'row', alignItems: 'center', zIndex: 5 },
  nowLabel: { width: NOW_GUTTER },
  nowDot: { width: 8, height: 8, borderRadius: 4, marginLeft: 2 },
  nowLine: { flex: 1, height: 1.5 },
  block: { position: 'absolute', borderRadius: 6, borderCurve: 'continuous' },
  blockBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, borderTopLeftRadius: 6, borderBottomLeftRadius: 6 },
  blockBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 8, paddingRight: 4, overflow: 'hidden', borderRadius: 6 },
  blockText: { flex: 1, minWidth: 0, justifyContent: 'center' },
  blockTextTop: { alignSelf: 'flex-start', paddingTop: 4 },
  blockName: { fontSize: 13, lineHeight: 16, fontWeight: '600' },
  blockSub: { fontSize: 12, lineHeight: 15, opacity: 0.85 },
  strike: { textDecorationLine: 'line-through' },
  circle: { width: 17, height: 17, borderRadius: 9, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  grab: { position: 'absolute', width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  grabStart: { right: -6, top: -22 },
  grabEnd: { left: -6, bottom: -22 },
  grabDot: { width: 11, height: 11, borderRadius: 6, borderWidth: 2, backgroundColor: '#FFFFFF' },
});
