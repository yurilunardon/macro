import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/app-text';
import { BodyFigure } from '@/components/body-figure';
import { MUSCLE_SHEET, type BodyFigureHandle, type BodyFigureState } from '@/components/body-figure.types';
import { useTabBarInset } from '@/components/tab-bar';
import { Spacing } from '@/constants/theme';
import { useLiveQuery } from '@/db/live';
import { programCheckScreen } from '@/db/program-check';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { muscleLabel, type Muscle } from '@/lib/exercises';
import { missingLabel } from '@/lib/program-check';
import { haptics } from '@/services/haptics';

/**
 * A program on the body: each muscle green, orange or red by the sets it gets in a week. Only the
 * figure; a tap brings the names of the muscles that lack work, and a name or a muscle opens it.
 */
export default function BodyScreen() {
  const router = useRouter();
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const today = useToday();
  const insets = useSafeAreaInsets();
  const header = useHeaderHeight();
  const tabBar = useTabBarInset();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Number(params.id);
  const screen = programCheckScreen(id, today);
  const { data } = useLiveQuery(screen.key, screen.query, screen.topics);
  const figure = useRef<BodyFigureHandle>(null);
  const [failed, setFailed] = useState(false);

  // Back from the muscle's sheet: the whole body again.
  const focused = useIsFocused();
  useEffect(() => {
    if (focused) figure.current?.select(null);
  }, [focused]);

  const muscles = data?.muscles;
  const state = useMemo<BodyFigureState>(() => {
    const levels: BodyFigureState['levels'] = {};
    const labels: BodyFigureState['labels'] = {};
    for (const m of muscles ?? []) {
      levels[m.muscle] = m.level;
      labels[m.muscle] = { name: muscleLabel(m.muscle), note: missingLabel(m.missing, { short: true }) };
    }
    return {
      dark,
      fg: theme.text,
      muted: theme.textSecondary,
      text: { good: theme.accent, low: theme.warning, bad: theme.danger },
      levels,
      labels,
      top: header,
      bottom: tabBar + insets.bottom + CREDIT,
      sheet: MUSCLE_SHEET,
      hint: 'Tocca l’omino',
    };
  }, [muscles, dark, theme, header, tabBar, insets.bottom]);

  const open = (muscle: Muscle) => {
    haptics.selection();
    router.push({ pathname: '/muscle-check', params: { program: id, muscle } });
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      {failed ? (
        <View style={styles.center}>
          <AppText tone="textSecondary" align="center">
            Qui il 3D non parte.
          </AppText>
        </View>
      ) : muscles ? (
        <BodyFigure ref={figure} state={state} onSelect={open} onFail={() => setFailed(true)} />
      ) : null}
      {/* The model's licence asks for its authors to be named. */}
      <AppText variant="caption" tone="textTertiary" align="center" pointerEvents="none" style={[styles.credit, { bottom: tabBar + insets.bottom }]}>
        Modello: BodyParts3D, © DBCLS, CC BY-SA 2.1 JP
      </AppText>
    </View>
  );
}

const CREDIT = 20;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  credit: { position: 'absolute', left: 0, right: 0, height: CREDIT },
});
