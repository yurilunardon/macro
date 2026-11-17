import { useIsFocused } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';

import { Spacing } from '@/constants/theme';
import { useLiveQuery } from '@/db/live';
import { programCheckScreen } from '@/db/program-check';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import type { Muscle } from '@/lib/exercises';
import type { MusclePart } from '@/lib/muscle-parts';
import { worseLevel } from '@/lib/program-check';

import { AppText } from './app-text';
import { BodyFigure } from './body-figure';
import { MUSCLE_SHEET, type BodyFigureHandle, type BodyFigureState } from './body-figure.types';

const LOADING_OUT = FadeOut.duration(250);

/**
 * A program on the body: each muscle green, orange or red by the sets it gets in a week, nothing
 * else. A tap on a muscle opens it. It can be built before it is shown (`shown` false), so that
 * switching to it finds it ready.
 */
export function ProgramBody({
  programId,
  height,
  /** Where its top is on screen: the muscle's sheet, rising from the bottom, covers part of it. */
  top,
  shown,
  onOpen,
}: {
  programId: number;
  height: number;
  top: number;
  shown: boolean;
  onOpen: (muscle: Muscle, part: MusclePart | null) => void;
}) {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const today = useToday();
  const window = useWindowDimensions();
  const screen = programCheckScreen(programId, today);
  const { data } = useLiveQuery(screen.key, screen.query, screen.topics);
  const figure = useRef<BodyFigureHandle>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Back from the muscle's sheet: the whole body again.
  const focused = useIsFocused();
  useEffect(() => {
    if (focused) figure.current?.select(null);
  }, [focused]);

  const muscles = data?.muscles;
  const sheet = Math.max(0, MUSCLE_SHEET * window.height - (window.height - top - height)) / Math.max(1, height);
  const state = useMemo<BodyFigureState>(() => {
    const levels: BodyFigureState['levels'] = {};
    for (const m of muscles ?? []) {
      levels[m.muscle] = m.level;
      // A part that lacks shows, even on a muscle that is fine as a whole.
      for (const p of m.parts) levels[p.part] = worseLevel(m.level, p.level);
    }
    return { dark, levels, top: 0, bottom: 0, sheet };
  }, [muscles, dark, sheet]);

  return (
    <View style={{ height }} pointerEvents={shown ? 'auto' : 'none'}>
      {failed ? (
        <View style={styles.center}>
          <AppText tone="textSecondary" align="center">
            Qui il 3D non parte.
          </AppText>
        </View>
      ) : muscles ? (
        <View style={[styles.fill, !(shown && ready) && styles.hidden]}>
          <BodyFigure ref={figure} state={state} onSelect={onOpen} onReady={() => setReady(true)} onFail={() => setFailed(true)} />
        </View>
      ) : null}
      {shown && !ready && !failed ? (
        <Animated.View exiting={LOADING_OUT} style={styles.loading} pointerEvents="none">
          <ActivityIndicator color={theme.textSecondary} />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hidden: { opacity: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  loading: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
