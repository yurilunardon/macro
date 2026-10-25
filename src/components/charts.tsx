import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { daysBetween, formatShortDate, formatWeekdayInitial, type DateKey } from '@/lib/dates';
import { formatKcal, formatNumber } from '@/lib/format';

import { AppText } from './app-text';

function useWidth() {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  return { width, onLayout };
}

type WeightPoint = { date: DateKey; kg: number };

/** Weight over time, with x proportional to the date so gaps between weigh-ins are visible. */
export function WeightChart({ points, from, to }: { points: readonly WeightPoint[]; from: DateKey; to: DateKey }) {
  const theme = useTheme();
  const { width, onLayout } = useWidth();
  const height = 180;
  const pad = { top: 12, bottom: 24, left: 36, right: 8 };

  if (points.length === 0) {
    return (
      <View style={[styles.empty, { height }]}>
        <AppText tone="textSecondary" align="center">
          Nessun peso registrato in questo periodo
        </AppText>
      </View>
    );
  }

  const values = points.map((p) => p.kg);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 2) {
    const mid = (max + min) / 2;
    min = mid - 1;
    max = mid + 1;
  }
  const span = Math.max(1, daysBetween(from, to));
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const x = (date: DateKey) => pad.left + (daysBetween(from, date) / span) * plotW;
  const y = (kg: number) => pad.top + (1 - (kg - min) / (max - min)) * plotH;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.date).toFixed(1)},${y(p.kg).toFixed(1)}`).join(' ');
  const gridValues = [max, (max + min) / 2, min];

  return (
    <View onLayout={onLayout} style={{ height }}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          {gridValues.map((v) => (
            <Line key={v} x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} stroke={theme.separator} strokeWidth={1} />
          ))}
          {gridValues.map((v) => (
            <SvgText key={`l${v}`} x={pad.left - 6} y={y(v) + 4} fontSize={11} fill={theme.textSecondary} textAnchor="end">
              {formatNumber(v, 1)}
            </SvgText>
          ))}
          <SvgText x={pad.left} y={height - 6} fontSize={11} fill={theme.textSecondary}>
            {formatShortDate(from)}
          </SvgText>
          <SvgText x={width - pad.right} y={height - 6} fontSize={11} fill={theme.textSecondary} textAnchor="end">
            {formatShortDate(to)}
          </SvgText>
          <Path d={path} stroke={theme.accent} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
          {points.length <= 40
            ? points.map((p) => (
                <Circle key={p.date} cx={x(p.date)} cy={y(p.kg)} r={3.5} fill={theme.card} stroke={theme.accent} strokeWidth={2} />
              ))
            : null}
        </Svg>
      ) : null}
    </View>
  );
}

type DayBar = { date: DateKey; kcal: number };

/** Kcal per day as bars, with a dashed line at the target. Bars over target are red. */
export function CaloriesChart({ days, target }: { days: readonly DayBar[]; target: number }) {
  const theme = useTheme();
  const { width, onLayout } = useWidth();
  const height = 160;
  const pad = { top: 16, bottom: 22 };
  const maxValue = Math.max(target * 1.2, ...days.map((d) => d.kcal), 1);
  const plotH = height - pad.top - pad.bottom;
  const slot = days.length > 0 ? width / days.length : 0;
  const barW = Math.min(28, slot * 0.6);
  const y = (v: number) => pad.top + (1 - v / maxValue) * plotH;

  return (
    <View
      onLayout={onLayout}
      style={{ height }}
      accessible
      accessibilityLabel={days.map((d) => `${formatShortDate(d.date)}: ${formatKcal(d.kcal)} kcal`).join(', ')}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          {days.map((d, i) => {
            const top = y(d.kcal);
            const over = target > 0 && d.kcal > target * 1.05;
            return (
              <Rect
                key={d.date}
                x={i * slot + (slot - barW) / 2}
                y={top}
                width={barW}
                height={Math.max(0, pad.top + plotH - top)}
                rx={4}
                fill={d.kcal === 0 ? theme.track : over ? theme.danger : theme.accent}
              />
            );
          })}
          {target > 0 ? (
            <Line x1={0} x2={width} y1={y(target)} y2={y(target)} stroke={theme.textSecondary} strokeWidth={1} strokeDasharray="4 4" />
          ) : null}
          {days.map((d, i) => (
            <SvgText
              key={`d${d.date}`}
              x={i * slot + slot / 2}
              y={height - 6}
              fontSize={11}
              fill={theme.textSecondary}
              textAnchor="middle">
              {formatWeekdayInitial(d.date)}
            </SvgText>
          ))}
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg },
});
