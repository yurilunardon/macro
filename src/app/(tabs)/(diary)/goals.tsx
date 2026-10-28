import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card, ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { FieldRow, Segmented } from '@/components/form';
import { Icon } from '@/components/icon';
import { ScreenScroll } from '@/components/screen';
import { Spacing } from '@/constants/theme';
import { getLatestWeight, getWeightsSince } from '@/db/body';
import { getDayPlans, getTrainingSettings, setTrainingSettings, type TrainingSettings } from '@/db/days';
import { getDailyTotals } from '@/db/entries';
import { useLiveQuery } from '@/db/live';
import { getSetting, getTargets, setSetting } from '@/db/settings';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { lastDays } from '@/lib/dates';
import { estimateExpenditure } from '@/lib/expenditure';
import { formatKcal, formatNumber, numberToInput } from '@/lib/format';
import {
  ACTIVITY_LEVELS,
  GOAL_TYPES,
  ageInYear,
  basalMetabolicRate,
  computeTargets,
  deriveRestTargets,
  parseProfile,
  parseTargets,
  targetsFromExpenditure,
  totalDailyEnergy,
  type Profile,
  type ProfileFields,
  type TargetFields,
  type Targets,
  WEEKDAYS,
} from '@/lib/goals';
import { kcalFromMacros } from '@/lib/nutrition';
import { haptics } from '@/services/haptics';

