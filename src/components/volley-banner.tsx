import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Radius, Spacing } from '@/constants/theme';
import { skipOccurrence } from '@/db/calendar';
import { useAgenda } from '@/hooks/use-agenda';
import { useTheme } from '@/hooks/use-theme';
import { formatDayName, volleyClashes } from '@/lib/calendar';
import { addDays, type DateKey } from '@/lib/dates';
import { haptics } from '@/services/haptics';

import { AppText } from './app-text';
import { activityName } from './plan-day';
import { toast } from './toast';

/** How far ahead it looks: the matches of the months to come are in the calendar already. */
const LOOK_AHEAD_DAYS = 60;

/**
 * Volleyball comes first. A workout that falls on a match, or at the same time as a practice, stays
 * on top of the calendar until it is moved or skipped, the nearest first.
 */
export function VolleyBanner({ today }: { today: DateKey }) {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const { data, agenda, types } = useAgenda(today, addDays(today, LOOK_AHEAD_DAYS), today);
  if (!data) return null;
  const clashes = volleyClashes(agenda, data.kinds, today, types);
  const clash = clashes[0];
  if (!clash) return null;
  const name = activityName(clash.gym, types, data.gymTypeId, data.dayNames);
  const what = clash.match ? 'la partita' : 'pallavolo';
  const at = clash.occurrence.time ? ` alle ${clash.occurrence.time}` : '';
  const skip = async () => {
    haptics.selection();
    const undo = await skipOccurrence(db, clash.gym.occurrence);
    toast.show(`${name} saltato`, 'checkmark.circle.fill', { label: 'Annulla', onPress: () => void undo() });
  };
  return (
    <Animated.View key={clash.gym.key} entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)} style={[styles.banner, { backgroundColor: theme.warningSoft }]}>
      <AppText style={styles.text}>
        <AppText weight="700">{formatDayName(clash.date)}</AppText>
        {` hai ${what}${at}: ${name} non si può fare.`}
        {clashes.length > 1 ? ` E altri ${clashes.length - 1}.` : ''}
      </AppText>
      <View style={styles.buttons}>
        <Pressable
          onPress={() => router.push({ pathname: '/move-workout', params: { date: clash.date, key: clash.gym.key } })}
          accessibilityRole="button"
          accessibilityLabel={`Sposta ${name}`}
          style={({ pressed }) => [styles.button, { backgroundColor: theme.accent }, pressed && styles.pressed]}>
          <AppText weight="600" style={{ color: theme.onAccent }}>
            Sposta
          </AppText>
        </Pressable>
        <Pressable onPress={() => void skip()} accessibilityRole="button" accessibilityLabel={`Salta ${name}`} style={({ pressed }) => [styles.button, { backgroundColor: theme.fill }, pressed && styles.pressed]}>
          <AppText weight="600">Salta</AppText>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: { gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, borderCurve: 'continuous', marginBottom: Spacing.sm },
  text: { paddingHorizontal: 2 },
  buttons: { flexDirection: 'row', gap: Spacing.sm },
  button: { flex: 1, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
});
