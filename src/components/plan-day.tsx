import { useEffect, useRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, useColorScheme, View, type StyleProp, type ViewStyle } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { Radius, Spacing } from '@/constants/theme';
import { useActivityColors } from '@/hooks/use-activity-colors';
import { useTheme } from '@/hooks/use-theme';
import type { ActivityType, AgendaItem } from '@/lib/calendar';
import { formatLongDate, formatWeekdayInitial, type DateKey } from '@/lib/dates';
import { formatNumber } from '@/lib/format';
import { addMinutes, clockOf, type DayEntry, type DaySection } from '@/lib/plan';
import { formatDose } from '@/lib/supplements';

import { AppText } from './app-text';
import { Icon } from './icon';
import { MenuButton } from './menu-button';
import type { MenuGroup } from './menu-button.types';
import { beat, EASE_OUT, project } from './motion';
import { PressableScale } from './pressable-scale';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * The week of the day on screen, Monday to Sunday: the day picked in a filled circle, and under
 * each day a dot in the colour of what it holds. Swiping turns the week.
 */
export function PlanWeekStrip({
  week,
  selected,
  today,
  dots,
  onSelect,
  onChangeWeek,
  pulse = 0,
}: {
  week: readonly DateKey[];
  selected: DateKey;
  today: DateKey;
  /** Each day's main activity: its colour for the dot and its name for VoiceOver; none on a rest day. */
  dots: ReadonlyMap<DateKey, { color: string; label: string }>;
  onSelect: (day: DateKey) => void;
  onChangeWeek: (direction: number) => void;
  /** Each new value makes the selected day's circle beat once, to show where it is. */
  pulse?: number;
}) {
  const theme = useTheme();
  const stripX = useSharedValue(0);
  const width = useSharedValue(0);
  const turn = (direction: number) => {
    onChangeWeek(direction);
    stripX.set(direction * width.get() * 0.4);
    stripX.set(withSpring(0, { duration: 420, dampingRatio: 1 }));
  };
  const pan = usePanGesture({
    activeOffsetX: [-14, 14],
    failOffsetY: [-12, 12],
    onUpdate: (event) => {
      'worklet';
      stripX.set(event.translationX);
    },
    onDeactivate: (event) => {
      'worklet';
      const projected = event.translationX + project(event.velocityX, 0.99);
      if (!event.canceled && Math.abs(projected) > width.get() * 0.25) {
        const direction = projected < 0 ? 1 : -1;
        stripX.set(
          withTiming(-direction * width.get(), { duration: 160, easing: EASE_OUT }, (finished) => {
            'worklet';
            if (finished) scheduleOnRN(turn, direction);
          }),
        );
        return;
      }
      stripX.set(withSpring(0, { duration: 380, dampingRatio: 0.9, velocity: event.velocityX }));
    },
  });
  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateX: stripX.get() }] }));

  return (
    <GestureDetector gesture={pan} touchAction="pan-y">
      <View style={styles.clip} onLayout={(event) => width.set(event.nativeEvent.layout.width)}>
        <Animated.View style={[styles.weekRow, stripStyle]}>
          {week.map((day) => {
            const isSelected = day === selected;
            const isToday = day === today;
            const dot = dots.get(day);
            return (
              <Pressable
                key={day}
                onPress={() => onSelect(day)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={[formatLongDate(day), isToday ? 'oggi' : null, dot?.label ?? 'riposo'].filter(Boolean).join(', ')}
                style={({ pressed }) => [styles.dayCell, pressed && styles.pressed]}>
                <AppText variant="caption" weight="600" tone={isToday ? 'accent' : 'textSecondary'} maxFontSizeMultiplier={1.3}>
                  {formatWeekdayInitial(day)}
                </AppText>
                <BeatingCircle
                  pulse={pulse}
                  selected={isSelected}
                  style={[
                    styles.dayCircle,
                    isSelected && { backgroundColor: isToday ? theme.accent : theme.text },
                  ]}>
                  <AppText
                    numeric
                    // The number lives in a fixed circle, as in Calendar: it grows only so far.
                    maxFontSizeMultiplier={1.3}
                    style={[
                      styles.dayNumber,
                      { color: isSelected ? (isToday ? theme.onAccent : theme.background) : isToday ? theme.accent : theme.text },
                    ]}>
                    {String(Number(day.slice(8)))}
                  </AppText>
                </BeatingCircle>
                <View style={[styles.dot, { backgroundColor: dot?.color ?? 'transparent' }]} />
              </Pressable>
            );
          })}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

/** A circle that beats once each time `pulse` changes while it is the selected one. */
function BeatingCircle({
  pulse,
  selected,
  style,
  children,
}: {
  pulse: number;
  selected: boolean;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const scale = useSharedValue(1);
  const last = useRef(pulse);
  useEffect(() => {
    if (pulse === last.current) return;
    last.current = pulse;
    if (selected) beat(scale);
  }, [pulse, selected, scale]);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/** How much of the day is done, as a small ring with "3/7" in it. */
export function DayRing({ done, total, size = 56 }: { done: number; total: number; size?: number }) {
  const theme = useTheme();
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = useSharedValue(0);
  const ratio = total > 0 ? done / total : 0;
  useEffect(() => {
    progress.set(withTiming(ratio, { duration: 600, easing: Easing.bezier(0.23, 1, 0.32, 1) }));
  }, [progress, ratio]);
  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - progress.get()),
    strokeOpacity: progress.get() > 0.002 ? 1 : 0,
  }));
  return (
    <View style={{ width: size, height: size }} accessible accessibilityLabel={`${done} cose fatte su ${total}`}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={theme.track} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={theme.accent}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          animatedProps={ringProps}
        />
      </Svg>
      <View style={styles.ringCenter} pointerEvents="none">
        <AppText weight="700" numeric maxFontSizeMultiplier={1.3} style={styles.ringText}>
          {`${done}/${total}`}
        </AppText>
      </View>
    </View>
  );
}

