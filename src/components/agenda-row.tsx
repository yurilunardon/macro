import { Pressable, StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatMinutes, itemMinutes, type ActivityType, type AgendaItem } from '@/lib/calendar';
import { countLabel } from '@/lib/format';
import { formatWorkoutLength } from '@/lib/training';

import { ActivityBadge } from './activity-badge';
import { AppText } from './app-text';
import { Icon } from './icon';

type AgendaRowProps = {
  item: AgendaItem;
  types: ReadonlyMap<number, ActivityType>;
  gymTypeId: number | null;
  dayNames: ReadonlyMap<number, string>;
  onPress: () => void;
  /** Today's gym day still to do: starts its workout. */
  onStart?: () => void;
  /** Shown before the time, e.g. the date in the report. */
  prefix?: string;
};

function clock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** What an item is called and the line under it. */
export function describeItem(
  item: AgendaItem,
  types: ReadonlyMap<number, ActivityType>,
  gymTypeId: number | null,
  dayNames: ReadonlyMap<number, string>,
): { title: string; subtitle: string; type: ActivityType | undefined } {
  if (item.kind === 'workout') {
    const w = item.workout;
    // While it runs, "In corso" stands on the right instead of a length.
    const length = w.endedAt ? formatWorkoutLength((new Date(w.endedAt).getTime() - new Date(w.startedAt).getTime()) / 1000) : null;
    return {
      title: w.name,
      subtitle: [clock(w.startedAt), length, countLabel(w.workSets, 'serie', 'serie')].filter(Boolean).join(' · '),
      type: gymTypeId === null ? undefined : types.get(gymTypeId),
    };
  }
  const o = item.occurrence;
  const type = types.get(o.typeId);
  const isGym = o.typeId === gymTypeId;
  const dayName = item.dayId === null ? null : (dayNames.get(item.dayId) ?? null);
  const minutes = itemMinutes(item, types);
  return {
    title: isGym ? (dayName ?? type?.name ?? 'Palestra') : (type?.name ?? 'Attività'),
    subtitle: [isGym && dayName ? type?.name : null, o.time, minutes > 0 ? formatMinutes(minutes) : null, o.note]
      .filter(Boolean)
      .join(' · '),
    type,
  };
}

/** An activity or a workout in a day's list: its badge, what it is, and whether it is done. */
export function AgendaRow({ item, types, gymTypeId, dayNames, onPress, onStart, prefix }: AgendaRowProps) {
  const theme = useTheme();
  const { title, subtitle, type } = describeItem(item, types, gymTypeId, dayNames);
  const skipped = item.kind === 'activity' && item.status === 'skipped';
  const done = item.kind === 'workout' ? item.workout.endedAt !== null : item.status === 'done';
  const running = item.kind === 'workout' && item.workout.endedAt === null;
  const line = prefix ? [prefix, subtitle].filter(Boolean).join(' · ') : subtitle;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[title, line, done ? 'fatto' : skipped ? 'saltato' : running ? 'in corso' : null].filter(Boolean).join(', ')}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.cardPressed }]}>
      <View style={skipped && styles.faded}>
        <ActivityBadge symbol={type?.symbol ?? 'calendar'} color={type?.color ?? 'blue'} />
      </View>
      <View style={[styles.text, skipped && styles.faded]}>
        <AppText numberOfLines={1} style={skipped && styles.struck}>
          {title}
        </AppText>
        {line ? (
          <AppText variant="subhead" tone="textSecondary" numberOfLines={1}>
            {line}
          </AppText>
        ) : null}
      </View>
      {onStart ? (
        <Pressable
          onPress={onStart}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Inizia ${title}`}
          style={({ pressed }) => [styles.start, { backgroundColor: theme.accent }, pressed && styles.pressed]}>
          <AppText variant="subhead" weight="600" style={{ color: theme.onAccent }}>
            Inizia
          </AppText>
        </Pressable>
      ) : running ? (
        <AppText variant="subhead" weight="600" tone="accent">
          In corso
        </AppText>
      ) : skipped ? (
        <AppText variant="subhead" tone="textTertiary">
          Saltata
        </AppText>
      ) : done ? (
        <Icon name="checkmark.circle.fill" size={22} tone="accent" />
      ) : null}
      <Icon name="chevron.right" size={13} tone="textTertiary" weight="semibold" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  text: { flex: 1, gap: 2 },
  faded: { opacity: 0.45 },
  struck: { textDecorationLine: 'line-through' },
  start: { minHeight: 34, paddingHorizontal: 14, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
});
