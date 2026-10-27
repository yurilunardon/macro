import { useRouter } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { useSQLiteContext } from 'expo-sqlite';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Spacing } from '@/constants/theme';
import { ACTIVE_WORKOUT_KEY, ACTIVE_WORKOUT_TOPICS, loadActiveWorkout } from '@/db/active-workout';
import { prefetchLiveQuery, useLiveQuery } from '@/db/live';
import { getWorkout } from '@/db/workouts';
import { useClock } from '@/hooks/use-clock';
import { useExerciseNames } from '@/hooks/use-exercise-names';
import { useTheme } from '@/hooks/use-theme';
import { formatDuration, workoutProgress } from '@/lib/training';
import { useRestTimer } from '@/services/rest-timer';

import { AppText } from './app-text';
import { Icon } from './icon';

/**
 * The workout in progress, above the tab bar like the mini player in Music: a ring of the sets
 * done (or of the rest left), what to do now and the time. Tapping it brings the workout back,
 * and that is all it does: no preview or menu on a hold.
 */
export function WorkoutAccessory({ id, name, startedAt }: { id: number; name: string; startedAt: string }) {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const { names } = useExerciseNames();
  const placement = NativeTabs.BottomAccessory.usePlacement();
  const rest = useRestTimer();
  const now = useClock(1000);
  const { data: workout } = useLiveQuery(`accessory:${id}`, (database) => getWorkout(database, id), ['training']);
  const resting = rest !== null && rest.endsAt > now;
  // The rest is over and waits for "Vai", with the phone buzzing.
  const ready = rest !== null && !resting;
  const left = resting ? (rest.endsAt - now) / 1000 : 0;
  const time = ready ? 'Vai!' : resting ? formatDuration(left) : formatDuration((now - new Date(startedAt).getTime()) / 1000);
  const progress = workoutProgress(workout?.exercises ?? []);
  const current = progress.current && workout ? workout.exercises[progress.current.exercise] : null;
  const fraction = resting ? left / rest.total : progress.total > 0 ? progress.done / progress.total : 0;
  const line = ready
    ? 'Recupero finito'
    : resting
    ? 'Recupero'
    : current && progress.current
      ? `${names(current.exercise).title} · serie ${progress.current.set + 1} di ${current.sets.length}`
      : 'Allenamento in corso';

  return (
    <Pressable
      onPress={() => router.push('/workout')}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${ready ? 'recupero finito' : resting ? `recupero ${time}` : `in corso da ${time}`}. Apri l’allenamento`}
      onPressIn={() => void prefetchLiveQuery(db, ACTIVE_WORKOUT_KEY, loadActiveWorkout, ACTIVE_WORKOUT_TOPICS)}
      style={styles.row}>
      <Ring fraction={fraction} color={resting ? theme.warning : theme.accent} track={theme.track}>
        <Icon name={resting ? 'timer' : 'figure.strengthtraining.traditional'} size={15} tone={resting ? 'warning' : 'accent'} />
      </Ring>
      {placement === 'inline' ? (
        <AppText variant="headline" numeric style={ready && { color: theme.accent }}>
          {time}
        </AppText>
      ) : (
        <>
          <View style={styles.flex}>
            <AppText variant="headline" numberOfLines={1}>
              {name}
            </AppText>
            <AppText variant="footnote" tone="textSecondary" numberOfLines={1}>
              {line}
            </AppText>
          </View>
          <AppText numeric style={[styles.time, { color: ready ? theme.accent : resting ? theme.warning : theme.text }]}>
            {time}
          </AppText>
        </>
      )}
    </Pressable>
  );
}

const RING = 32;
const STROKE = 3;

/** A thin ring filled clockwise from the top, around a symbol. */
function Ring({ fraction, color, track, children }: { fraction: number; color: string; track: string; children: React.ReactNode }) {
  const radius = (RING - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <View style={styles.ring}>
      <Svg width={RING} height={RING} style={StyleSheet.absoluteFill}>
        <Circle cx={RING / 2} cy={RING / 2} r={radius} stroke={track} strokeWidth={STROKE} fill="none" />
        {f > 0 ? (
          <Circle
            cx={RING / 2}
            cy={RING / 2}
            r={radius}
            stroke={color}
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={circumference * (1 - f)}
            transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
          />
        ) : null}
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.md },
  flex: { flex: 1 },
  time: { fontSize: 20, lineHeight: 24, fontWeight: '600', fontVariant: ['tabular-nums'] },
  ring: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
});
