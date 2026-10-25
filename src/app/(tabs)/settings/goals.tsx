import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { FieldRow, Segmented } from '@/components/form';
import { Icon } from '@/components/icon';
import { ScreenScroll } from '@/components/screen';
import { Spacing } from '@/constants/theme';
import { getLatestWeight } from '@/db/body';
import { useLiveQuery } from '@/db/live';
import { getSetting, getTargets, setSetting } from '@/db/settings';
import { formatKcal, numberToInput } from '@/lib/format';
import {
  ACTIVITY_LEVELS,
  GOAL_TYPES,
  ageInYear,
  basalMetabolicRate,
  computeTargets,
  parseProfile,
  parseTargets,
  totalDailyEnergy,
  type Profile,
  type ProfileFields,
  type TargetFields,
  type Targets,
} from '@/lib/goals';
import { kcalFromMacros } from '@/lib/nutrition';

export default function GoalsScreen() {
  const { data } = useLiveQuery('goals-form', async (database) => {
    const [profile, goals, weight] = await Promise.all([
      getSetting(database, 'profile'),
      getTargets(database),
      getLatestWeight(database),
    ]);
    return { profile, targets: goals.targets, latestWeight: weight?.kg ?? null };
  });

  if (!data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  // Mounted once with the saved values, so later reloads never overwrite what is being typed.
  return <GoalsForm profile={data.profile} targets={data.targets} latestWeight={data.latestWeight} />;
}

function profileFields(profile: Profile | null, latestWeight: number | null): ProfileFields {
  return {
    sex: profile?.sex ?? 'male',
    birthYear: profile ? String(profile.birthYear) : '',
    heightCm: profile ? numberToInput(profile.heightCm, 0) : '',
    weightKg: numberToInput(latestWeight ?? profile?.weightKg ?? null),
    activity: profile?.activity ?? 'moderate',
    goal: profile?.goal ?? 'maintain',
    proteinPerKg: numberToInput(profile?.proteinPerKg ?? 2),
    fatPercent: numberToInput(profile?.fatPercent ?? 25, 0),
  };
}

function targetFields(t: Targets): TargetFields {
  return { kcal: String(t.kcal), protein: String(t.protein), carbs: String(t.carbs), fat: String(t.fat) };
}

function GoalsForm({
  profile,
  targets,
  latestWeight,
}: {
  profile: Profile | null;
  targets: Targets;
  latestWeight: number | null;
}) {
  const db = useSQLiteContext();
  const router = useRouter();
  const year = new Date().getFullYear();
  const [pf, setPf] = useState<ProfileFields>(() => profileFields(profile, latestWeight));
  const [tf, setTf] = useState<TargetFields>(() => targetFields(targets));
  const [showProfileErrors, setShowProfileErrors] = useState(false);
  const [showTargetErrors, setShowTargetErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  const parsedProfile = parseProfile(pf, year);
  const parsedTargets = parseTargets(tf);
  const setP = (key: keyof ProfileFields) => (value: string) => setPf((f) => ({ ...f, [key]: value }));
  const setT = (key: keyof TargetFields) => (value: string) => setTf((f) => ({ ...f, [key]: value }));
  const pInvalid = (key: 'birthYear' | 'heightCm' | 'weightKg' | 'proteinPerKg' | 'fatPercent') =>
    showProfileErrors && parsedProfile.invalid.has(key);
  const tInvalid = (key: keyof Targets) => showTargetErrors && parsedTargets.invalid.has(key);

  const energy = parsedProfile.profile
    ? {
        bmr: basalMetabolicRate(parsedProfile.profile, ageInYear(parsedProfile.profile.birthYear, year)),
        tdee: totalDailyEnergy(parsedProfile.profile, ageInYear(parsedProfile.profile.birthYear, year)),
      }
    : null;
  const macroKcal = parsedTargets.targets
    ? kcalFromMacros(parsedTargets.targets.protein, parsedTargets.targets.carbs, parsedTargets.targets.fat)
    : null;
  const mismatch =
    parsedTargets.targets && macroKcal !== null && Math.abs(macroKcal - parsedTargets.targets.kcal) > 50;

  const calculate = () => {
    setShowProfileErrors(true);
    if (!parsedProfile.profile) return;
    void Haptics.selectionAsync();
    setTf(targetFields(computeTargets(parsedProfile.profile, year)));
  };

  const save = async () => {
    setShowTargetErrors(true);
    if (!parsedTargets.targets) return;
    setSaving(true);
    try {
      await setSetting(db, 'targets', parsedTargets.targets);
      if (parsedProfile.profile) await setSetting(db, 'profile', parsedProfile.profile);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenScroll>
      <AppText tone="textSecondary" style={styles.intro}>
        Compila i tuoi dati e tocca «Calcola»: stimo il fabbisogno con la formula di Mifflin-St Jeor. Puoi poi
        ritoccare i numeri a mano.
      </AppText>

      <SectionTitle>Su di te</SectionTitle>
      <Segmented
        options={[
          { key: 'male', label: 'Uomo' },
          { key: 'female', label: 'Donna' },
        ]}
        value={pf.sex}
        onChange={(sex) => setPf((f) => ({ ...f, sex }))}
      />
      <View style={styles.gap} />
      <ListGroup>
        <FieldRow label="Anno di nascita" value={pf.birthYear} onChangeText={setP('birthYear')} placeholder="1995" numeric invalid={pInvalid('birthYear')} />
        <FieldRow label="Altezza" value={pf.heightCm} onChangeText={setP('heightCm')} placeholder="175" suffix="cm" numeric invalid={pInvalid('heightCm')} />
        <FieldRow label="Peso" value={pf.weightKg} onChangeText={setP('weightKg')} placeholder="75" suffix="kg" numeric invalid={pInvalid('weightKg')} />
      </ListGroup>

      <SectionTitle>Attività</SectionTitle>
      <ListGroup>
        {ACTIVITY_LEVELS.map((a) => (
          <Row
            key={a.key}
            title={a.label}
            subtitle={a.detail}
            onPress={() => setPf((f) => ({ ...f, activity: a.key }))}
            chevron={false}
            detail={pf.activity === a.key ? <Icon name="checkmark" size={17} tone="accent" weight="semibold" /> : undefined}
          />
        ))}
      </ListGroup>

      <SectionTitle>Obiettivo</SectionTitle>
      <ListGroup>
        {GOAL_TYPES.map((g) => (
          <Row
            key={g.key}
            title={g.label}
            onPress={() => setPf((f) => ({ ...f, goal: g.key }))}
            chevron={false}
            detail={pf.goal === g.key ? <Icon name="checkmark" size={17} tone="accent" weight="semibold" /> : undefined}
          />
        ))}
      </ListGroup>

      <SectionTitle>Ripartizione</SectionTitle>
      <ListGroup>
        <FieldRow label="Proteine" value={pf.proteinPerKg} onChangeText={setP('proteinPerKg')} suffix="g/kg" numeric invalid={pInvalid('proteinPerKg')} />
        <FieldRow label="Grassi" value={pf.fatPercent} onChangeText={setP('fatPercent')} suffix="%" numeric invalid={pInvalid('fatPercent')} />
      </ListGroup>
      <SectionFooter>
        Chi si allena con i pesi di solito sta tra 1,6 e 2,2 g di proteine per kg. I carboidrati coprono le calorie che restano.
      </SectionFooter>

      <View style={styles.button}>
        <Button title="Calcola" variant="tinted" onPress={calculate} />
      </View>
      {energy ? (
        <SectionFooter>
          {`Metabolismo basale ${formatKcal(energy.bmr)} kcal · consumo giornaliero stimato ${formatKcal(energy.tdee)} kcal.`}
        </SectionFooter>
      ) : showProfileErrors ? (
        <SectionFooter>
          <AppText variant="footnote" tone="danger">
            Controlla i campi in rosso.
          </AppText>
        </SectionFooter>
      ) : null}

      <SectionTitle>Obiettivi giornalieri</SectionTitle>
      <ListGroup>
        <FieldRow label="Calorie" value={tf.kcal} onChangeText={setT('kcal')} suffix="kcal" numeric invalid={tInvalid('kcal')} />
        <FieldRow label="Proteine" value={tf.protein} onChangeText={setT('protein')} suffix="g" numeric invalid={tInvalid('protein')} />
        <FieldRow label="Carboidrati" value={tf.carbs} onChangeText={setT('carbs')} suffix="g" numeric invalid={tInvalid('carbs')} />
        <FieldRow label="Grassi" value={tf.fat} onChangeText={setT('fat')} suffix="g" numeric invalid={tInvalid('fat')} />
      </ListGroup>
      {mismatch && macroKcal !== null ? (
        <SectionFooter>{`Con questi macro mangeresti circa ${formatKcal(macroKcal)} kcal: diverso dall’obiettivo di calorie.`}</SectionFooter>
      ) : null}

      <View style={styles.button}>
        <Button title="Salva obiettivi" onPress={() => void save()} loading={saving} />
      </View>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  intro: { paddingHorizontal: Spacing.xs },
  gap: { height: Spacing.md },
  button: { paddingTop: Spacing.xl },
});
