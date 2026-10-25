import { useRouter } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { Pressable, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useClock } from '@/hooks/use-clock';
import { formatDuration } from '@/lib/training';
import { useRestTimer } from '@/services/rest-timer';

import { AppText } from './app-text';
import { Icon } from './icon';

/**
 * The workout in progress, above the tab bar like the mini player in Music: elapsed time, or the
 * rest countdown while resting. Tapping it brings the workout back.
 */
export function WorkoutAccessory({ name, startedAt }: { name: string; startedAt: string }) {
  const router = useRouter();
  const placement = NativeTabs.BottomAccessory.usePlacement();
  const rest = useRestTimer();
  const now = useClock(1000);
  const resting = rest !== null && rest.endsAt > now;
  const elapsed = (now - new Date(startedAt).getTime()) / 1000;
  const time = resting ? formatDuration((rest.endsAt - now) / 1000) : formatDuration(elapsed);

  return (
    <Pressable
      onPress={() => router.push('/workout')}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${resting ? `recupero ${time}` : `in corso da ${time}`}. Apri l’allenamento`}
      style={styles.row}>
      <Icon name={resting ? 'timer' : 'figure.strengthtraining.traditional'} size={18} tone={resting ? 'warning' : 'accent'} />
      {placement === 'inline' ? (
        <AppText variant="subhead" weight="600" numeric>
          {time}
        </AppText>
      ) : (
        <>
          <View style={styles.flex}>
            <AppText variant="subhead" weight="600" numberOfLines={1}>
              {name}
            </AppText>
            <AppText variant="caption" tone="textSecondary" numberOfLines={1}>
              {resting ? 'Recupero' : 'Allenamento in corso'}
            </AppText>
          </View>
          <AppText variant="headline" numeric tone={resting ? 'warning' : 'text'}>
            {time}
          </AppText>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg },
  flex: { flex: 1 },
});
