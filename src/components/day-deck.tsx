import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Radius, Spacing } from '@/constants/theme';
import type { Program } from '@/db/programs';
import { useTheme } from '@/hooks/use-theme';
import { muscleLabel } from '@/lib/exercises';
import { countLabel } from '@/lib/format';
import { haptics } from '@/services/haptics';

import { AppText } from './app-text';
import { Button } from './button';
import { DayBadge } from './day-badge';
import { Icon } from './icon';
import { MenuButton } from './menu-button';

/** How far each sheet behind shows below the one in front of it. */
const PEEK = 8;
/** How much narrower each sheet behind is, on each side. */
const INSET = 12;
const DAY_IN = FadeIn.duration(200);

type DayDeckProps = {
  program: Program;
  /** The next day. */
  dayId: number;
  /** A day picked from the menu: save it as the next one. */
  onPick: (dayId: number) => void;
  onStart: (dayId: number) => void;
  onChangeProgram: () => void;
  /** When it is planned in the calendar: "Oggi", "Domani", "Venerdì". */
  when?: string | null;
};

/**
 * The next workout, drawn as the top sheet of a pile: the program's other days show as edges
 * under it, only as a picture of what is in the program. ⌃⌄ lists the days to pick the next one,
 * which simply takes its place.
 */
export function DayDeck({ program, dayId, onPick, onStart, onChangeProgram, when }: DayDeckProps) {
  const theme = useTheme();
  const day = program.days.find((d) => d.id === dayId) ?? program.days[0];
  const behind = Math.min(program.days.length - 1, 2);

  return (
    <View style={{ paddingBottom: PEEK * behind }}>
      {/* The farthest edge first, so the nearer one lies over it. */}
      {Array.from({ length: behind }, (_, i) => behind - i).map((place) => (
        <View
          key={place}
          pointerEvents="none"
          style={[
            styles.edge,
            { top: PEEK * place, bottom: PEEK * (behind - place), left: INSET * place, right: INSET * place, backgroundColor: theme.card },
          ]}>
          <View style={[styles.veil, { backgroundColor: theme.background, opacity: 0.25 * place }]} />
        </View>
      ))}
      <View style={[styles.sheet, { backgroundColor: theme.card }]}>
        <View style={styles.top}>
          {/* Today's, as the calendar has it, stands out: it is what to do now. */}
          <AppText variant="footnote" weight="600" tone={when === 'Oggi' ? 'accent' : 'textSecondary'} style={styles.flex} numberOfLines={1}>
            {`${(when ?? 'Prossimo').toUpperCase()} · ${program.name.toUpperCase()}`}
          </AppText>
          {/* ⌃⌄ in the corner: the program's days, to pick the next one, and other programs. */}
          <MenuButton
            icon="chevron.up.chevron.down"
            accessibilityLabel={`Prossimo giorno: ${day.name}. Scegli un altro giorno`}
            groups={[
              {
                title: `Giorni di ${program.name}`,
                actions: program.days.map((d) => ({
                  label: d.name,
                  icon: d.icon,
                  checked: d.id === day.id,
                  onPress: () => {
                    if (d.id === day.id) return;
                    haptics.selection();
                    onPick(d.id);
                  },
                })),
              },
              { actions: [{ label: 'Cambia scheda', icon: 'list.bullet.rectangle', onPress: onChangeProgram }] },
            ]}>
            <View style={[styles.switch, { backgroundColor: theme.fill }]}>
              <Icon name="chevron.up.chevron.down" size={16} tone="accent" weight="semibold" />
            </View>
          </MenuButton>
        </View>
        {/* A day picked comes in with a short fade, nothing more. */}
        <Animated.View key={day.id} entering={DAY_IN} style={styles.words}>
          <View style={styles.name}>
            <DayBadge icon={day.icon} size={40} />
            <AppText variant="title" numberOfLines={1} style={styles.shrink}>
              {day.name}
            </AppText>
          </View>
          <AppText variant="subhead" tone="textSecondary" numberOfLines={1}>
            {[countLabel(day.exerciseCount, 'esercizio', 'esercizi'), day.muscles.map(muscleLabel).join(', ')].filter(Boolean).join(' · ')}
          </AppText>
        </Animated.View>
        <View style={styles.button}>
          <Button title="Inizia" onPress={() => onStart(day.id)} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  sheet: { padding: Spacing.lg, gap: Spacing.xs, borderRadius: Radius.lg, borderCurve: 'continuous', boxShadow: '0 1px 4px rgba(0, 0, 0, 0.06)' },
  edge: { position: 'absolute', borderRadius: Radius.lg, borderCurve: 'continuous', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)' },
  veil: { ...StyleSheet.absoluteFill, borderRadius: Radius.lg, borderCurve: 'continuous' },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 32 },
  // Over the sheet's padding, so the circle sits in its corner without pushing the name down.
  switch: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginVertical: -Spacing.xs },
  words: { gap: Spacing.xs },
  name: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.xs },
  button: { marginTop: Spacing.md },
});
