import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ListGroup, SectionFooter, SectionTitle } from '@/components/card';
import { FieldRow, Segmented } from '@/components/form';
import { Spacing } from '@/constants/theme';
import { useLiveQuery } from '@/db/live';
import { getLimits, setSetting } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { numberToInput, parseDecimal } from '@/lib/format';
import { isValidLimit, KCAL_PER_GRAM, LIMIT_KEYS, LIMIT_LABELS, type LimitKey, type NutrientLimit, type NutrientLimits } from '@/lib/limits';
import { haptics } from '@/services/haptics';

const UNITS = [
  { key: 'grams', label: 'Grammi' },
  { key: 'percent', label: '% delle kcal' },
] as const;

/** Where the usual values come from: the WHO and the EU's reference intakes on labels. */
const REFERENCE: Record<LimitKey, string> = {
  sugars: 'UE: 90 g di zuccheri totali, come in etichetta. OMS: 10% delle kcal, ma solo per quelli aggiunti.',
  satFat: 'OMS: meno del 10% delle kcal. UE: 20 g.',
  salt: 'OMS: meno di 5 g. UE: 6 g.',
};

/** What a change of unit starts from: 90 g would otherwise become 90% of the calories. */
const USUAL: Partial<Record<LimitKey, Record<NutrientLimit['unit'], string>>> = {
  sugars: { grams: '90', percent: '10' },
  satFat: { grams: '20', percent: '10' },
};

/** The day's ceilings on sugars, saturated fat and salt, in grams or as a share of the calories. */
export default function LimitsSheet() {
  const theme = useTheme();
  const { data } = useLiveQuery('limits-form', getLimits, ['settings']);
  if (!data) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }
  return <LimitsForm stored={data} />;
}

type Fields = Record<LimitKey, { unit: NutrientLimit['unit']; text: string }>;

function LimitsForm({ stored }: { stored: NutrientLimits }) {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const [fields, setFields] = useState<Fields>(() => ({
    sugars: { unit: stored.sugars.unit, text: numberToInput(stored.sugars.value) },
    satFat: { unit: stored.satFat.unit, text: numberToInput(stored.satFat.value) },
    salt: { unit: stored.salt.unit, text: numberToInput(stored.salt.value) },
  }));

  const limitOf = (key: LimitKey): NutrientLimit => ({ unit: fields[key].unit, value: parseDecimal(fields[key].text) ?? Number.NaN });
  const valid = LIMIT_KEYS.every((key) => isValidLimit(limitOf(key)));

  const save = async () => {
    if (!valid) return;
    await setSetting(db, 'nutrientLimits', { sugars: limitOf('sugars'), satFat: limitOf('satFat'), salt: limitOf('salt') });
    haptics.success();
    router.back();
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets>
      <AppText variant="title2" style={styles.title}>
        Limiti del giorno
      </AppText>
      {LIMIT_KEYS.map((key) => {
        const { unit, text } = fields[key];
        return (
          <View key={key}>
            <SectionTitle>{LIMIT_LABELS[key]}</SectionTitle>
            <ListGroup>
              {/* Salt has no calories: only grams. */}
              {KCAL_PER_GRAM[key] !== undefined ? (
                <View style={styles.units}>
                  <Segmented
                    options={UNITS}
                    value={unit}
                    onChange={(next) => setFields({ ...fields, [key]: { unit: next, text: USUAL[key]?.[next] ?? text } })}
                  />
                </View>
              ) : null}
              <FieldRow
                numeric
                label="Limite"
                value={text}
                suffix={unit === 'percent' ? '%' : 'g'}
                invalid={!isValidLimit(limitOf(key))}
                selectTextOnFocus
                onChangeText={(next) => setFields({ ...fields, [key]: { unit, text: next } })}
              />
            </ListGroup>
            <SectionFooter>{REFERENCE[key]}</SectionFooter>
          </View>
        );
      })}
      <Button title="Salva" disabled={!valid} onPress={() => void save()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.lg, paddingTop: Spacing.xl, paddingBottom: Spacing.xxl * 2, gap: Spacing.md },
  title: { marginBottom: Spacing.xs },
  units: { padding: Spacing.md },
});