/** What an activity is called in the calendar: the day of the program, the note ("Push") or its kind. */
export function activityName(item: AgendaItem, types: ReadonlyMap<number, ActivityType>, gymTypeId: number | null, dayNames: ReadonlyMap<number, string>): string {
  if (item.kind === 'workout') return item.workout.name;
  const o = item.occurrence;
  if (o.typeId === gymTypeId) {
    const day = item.dayId === null ? null : dayNames.get(item.dayId);
    return day ?? o.note ?? types.get(o.typeId)?.name ?? 'Palestra';
  }
  return types.get(o.typeId)?.name ?? 'Attività';
}

/**
 * One of the day's activities, in the colour of its kind: what it is and when, "Inizia" on a
 * gym day still to do today, and a menu to change, move or skip it.
 */
export function ActivityCard({
  item,
  name,
  type,
  date,
  today,
  onStart,
  onOpen,
  menu,
}: {
  item: AgendaItem;
  name: string;
  type: ActivityType | undefined;
  date: DateKey;
  today: DateKey;
  /** Shown on a gym day still to do, on the day itself. */
  onStart?: () => void;
  onOpen: () => void;
  menu: MenuGroup[];
}) {
  const theme = useTheme();
  const colors = useActivityColors();
  const scheme = useColorScheme();
  const color = colors[type?.color ?? 'green'];
  // On the light tint the bright hue is under 2:1; a deeper shade of it reads at 5:1 or more.
  const ink = scheme === 'dark' ? color : shade(color, 0.55);
  const { kicker, line, done, skipped } = describeActivity(item, type, date, today);
  // Only the text opens it: the menu and "Inizia" beside it are buttons of their own.
  return (
    <View style={[styles.activity, { backgroundColor: tint(color, skipped ? 0.08 : 0.16) }]}>
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${name}, ${kicker}`} style={({ pressed }) => [styles.activityText, pressed && styles.pressed]}>
        <AppText variant="footnote" weight="600" style={{ color: skipped ? theme.textSecondary : ink }}>
          {kicker}
        </AppText>
        <AppText variant="title2" style={skipped ? { color: theme.textSecondary, textDecorationLine: 'line-through' } : undefined}>
          {name}
        </AppText>
        {line ? (
          <AppText variant="subhead" tone="textSecondary" numeric>
            {line}
          </AppText>
        ) : null}
      </Pressable>
      {done ? <Icon name="checkmark.circle.fill" size={26} color={ink} /> : null}
      {onStart && !done && !skipped ? (
        <PressableScale onPress={onStart} accessibilityRole="button" accessibilityLabel={`Inizia ${name}`} style={[styles.start, { backgroundColor: theme.accent }]}>
          <AppText weight="600" style={{ color: theme.onAccent }}>
            Inizia
          </AppText>
        </PressableScale>
      ) : null}
      <MenuButton icon="ellipsis" accessibilityLabel={`Altro su ${name}`} groups={menu} />
    </View>
  );
}

/** The colour mixed with black: 0.55 takes the system hues from under 2:1 to over 5:1 on their light tint. */
function shade(hex: string, amount: number): string {
  const channel = (i: number) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - amount)).toString(16).padStart(2, '0');
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/** "#30D158" at 16% over the background. */
function tint(hex: string, alpha: number): string {
  return `${hex}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')}`;
}

function describeActivity(
  item: AgendaItem,
  type: ActivityType | undefined,
  date: DateKey,
  today: DateKey,
): { kicker: string; line: string | null; done: boolean; skipped: boolean } {
  if (item.kind === 'workout') {
    const start = clockOf(item.workout.startedAt);
    if (!item.workout.endedAt) return { kicker: `In corso dalle ${start}`, line: null, done: false, skipped: false };
    return { kicker: 'Fatto', line: `${start} – ${clockOf(item.workout.endedAt)}`, done: true, skipped: false };
  }
  const o = item.occurrence;
  const minutes = o.minutes ?? type?.minutes ?? null;
  const span = o.time ? (minutes ? `${o.time} – ${addMinutes(o.time, minutes)}` : o.time) : null;
  if (item.status === 'skipped') return { kicker: 'Saltato', line: span, done: false, skipped: true };
  if (item.status === 'done') return { kicker: 'Fatto', line: span, done: true, skipped: false };
  if (date === today) {
    const evening = o.time !== null && o.time >= '18:00';
    return { kicker: o.time ? `${evening ? 'Stasera' : 'Oggi'} alle ${o.time}` : 'Oggi', line: minutes && o.time ? `Fino alle ${addMinutes(o.time, minutes)}` : null, done: false, skipped: false };
  }
  return { kicker: o.time ? `Alle ${o.time}` : 'In programma', line: minutes && o.time ? `Fino alle ${addMinutes(o.time, minutes)}` : null, done: false, skipped: false };
}

/**
 * A moment of the day and what is due in it, one line each: ticked by a tap, with the time it
 * was done; what is left over once the moment has gone by stands out in orange.
 */
export function ChecklistSection({
  section,
  late,
  onPress,
  onLongPress,
}: {
  section: DaySection;
  /** Whether what is still to do in it is late. */
  late: boolean;
  onPress: (entry: DayEntry) => void;
  onLongPress: (entry: DayEntry) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <AppText variant="headline">{section.moment.name}</AppText>
        <AppText tone="textSecondary" numeric>
          {section.time}
        </AppText>
      </View>
      <View style={[styles.group, { backgroundColor: theme.card }]}>
        {section.entries.map((entry, index) => {
          const missed = late && !entry.done;
          const { name, amount, side } = describeEntry(entry, missed);
          return (
            <Pressable
              key={entry.key}
              onPress={() => onPress(entry)}
              onLongPress={() => onLongPress(entry)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: entry.done }}
              accessibilityLabel={[name, amount, side].filter(Boolean).join(', ')}
              style={({ pressed }) => [
                styles.entry,
                index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator },
                pressed && { backgroundColor: theme.cardPressed },
              ]}>
              <Icon
                name={entry.done ? 'checkmark.circle.fill' : 'circle'}
                size={24}
                color={entry.done ? theme.accent : missed ? theme.warning : theme.textSecondary}
              />
              <AppText style={[styles.name, { color: entry.done ? theme.textSecondary : theme.text }]} numberOfLines={2}>
                {name}
              </AppText>
              {amount ? (
                <AppText tone="textSecondary" numberOfLines={1} style={styles.amount}>
                  {amount}
                </AppText>
              ) : null}
              <AppText numeric numberOfLines={1} style={[styles.side, { color: missed ? theme.warning : theme.textSecondary }]}>
                {side}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function describeEntry(entry: DayEntry, missed: boolean): { name: string; amount: string | null; side: string } {
  if (entry.kind === 'weighIn') {
    const at = entry.loggedAt ? clockOf(entry.loggedAt) : null;
    return {
      name: 'Pesata',
      amount: null,
      side: entry.kg !== null ? [`${formatNumber(entry.kg, 1)} kg`, at].filter(Boolean).join(' · ') : missed ? 'Da fare' : '',
    };
  }
  const s = entry.supplement;
  const times = s.timesPerDay > 1 ? ` (${entry.index + 1}/${s.timesPerDay})` : '';
  return {
    name: `${s.name}${times}`,
    amount: formatDose(s.dose, s.unit),
    side: entry.takenAt ? clockOf(entry.takenAt) : missed ? 'Da prendere' : (entry.time ?? ''),
  };
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden', marginBottom: Spacing.lg },
  weekRow: { flexDirection: 'row' },
  dayCell: { flex: 1, alignItems: 'center', gap: 6 },
  dayCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  dayNumber: { fontSize: 17, lineHeight: 22, fontWeight: '600', fontVariant: ['tabular-nums'] },
  dot: { width: 6, height: 6, borderRadius: 3 },
  pressed: { opacity: 0.6 },
  ringCenter: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  ringText: { fontSize: 15, lineHeight: 18 },
  activity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    marginBottom: Spacing.md,
  },
  activityText: { flex: 1, gap: 2 },
  start: { height: 44, paddingHorizontal: Spacing.lg, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  section: { marginTop: Spacing.lg },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 2, marginBottom: Spacing.sm },
  group: { borderRadius: Radius.lg, borderCurve: 'continuous', overflow: 'hidden' },
  entry: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 54, paddingHorizontal: Spacing.lg },
  // The amount gives way first when the line is short of room, then the name.
  name: { flexShrink: 1 },
  amount: { flexShrink: 100 },
  side: { marginLeft: 'auto', flexShrink: 0 },
});
