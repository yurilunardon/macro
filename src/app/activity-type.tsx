import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ActivityBadge } from '@/components/activity-badge';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ListGroup, SectionFooter, SectionTitle } from '@/components/card';
import { FieldRow } from '@/components/form';
import { Icon } from '@/components/icon';
import { StepButton } from '@/components/stepper';
import { Radius, Spacing } from '@/constants/theme';
import { addActivityType, deleteActivityType, getActivityTypes, updateActivityType } from '@/db/calendar';
import { useLiveQuery } from '@/db/live';
import { useActivityColors } from '@/hooks/use-activity-colors';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { ACTIVITY_COLORS, ACTIVITY_SYMBOLS, COLOR_NAMES, formatMinutes, GYM_REF, type ActivityType } from '@/lib/calendar';
import { haptics } from '@/services/haptics';
import { deleteWithUndo } from '@/services/undo';

/** A kind of activity: its name, symbol and colour in the calendar, and how long it usually lasts. */
export default function ActivityTypeScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { data: types } = useLiveQuery('activity-types', getActivityTypes, ['calendar']);
  if (!types) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }
  return <TypeForm type={id ? (types.find((t) => t.id === Number(id)) ?? null) : null} />;
}

function TypeForm({ type }: { type: ActivityType | null }) {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const colors = useActivityColors();
  const today = useToday();
  const [name, setName] = useState(type?.name ?? '');
  const [symbol, setSymbol] = useState(type?.symbol ?? 'figure.run');
  const [color, setColor] = useState(type?.color ?? 'blue');
  const [minutes, setMinutes] = useState(type?.minutes ?? 60);
  const valid = name.trim() !== '';
  const isGym = type?.ref === GYM_REF;

  const save = async () => {
    if (!valid) return;
    const input = { name, symbol, color, minutes };
    if (type) await updateActivityType(db, type.id, input);
    else await addActivityType(db, input);
    haptics.success();
    router.back();
  };

  const remove = () => {
    if (!type) return;
    router.back();
    deleteWithUndo({ key: `activity-type:${type.id}`, title: `${type.name} eliminata`, run: () => deleteActivityType(db, type.id, today) });
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets>
      <Stack.Screen options={{ title: type ? type.name : 'Nuovo tipo' }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Annulla" onPress={() => router.back()} />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="checkmark" variant="prominent" accessibilityLabel="Salva" disabled={!valid} onPress={() => void save()} />
      </Stack.Toolbar>

      <View style={styles.preview}>
        <ActivityBadge symbol={symbol} color={color} size={64} />
      </View>

      <ListGroup>
        <FieldRow label="Nome" value={name} onChangeText={setName} placeholder="Es. Corsa" autoCapitalize="sentences" autoFocus={!type} />
        <View style={styles.row}>
          <AppText style={styles.flex}>Durata</AppText>
          <StepButton symbol="minus" label="15 minuti in meno" disabled={minutes <= 15} onPress={() => setMinutes(Math.max(15, minutes - 15))} />
          <AppText numeric style={styles.value}>
            {formatMinutes(minutes)}
          </AppText>
          <StepButton symbol="plus" label="15 minuti in più" disabled={minutes >= 600} onPress={() => setMinutes(Math.min(600, minutes + 15))} />
        </View>
      </ListGroup>
      <SectionFooter>Quella abituale: vale per il tempo nel report quando un’attività non ha la sua.</SectionFooter>

      <SectionTitle>Colore</SectionTitle>
      <View style={[styles.palette, { backgroundColor: theme.card }]}>
        {ACTIVITY_COLORS.map((c) => (
          <Pressable
            key={c}
            onPress={() => {
              haptics.selection();
              setColor(c);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: c === color }}
            accessibilityLabel={COLOR_NAMES[c]}
            style={[styles.swatchRing, { borderColor: c === color ? colors[c] : 'transparent' }]}>
            <View style={[styles.swatch, { backgroundColor: colors[c] }]} />
          </Pressable>
        ))}
      </View>

      <SectionTitle>Simbolo</SectionTitle>
      <View style={[styles.symbols, { backgroundColor: theme.card }]}>
        {ACTIVITY_SYMBOLS.map((s) => {
          const on = s === symbol;
          return (
            <Pressable
              key={s}
              onPress={() => {
                haptics.selection();
                setSymbol(s);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={[styles.symbol, { backgroundColor: on ? colors[color] : theme.fill }]}>
              <Icon name={s} size={22} color={on ? '#FFFFFF' : theme.text} />
            </Pressable>
          );
        })}
      </View>

      {type && !isGym ? (
        <View style={styles.actions}>
          <Button title="Elimina tipo" variant="destructive" onPress={remove} />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl * 2 },
  flex: { flex: 1 },
  preview: { alignItems: 'center', paddingVertical: Spacing.md, marginBottom: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 52, paddingHorizontal: Spacing.lg },
  value: { minWidth: 92, textAlign: 'center' },
  palette: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
  },
  swatchRing: { width: 36, height: 36, borderRadius: 18, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 26, height: 26, borderRadius: 13 },
  // Twenty symbols, five to a row.
  symbols: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
  },
  symbol: { width: '18%', aspectRatio: 1, borderRadius: 14, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  actions: { paddingTop: Spacing.xl },
});