export default function GoalsScreen() {
  const { data } = useLiveQuery('goals-form', async (database) => {
    const [profile, goals, weight, training] = await Promise.all([
      getSetting(database, 'profile'),
      getTargets(database),
      getLatestWeight(database),
      getTrainingSettings(database),
    ]);
    return { profile, targets: goals.targets, latestWeight: weight?.kg ?? null, training };
  }, ['settings', 'body']);

  if (!data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  // Mounted once with the saved values, so later reloads never overwrite what is being typed.
  return (
    <GoalsForm
      profile={data.profile}
      targets={data.targets}
      latestWeight={data.latestWeight}
      training={data.training}
    />
  );
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
  training,
}: {
  profile: Profile | null;
  targets: Targets;
  latestWeight: number | null;
  training: TrainingSettings;
}) {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const year = new Date().getFullYear();
  const [pf, setPf] = useState<ProfileFields>(() => profileFields(profile, latestWeight));
  const [tf, setTf] = useState<TargetFields>(() => targetFields(targets));
  const [showProfileErrors, setShowProfileErrors] = useState(false);
  const [showTargetErrors, setShowTargetErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [split, setSplit] = useState(training.restTargets !== null);
  const [weekdays, setWeekdays] = useState<number[]>(training.trainingWeekdays);
  const [rf, setRf] = useState<TargetFields>(() => targetFields(training.restTargets ?? deriveRestTargets(targets)));

  const parsedProfile = parseProfile(pf, year);
  const parsedTargets = parseTargets(tf);
  const setP = (key: keyof ProfileFields) => (value: string) => setPf((f) => ({ ...f, [key]: value }));
  const setT = (key: keyof TargetFields) => (value: string) => setTf((f) => ({ ...f, [key]: value }));
  const pInvalid = (key: 'birthYear' | 'heightCm' | 'weightKg' | 'proteinPerKg' | 'fatPercent') =>
    showProfileErrors && parsedProfile.invalid.has(key);
  const tInvalid = (key: keyof Targets) => showTargetErrors && parsedTargets.invalid.has(key);
  const parsedRest = parseTargets(rf);
  const setR = (key: keyof TargetFields) => (value: string) => setRf((f) => ({ ...f, [key]: value }));
  const rInvalid = (key: keyof Targets) => showTargetErrors && split && parsedRest.invalid.has(key);
  const noTrainingDays = split && weekdays.length === 0;

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
    haptics.selection();
    const computed = computeTargets(parsedProfile.profile, year);
    setTf(targetFields(computed));
    setRf(targetFields(deriveRestTargets(computed)));
  };

  const toggleSplit = (enabled: boolean) => {
    setSplit(enabled);
    // Start rest days from the training targets typed so far.
    if (enabled && parsedTargets.targets) setRf(targetFields(deriveRestTargets(parsedTargets.targets)));
  };

  const toggleWeekday = (day: number) => {
    haptics.selection();
    setWeekdays((days) => (days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort()));
  };

  const save = async () => {
    setShowTargetErrors(true);
    if (!parsedTargets.targets) return;
    if (split && (!parsedRest.targets || noTrainingDays)) return;
    setSaving(true);
    try {
      await setSetting(db, 'targets', parsedTargets.targets);
      await setTrainingSettings(db, {
        restTargets: split ? parsedRest.targets : null,
        trainingWeekdays: weekdays,
      });
      if (parsedProfile.profile) await setSetting(db, 'profile', parsedProfile.profile);
      haptics.success();
      router.back();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenScroll>
      <AppText tone="textSecondary" style={styles.intro}>
        Inserisci i tuoi dati e tocca Calcola. Poi puoi modificare i numeri a mano.
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
        Proteine consigliate: 1,6–2,2 g per kg. I carboidrati coprono le calorie restanti.
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

      <RealExpenditure
        profile={parsedProfile.profile ?? profile}
        onUse={(computed) => {
          haptics.selection();
          setTf(targetFields(computed));
          setRf(targetFields(deriveRestTargets(computed)));
        }}
      />

      <SectionTitle>{split ? 'Giorni di allenamento' : 'Obiettivi giornalieri'}</SectionTitle>
      <ListGroup>
        <FieldRow label="Calorie" value={tf.kcal} onChangeText={setT('kcal')} suffix="kcal" numeric invalid={tInvalid('kcal')} />
        <FieldRow label="Proteine" value={tf.protein} onChangeText={setT('protein')} suffix="g" numeric invalid={tInvalid('protein')} />
        <FieldRow label="Carboidrati" value={tf.carbs} onChangeText={setT('carbs')} suffix="g" numeric invalid={tInvalid('carbs')} />
        <FieldRow label="Grassi" value={tf.fat} onChangeText={setT('fat')} suffix="g" numeric invalid={tInvalid('fat')} />
      </ListGroup>
      {mismatch && macroKcal !== null ? (
        <SectionFooter>{`Con questi macro mangeresti circa ${formatKcal(macroKcal)} kcal: diverso dall’obiettivo di calorie.`}</SectionFooter>
      ) : null}

      <SectionTitle>Allenamento e riposo</SectionTitle>
      <ListGroup>
        <Row
          title="Obiettivi diversi nei giorni di riposo"
          chevron={false}
          detail={
            <Switch
              value={split}
              onValueChange={toggleSplit}
              trackColor={{ true: theme.accent }}
              accessibilityLabel="Obiettivi diversi nei giorni di riposo"
            />
          }
        />
      </ListGroup>
      {split ? (
        <>
          <View style={styles.weekdays} accessibilityRole="toolbar" accessibilityLabel="Giorni di allenamento">
            {WEEKDAYS.map((w) => {
              const selected = weekdays.includes(w.day);
              return (
                <Pressable
                  key={w.day}
                  onPress={() => toggleWeekday(w.day)}
                  accessibilityRole="checkbox"
                  accessibilityLabel={w.label}
                  accessibilityState={{ checked: selected }}
                  style={[
                    styles.weekday,
                    { backgroundColor: selected ? theme.accent : theme.card, borderColor: selected ? theme.accent : theme.separator },
                  ]}>
                  <AppText weight="600" style={{ color: selected ? theme.onAccent : theme.text }}>
                    {w.short}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          <SectionFooter>
            {noTrainingDays && showTargetErrors ? (
              <AppText variant="footnote" tone="danger">
                Scegli almeno un giorno di allenamento.
              </AppText>
            ) : (
              'Giorni in cui ti alleni.'
            )}
          </SectionFooter>

          <SectionTitle>Giorni di riposo</SectionTitle>
          <ListGroup>
            <FieldRow label="Calorie" value={rf.kcal} onChangeText={setR('kcal')} suffix="kcal" numeric invalid={rInvalid('kcal')} />
            <FieldRow label="Proteine" value={rf.protein} onChangeText={setR('protein')} suffix="g" numeric invalid={rInvalid('protein')} />
            <FieldRow label="Carboidrati" value={rf.carbs} onChangeText={setR('carbs')} suffix="g" numeric invalid={rInvalid('carbs')} />
            <FieldRow label="Grassi" value={rf.fat} onChangeText={setR('fat')} suffix="g" numeric invalid={rInvalid('fat')} />
          </ListGroup>
          <SectionFooter>
            Di solito meno carboidrati, stesse proteine e grassi.
          </SectionFooter>
          <View style={styles.button}>
            <Button
              title="Riposo = allenamento −15%"
              variant="tinted"
              compact
              disabled={!parsedTargets.targets}
              onPress={() => parsedTargets.targets && setRf(targetFields(deriveRestTargets(parsedTargets.targets)))}
            />
          </View>
        </>
      ) : null}

      <View style={styles.button}>
        <Button title="Salva obiettivi" onPress={() => void save()} loading={saving} />
      </View>
    </ScreenScroll>
  );
}

/**
 * What the body really burns, from the last four weeks of diary and weigh-ins: better than the
 * formula above once there are enough of both. "Usa" fills the targets below with it.
 */
function RealExpenditure({
  profile,
  onUse,
}: {
  profile: Pick<Profile, 'goal' | 'proteinPerKg' | 'fatPercent'> | null;
  onUse: (targets: Targets) => void;
}) {
  const today = useToday();
  const { data } = useLiveQuery(`expenditure:${today}`, async (database) => {
    const days = lastDays(today, 28);
    const [totals, plans, weights, latest] = await Promise.all([
      getDailyTotals(database, days[0], today),
      getDayPlans(database, days),
      getWeightsSince(database, days[0]),
      getLatestWeight(database),
    ]);
    const eaten = new Map(totals.map((t) => [t.date, t.kcal]));
    const intake = days.map((date) => ({ date, kcal: eaten.get(date) ?? 0, target: plans.get(date)?.targets.kcal ?? 0 }));
    return { result: estimateExpenditure(intake, weights, today), latest: latest?.kg ?? null };
  }, ['food', 'body', 'settings']);
  if (!data) return null;
  const { result, latest } = data;

  return (
    <>
      <SectionTitle>Fabbisogno reale</SectionTitle>
      <Card style={styles.card}>
        {result.ok ? (
          <>
            <View>
              <AppText variant="title" numeric>
                {`${formatKcal(result.estimate.tdee)} kcal`}
              </AppText>
              <AppText variant="subhead" tone="textSecondary">
                {`al giorno per mantenere il peso · stima ${result.estimate.confidence === 'high' ? 'affidabile' : 'indicativa'}`}
              </AppText>
            </View>
            <AppText variant="footnote" tone="textSecondary" numeric>
              {`Ultime 4 settimane: hai mangiato in media ${formatKcal(result.estimate.averageIntake)} kcal (${result.estimate.loggedDays} giorni completi) e il peso è cambiato di ${result.estimate.weeklyChange >= 0 ? '+' : '−'}${formatNumber(Math.abs(result.estimate.weeklyChange), 2)} kg a settimana (${result.estimate.weighIns} pesate).`}
            </AppText>
            <Button
              title="Usa per gli obiettivi"
              variant="tinted"
              compact
              disabled={latest === null}
              onPress={() =>
                latest !== null &&
                onUse(targetsFromExpenditure(result.estimate.tdee, latest, profile ?? { goal: 'maintain', proteinPerKg: 2, fatPercent: 25 }))
              }
            />
          </>
        ) : (
          <AppText variant="subhead" tone="textSecondary">
            {`Incrociando calorie e peso calcolo quanto consumi davvero, meglio delle formule. ${result.reason}`}
          </AppText>
        )}
      </Card>
      {result.ok ? <SectionFooter>Con l’obiettivo, le proteine e i grassi scelti sopra. Poi tocca Salva obiettivi.</SectionFooter> : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  intro: { paddingHorizontal: Spacing.xs },
  gap: { height: Spacing.md },
  button: { paddingTop: Spacing.xl },
  weekdays: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: Spacing.md },
  weekday: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
