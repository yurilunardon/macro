import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useSyncExternalStore, type ComponentRef, type RefObject } from 'react';
import { StyleSheet, useColorScheme, useWindowDimensions, View } from 'react-native';
import { usePanGesture } from 'react-native-gesture-handler';
import Animated, { scrollTo, useAnimatedReaction, useAnimatedStyle, useFrameCallback, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Spacing } from '@/constants/theme';
import { moveOccurrence } from '@/db/calendar';
import { setDoseTaken, setDoseTime, setUsualTime } from '@/db/supplements';
import { makeRegular, setLoggedAt, setWeighInTime } from '@/db/plan';
import { useAgenda } from '@/hooks/use-agenda';
import type { ScrollTop } from '@/hooks/use-scroll-top';
import { useTheme } from '@/hooks/use-theme';
import { describeVolley, formatDayName, volleyInTheWay } from '@/lib/calendar';
import { addDays, addMonths, monthGridWeeks, monthOf, monthRange, type DateKey } from '@/lib/dates';
import { clockOfMinutes, GUTTER, HOUR_HEIGHT, minuteOfY, snapMinute, yOfMinute } from '@/lib/day-grid';
import { isoAt } from '@/lib/plan';
import { calendarDrag, dayLayouts, type DayBlock } from '@/services/calendar-drag';
import { haptics } from '@/services/haptics';

import { AppText } from './app-text';
import { blockTone } from './calendar-day';
import { DAY_ROW, MONTH_ROWS_TOP, type MonthGeometry } from './month-grid';
import { usePinnedBar } from './pinned-strip';
import { toast } from './toast';

/** As long as Calendar waits before something comes off the page. */
const HOLD_MS = 380;
/** How close to the screen's side a finger stays for the day to turn, and how often it does. */
const EDGE = 18;
const TURN_EVERY_MS = 750;
const SCROLL_ZONE = 56;
const SCROLL_STEP = 6;
/** The tab bar, under which there is nothing to drop on. */
const BOTTOM_ZONE = 110;
const NEW_MINUTES = 60;

type Lift = { kind: 'new' } | { kind: 'block'; block: DayBlock };

/** A block off the page, what the finger is doing with it, and the time it would go to. */
type Floating = { name: string; color: string; minutes: number; label: string; note: string | null; blocked: boolean; x: number; width: number };

