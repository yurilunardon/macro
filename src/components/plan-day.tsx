import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';
import type { ActivityType, AgendaItem } from '@/lib/calendar';

import { AppText } from './app-text';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

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
  return o.title ?? types.get(o.typeId)?.name ?? 'Attività';
}

const styles = StyleSheet.create({
  ringCenter: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  ringText: { fontSize: 15, lineHeight: 18 },
});
