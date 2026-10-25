import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatKcal } from '@/lib/format';

import { AppText } from './app-text';

/** 0…1, or more than 1 when over target. Zero targets count as no progress. */
export function ratio(value: number, target: number): number {
  return target > 0 ? Math.max(0, value / target) : 0;
}

type ProgressBarProps = { value: number; target: number; color: string; height?: number };

export function ProgressBar({ value, target, color, height = 6 }: ProgressBarProps) {
  const theme = useTheme();
  const r = ratio(value, target);
  const over = r > 1.05;
  return (
    <View style={[styles.track, { height, backgroundColor: theme.track }]}>
      <View
        style={[
          styles.fill,
          { width: `${Math.min(1, r) * 100}%`, backgroundColor: over ? theme.danger : color },
        ]}
      />
    </View>
  );
}

type CalorieRingProps = { eaten: number; target: number; size?: number };

/** Ring filled by eaten / target, with the remaining kcal in the middle. */
export function CalorieRing({ eaten, target, size = 148 }: CalorieRingProps) {
  const theme = useTheme();
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const r = ratio(eaten, target);
  const remaining = target - eaten;
  const over = remaining < 0;
  const color = over ? theme.danger : theme.accent;

  return (
    <View
      style={{ width: size, height: size }}
      accessible
      accessibilityLabel={
        over
          ? `${formatKcal(-remaining)} chilocalorie oltre l'obiettivo`
          : `${formatKcal(remaining)} chilocalorie rimanenti su ${formatKcal(target)}`
      }>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={theme.track} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - Math.min(1, r))}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.ringCenter} pointerEvents="none">
        <AppText variant="title" numeric tone={over ? 'danger' : 'text'}>
          {formatKcal(Math.abs(remaining))}
        </AppText>
        <AppText variant="footnote" tone="textSecondary">
          {over ? 'kcal in più' : 'kcal rimaste'}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: '100%', borderRadius: Radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.pill },
  ringCenter: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