let floating: Floating | null = null;
const listeners = new Set<() => void>();
function setFloating(next: Floating | null): void {
  floating = next;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Touch and hold as in Calendar: on an empty hour it makes "Nuovo", on a block it takes it off the
 * page; then the finger moves it by quarters of an hour, up and down the day, and on to another day
 * over the month or the week above, or by staying at the side of the screen. Letting go asks what
 * the new one is, or moves the block, this time only, with "Sempre così" and "Annulla" to follow.
 *
 * One gesture over all the pages, not one per page: it goes on while the days turn under it.
 */
export function useCalendarDrag({
  scroll,
  date,
  today,
  goTo,
  month,
  monthView,
}: {
  scroll: ScrollTop;
  date: DateKey;
  today: DateKey;
  goTo: (day: DateKey) => void;
  month: MonthGeometry;
  monthView: RefObject<ComponentRef<typeof View> | null>;
}) {
  const db = useSQLiteContext();
  const router = useRouter();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const bar = usePinnedBar();

  const current = monthOf(date);
  const { data: calendar, agenda } = useAgenda(monthRange(addMonths(current, -1)).from, monthRange(addMonths(current, 1)).to, today);
  const latest = useRef({ date, agenda, kinds: calendar?.kinds ?? null });
  useEffect(() => {
    latest.current = { date, agenda, kinds: calendar?.kinds ?? null };
  });

  const pointerX = useSharedValue(0);
  const pointerY = useSharedValue(0);
  const lifted = useSharedValue(false);
  /** Where the day's hours begin on screen when the page is at 0: on screen, less how far it has gone. */
  const gridTop = useSharedValue(0);
  const firstHour = useSharedValue(6);
  /** How far into the block the finger took it, in minutes. */
  const grab = useSharedValue(0);
  const length = useSharedValue(NEW_MINUTES);
  const minute = useSharedValue(0);
  const monthTop = useSharedValue(0);
  const monthLeft = useSharedValue(0);
  const monthWidth = useSharedValue(0);
  const canChangeDay = useSharedValue(false);
  /** Row and column of the day it is over, as one number; -1 over none. */
  const overCell = useSharedValue(-1);
  const edge = useSharedValue(0);
  /** Where the week that stays at the top ends on screen: above it, the days to drop on. */
  const weekEnd = useSharedValue(0);

  const lift = useRef<Lift | null>(null);
  const origin = useRef<{ date: DateKey; minute: number } | null>(null);

  /** What stops a block being let go here, as volleyball comes first. */
  const obstacle = (block: DayBlock | null, day: DateKey, start: number, minutes: number): string | null => {
    const { agenda: days, kinds } = latest.current;
    const item = block?.item;
    if (!kinds || item?.kind !== 'activity' || item.occurrence.typeId !== kinds.gym) return null;
    const volley = volleyInTheWay(days.get(day) ?? [], kinds, start, minutes, item.key);
    return volley ? describeVolley(day, volley) : null;
  };

  const hoverDay = (cell: number): DateKey | null => {
    if (cell < 0) return null;
    const weeks = monthGridWeeks(monthOf(latest.current.date));
    return weeks[Math.floor(cell / 7)]?.[cell % 7] ?? null;
  };

  /** The label and the warning, each time the time or the day under the finger changes. */
  const refresh = () => {
    const now = lift.current;
    if (!now || !floating) return;
    const block = now.kind === 'block' ? now.block : null;
    const over = block?.item?.kind === 'activity' ? hoverDay(overCell.get()) : null;
    const onOther = over !== null && over !== latest.current.date;
    const start = onOther ? (block?.start ?? minute.get()) : minute.get();
    const day = onOther ? over : latest.current.date;
    const why = obstacle(block, day, start, floating.minutes);
    calendarDrag.set({ hover: onOther ? over : null });
    setFloating({
      ...floating,
      label: clockOfMinutes(start),
      note: why ?? (onOther ? `${formatDayName(day)}, alle ${clockOfMinutes(start)}` : null),
      blocked: why !== null,
    });
  };

  const onSnap = () => {
    haptics.selection();
    refresh();
  };

  const begin = (x: number, y: number) => {
    const day = latest.current.date;
    const layout = dayLayouts.get(day);
    const grid = layout?.grid.current;
    if (!layout || !grid) return;
    monthView.current?.measureInWindow((mx, my, mw) => {
      monthTop.set(my + scroll.offset.get());
      monthLeft.set(mx);
      monthWidth.set(mw);
    });
    grid.measureInWindow((gx, gy, gw) => {
      // Above the hours, on the day's title: nothing to take.
      if (y < gy) return;
      const inDay = minuteOfY(y - gy, layout.firstHour);
      const hit = layout.blocks.find((b) => {
        const left = gx + GUTTER + b.left;
        return x >= left && x <= left + b.width && y - gy >= b.top && y - gy <= b.top + b.height;
      });
      if (hit && (hit.skipped || hit.item?.kind === 'workout')) return;
      if (hit?.item?.kind === 'activity' && hit.item.occurrence.sourceUid) {
        haptics.warning();
        toast.show('La partita viene dal calendario della squadra', 'calendar');
        return;
      }
      gridTop.set(gy + scroll.offset.get());
      firstHour.set(layout.firstHour);
      haptics.medium();
      calendarDrag.set({ selected: null });
      if (hit) {
        const minutes = hit.minutes;
        lift.current = { kind: 'block', block: hit };
        origin.current = { date: day, minute: hit.start };
        grab.set(inDay - hit.start);
        length.set(minutes);
        minute.set(hit.start);
        canChangeDay.set(hit.item?.kind === 'activity');
        calendarDrag.set({ lifted: { date: day, key: hit.key } });
        setFloating({ name: hit.name, color: hit.color, minutes, label: clockOfMinutes(hit.start), note: null, blocked: false, x: gx, width: gw });
      } else {
        lift.current = { kind: 'new' };
        origin.current = null;
        const start = snapMinute(inDay - NEW_MINUTES / 4, NEW_MINUTES);
        grab.set(NEW_MINUTES / 4);
        length.set(NEW_MINUTES);
        minute.set(start);
        canChangeDay.set(false);
        setFloating({ name: 'Nuovo', color: '', minutes: NEW_MINUTES, label: clockOfMinutes(start), note: null, blocked: false, x: gx, width: gw });
      }
      overCell.set(-1);
      lifted.set(true);
    });
  };

  const clear = () => {
    lifted.set(false);
    lift.current = null;
    origin.current = null;
    setFloating(null);
    calendarDrag.set({ lifted: null, hover: null });
  };

  const moveBlock = async (block: DayBlock, day: DateKey, start: number) => {
    const time = clockOfMinutes(start);
    const entry = block.entry;
    if (block.item?.kind === 'activity') {
      const o = block.item.occurrence;
      const minutes = o.minutes ?? (block.minutes > 0 ? block.minutes : null);
      const undo = await moveOccurrence(db, o, { date: day, time, minutes });
      // Another date takes it out of its plan, so it has another key: only here it keeps its grab points.
      if (day === o.date) calendarDrag.set({ selected: { date: day, key: block.key } });
      const said = day === o.date ? `${block.name} alle ${time}, solo questa volta` : `${block.name} spostato a ${formatDayName(day).toLowerCase()}`;
      toast.show(
        said,
        'checkmark.circle.fill',
        { label: 'Annulla', onPress: () => void undo() },
        o.planId !== null
          ? {
              label: 'Sempre',
              onPress: () => {
                void undo().then(() => makeRegular(db, o, { date: day, time, minutes }));
              },
            }
          : undefined,
      );
      return;
    }
    if (entry?.kind === 'supplement') {
      const s = entry.supplement;
      const on = latest.current.date;
      if (entry.done) {
        const before = entry.takenAt;
        await setDoseTaken(db, s.id, on, entry.index, true, isoAt(on, time));
        toast.show(`${s.name} alle ${time}`, 'checkmark.circle.fill', { label: 'Annulla', onPress: () => void setDoseTaken(db, s.id, on, entry.index, true, before ?? undefined) });
        return;
      }
      await setDoseTime(db, s.id, on, entry.index, time);
      toast.show(
        `${s.name} alle ${time}, solo oggi`,
        'checkmark.circle.fill',
        { label: 'Annulla', onPress: () => void setDoseTime(db, s.id, on, entry.index, entry.planned === s.times[entry.index] ? null : entry.planned) },
        {
          label: 'Sempre',
          onPress: () => {
            void setDoseTime(db, s.id, on, entry.index, null).then(() => setUsualTime(db, s.id, entry.index, time));
          },
        },
      );
      return;
    }
    if (entry?.kind === 'weighIn') {
      const on = latest.current.date;
      if (entry.done) {
        await setLoggedAt(db, on, isoAt(on, time));
        toast.show(`Pesata alle ${time}`);
      } else {
        const before = entry.at;
        await setWeighInTime(db, time);
        toast.show(`Pesata alle ${time}, da ora in poi`, 'checkmark.circle.fill', { label: 'Annulla', onPress: () => void setWeighInTime(db, before) });
      }
    }
  };

  const finish = () => {
    const now = lift.current;
    if (!now) return;
    calendarDrag.markDropped();
    const day = latest.current.date;
    if (now.kind === 'new') {
      calendarDrag.set({ draft: { date: day, minute: minute.get(), minutes: NEW_MINUTES } });
      clear();
      router.push({ pathname: '/calendar-new', params: { date: day } });
      return;
    }
    const { block } = now;
    const over = block.item?.kind === 'activity' ? hoverDay(overCell.get()) : null;
    const target = over ?? day;
    const start = over ? block.start : minute.get();
    const why = obstacle(block, target, start, block.minutes);
    if (why) {
      haptics.warning();
      toast.show(`${why}: ${block.name} non può stare lì`, 'exclamationmark.triangle.fill');
      // Back where it was, if it is still in sight; then the day draws it again.
      const from = origin.current;
      if (from?.date === day && !over) {
        minute.set(withTiming(from.minute, { duration: 220 }));
        setTimeout(clear, 230);
      } else {
        clear();
      }
      return;
    }
    const moved = target !== origin.current?.date || start !== block.start;
    if (moved) void moveBlock(block, target, start);
    else if (block.item?.kind === 'activity') calendarDrag.set({ selected: { date: day, key: block.key } });
    clear();
  };

  // The day turns with the finger at the side of the screen, until it comes away.
  const turning = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const setEdge = (direction: number) => {
    clearInterval(turning.current);
    if (direction === 0 || lift.current?.kind !== 'block') return;
    turning.current = setInterval(() => {
      const next = addDays(latest.current.date, direction);
      goTo(next);
      firstHour.set(dayLayouts.get(next)?.firstHour ?? firstHour.get());
      refresh();
    }, TURN_EVERY_MS);
  };
  useEffect(() => () => clearInterval(turning.current), []);

  const pan = usePanGesture({
    activateAfterLongPress: HOLD_MS,
    onActivate: (event) => {
      'worklet';
      pointerX.set(event.absoluteX);
      pointerY.set(event.absoluteY);
      scheduleOnRN(begin, event.absoluteX, event.absoluteY);
    },
    onUpdate: (event) => {
      'worklet';
      pointerX.set(event.absoluteX);
      pointerY.set(event.absoluteY);
    },
    onDeactivate: () => {
      'worklet';
      if (edge.get() !== 0) {
        edge.set(0);
        scheduleOnRN(setEdge, 0);
      }
      scheduleOnRN(finish);
    },
  });

  // The time under the finger, and the day it is over, on the UI thread: the block follows at once.
  useAnimatedReaction(
    () => {
      if (!lifted.get()) return null;
      const y = pointerY.get();
      const x = pointerX.get();
      const offset = scroll.offset.get();
      // The rows on screen, and the selected week where it stays when the page has gone past it.
      const top = monthTop.get() - offset + MONTH_ROWS_TOP;
      const pinnedAt = month.pinnedRow.get();
      const rowAt = top + pinnedAt * DAY_ROW;
      const held = Math.max(0, offset + bar.get() - (month.gridTop.get() + MONTH_ROWS_TOP + pinnedAt * DAY_ROW));
      const pinned = rowAt + held;
      let row = -1;
      if (y >= pinned && y < pinned + DAY_ROW) row = pinnedAt;
      else if (held <= 0) {
        const at = Math.floor((y - top) / DAY_ROW);
        if (at >= 0 && at < month.weeks.get()) row = at;
      }
      const column = Math.floor(((x - monthLeft.get()) / Math.max(1, monthWidth.get())) * 7);
      const cell = canChangeDay.get() && row >= 0 && column >= 0 && column < 7 ? row * 7 + column : -1;
      const raw = minuteOfY(y + offset - gridTop.get(), firstHour.get()) - grab.get();
      return { cell, minute: snapMinute(raw, length.get()), weekEnd: pinned + DAY_ROW };
    },
    (next) => {
      if (!next) return;
      weekEnd.set(next.weekEnd);
      if (next.cell !== overCell.get()) {
        overCell.set(next.cell);
        scheduleOnRN(refresh);
      }
      if (next.cell < 0 && next.minute !== minute.get()) {
        minute.set(next.minute);
        scheduleOnRN(onSnap);
      }
    },
  );

  // Near the top or the bottom the page runs under the block; at the side, the day turns.
  const { ref: scrollRef, offset, roomBelow } = scroll;
  const frame = useFrameCallback(() => {
    if (!lifted.get()) return;
    const y = pointerY.get();
    const x = pointerX.get();
    const top = weekEnd.get();
    let step = 0;
    if (overCell.get() < 0 && y > top && y < top + SCROLL_ZONE) step = -SCROLL_STEP;
    else if (y > windowHeight - BOTTOM_ZONE - SCROLL_ZONE) step = Math.min(SCROLL_STEP, Math.max(0, roomBelow.get()));
    if (step !== 0) scrollTo(scrollRef, 0, offset.get() + step, false);
    const side = x < EDGE ? -1 : x > windowWidth - EDGE ? 1 : 0;
    const wanted = overCell.get() >= 0 || !canChangeDay.get() ? 0 : side;
    if (wanted !== edge.get()) {
      edge.set(wanted);
      scheduleOnRN(setEdge, wanted);
    }
  }, false);
  useAnimatedReaction(
    () => lifted.get(),
    (on) => frame.setActive(on),
  );

  const overlay = (
    <DragOverlay
      lifted={lifted}
      overCell={overCell}
      gridTop={gridTop}
      offset={scroll.offset}
      minute={minute}
      firstHour={firstHour}
      weekEnd={weekEnd}
    />
  );
  return { gesture: pan, overlay };
}

function DragOverlay({
  lifted,
  overCell,
  gridTop,
  offset,
  minute,
  firstHour,
  weekEnd,
}: {
  lifted: SharedValue<boolean>;
  overCell: SharedValue<number>;
  gridTop: SharedValue<number>;
  offset: SharedValue<number>;
  minute: SharedValue<number>;
  firstHour: SharedValue<number>;
  weekEnd: SharedValue<number>;
}) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const shown = useSyncExternalStore(subscribe, () => floating);
  const place = useAnimatedStyle(() => {
    // Over a day it steps aside, not to hide the days: the day lights up and the note says the rest.
    const over = overCell.get() >= 0;
    return { opacity: lifted.get() && !over ? 1 : 0, transform: [{ translateY: gridTop.get() - offset.get() + yOfMinute(minute.get(), firstHour.get()) }] };
  });
  const noteStyle = useAnimatedStyle(() => ({ transform: [{ translateY: weekEnd.get() + 6 }] }));
  if (!shown) return null;
  const color = shown.blocked ? theme.danger : shown.color || theme.accent;
  const tone = blockTone(color, scheme);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.floating, { left: shown.x, width: shown.width }, place]}>
        <View style={[styles.badge, { backgroundColor: color }]}>
          <AppText numeric style={[styles.badgeText, { color: tone.onSolid }]}>
            {shown.label}
          </AppText>
        </View>
        <View style={[styles.block, { left: GUTTER, width: shown.width - GUTTER, height: Math.max(HOUR_HEIGHT / 2, (shown.minutes / 60) * HOUR_HEIGHT) - 2, backgroundColor: tone.solid }]}>
          <AppText numberOfLines={1} style={[styles.name, { color: tone.onSolid }]}>
            {shown.name}
          </AppText>
        </View>
      </Animated.View>
      {shown.note ? (
        <Animated.View style={[styles.note, noteStyle, { backgroundColor: shown.blocked ? theme.danger : theme.accent }]}>
          <AppText variant="subhead" weight="600" style={{ color: blockTone(shown.blocked ? theme.danger : theme.accent, scheme).onSolid }}>
            {shown.note}
          </AppText>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  floating: { position: 'absolute', top: 0 },
  badge: { position: 'absolute', left: -4, top: -10, width: GUTTER - 2, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 12, lineHeight: 15, fontWeight: '700' },
  block: {
    position: 'absolute',
    top: 1,
    borderRadius: 6,
    borderCurve: 'continuous',
    paddingHorizontal: 8,
    paddingTop: 4,
    shadowColor: '#000000',
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  name: { fontSize: 13, lineHeight: 16, fontWeight: '600' },
  note: { position: 'absolute', top: 0, left: Spacing.lg, right: Spacing.lg, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: 14, borderCurve: 'continuous' },
});

