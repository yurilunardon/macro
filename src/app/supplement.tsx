import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { ActionRow, ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { Chip, FieldRow } from '@/components/form';
import { Icon } from '@/components/icon';
import { MenuButton } from '@/components/menu-button';
import { StepButton } from '@/components/stepper';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { TimePicker } from '@/components/time-picker';
import { toast } from '@/components/toast';
import { WeekdayPicker } from '@/components/weekday-picker';
import { Spacing } from '@/constants/theme';
import { useLiveQuery } from '@/db/live';
import { getMoments } from '@/db/plan';
import {
  addPurchase,
  addSupplement,
  deletePurchase,
  deleteSupplement,
  getPurchases,
  getSupplement,
  getSupplements,
  getSupplementStock,
  updateSupplement,
} from '@/db/supplements';
import { useTheme } from '@/hooks/use-theme';
import { useToday } from '@/hooks/use-today';
import { parseTimeKey, timeKey } from '@/lib/calendar';
import { formatShortDate } from '@/lib/dates';
import { formatNumber, numberToInput, parseDecimal } from '@/lib/format';
import {
  costPerDose,
  DOSE_UNITS,
  formatDose,
  formatEuro,
  SCHEDULES,
  SUPPLEMENT_PRESETS,
  type DoseUnit,
  type Supplement,
  type SupplementSchedule,
} from '@/lib/supplements';
import { haptics } from '@/services/haptics';
import { ensureNotificationPermission } from '@/services/reminders';
import { deleteWithUndo, usePendingDeletes } from '@/services/undo';

/** A supplement: what, how much and when, the usual package with its price, and what is left. */
export default function SupplementScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [supplement, setSupplement] = useState<Supplement | null | undefined>(id ? undefined : null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void getSupplement(db, Number(id)).then((s) => {
      if (!cancelled) setSupplement(s);
    });
    return () => {
      cancelled = true;
    };
  }, [db, id]);

  if (supplement === undefined) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }
  return <SupplementForm supplement={supplement} />;
}

function unitLabel(unit: DoseUnit, amount: number): string {
  const names = DOSE_UNITS.find((u) => u.key === unit) ?? DOSE_UNITS[0];
  return amount === 1 ? names.one : names.many;
}

function SupplementForm({ supplement }: { supplement: Supplement | null }) {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const today = useToday();
  const pending = usePendingDeletes();

  const [name, setName] = useState(supplement?.name ?? '');
  const [dose, setDose] = useState(numberToInput(supplement?.dose ?? null, 2));
  const [unit, setUnit] = useState<DoseUnit>(supplement?.unit ?? 'g');
  const [times, setTimes] = useState(supplement?.timesPerDay ?? 1);
  const [schedule, setSchedule] = useState<SupplementSchedule>(supplement?.schedule ?? 'daily');
  const [weekdays, setWeekdays] = useState<number[]>(supplement?.weekdays ?? []);
  const [moment, setMoment] = useState<string | null>(supplement ? supplement.moment : 'morning');
  const [reminder, setReminder] = useState<string | null>(supplement?.reminder ?? null);
  const [contents, setContents] = useState(supplement?.contents ?? '');
  const [note, setNote] = useState(supplement?.note ?? '');
  const { data: moments } = useLiveQuery('moments', getMoments, ['settings']);
  const [packageAmount, setPackageAmount] = useState(numberToInput(supplement?.packageAmount ?? null, 2));
  // Prices keep their cents: 24,90, not 24,9.
  const [packagePrice, setPackagePrice] = useState(
    supplement?.packagePrice == null ? '' : supplement.packagePrice.toFixed(2).replace('.', ','),
  );

  const doseValue = parseDecimal(dose);
  const amountValue = packageAmount.trim() === '' ? null : parseDecimal(packageAmount);
  const priceValue = packagePrice.trim() === '' ? null : parseDecimal(packagePrice);
  const valid =
    name.trim() !== '' &&
    doseValue !== null &&
    doseValue > 0 &&
    (packageAmount.trim() === '' || (amountValue !== null && amountValue > 0)) &&
    (packagePrice.trim() === '' || (priceValue !== null && priceValue >= 0)) &&
    (schedule !== 'weekdays' || weekdays.length > 0);
  const each = doseValue ? costPerDose({ dose: doseValue, packageAmount: amountValue, packagePrice: priceValue }) : null;

  const { data: stock } = useLiveQuery(
    `supplement-stock:${supplement?.id ?? 'new'}:${today}`,
    async (database) => {
      if (!supplement) return null;
      const [purchases, all] = await Promise.all([getPurchases(database, supplement.id), getSupplements(database, { archived: true })]);
      const own = all.filter((s) => s.id === supplement.id);
      return { purchases, stock: (await getSupplementStock(database, own, today)).get(supplement.id) ?? null };
    },
    ['calendar'],
  );

  const applyPreset = (preset: (typeof SUPPLEMENT_PRESETS)[number]) => {
    haptics.selection();
    setName(preset.name);
    setDose(numberToInput(preset.dose, 2));
    setUnit(preset.unit);
    setSchedule(preset.schedule);
  };

  const save = async () => {
    if (!valid || doseValue === null) return;
    const input = {
      name,
      dose: doseValue,
      unit,
      timesPerDay: times,
      schedule,
      weekdays: schedule === 'weekdays' ? weekdays : [],
      // A moment, or a time of its own: never both.
      moment: schedule === 'asNeeded' ? null : moment,
      reminder: schedule === 'asNeeded' || moment !== null ? null : (reminder ?? '08:00'),
      contents,
      note,
      packageAmount: amountValue,
      packagePrice: priceValue,
    };
    if (supplement) await updateSupplement(db, supplement.id, input);
    else await addSupplement(db, input, today);
    haptics.success();
    router.back();
    // The evening reminder of the ones not taken is on from the start: ask once to send it.
    if (!supplement && schedule !== 'asNeeded' && Platform.OS === 'ios') void ensureNotificationPermission().catch(() => {});
  };

  const buy = async () => {
    if (!supplement) return;
    if (amountValue === null || priceValue === null) {
      Alert.alert('Confezione', 'Scrivi prima quanto contiene e quanto costa.');
      return;
    }
    await addPurchase(db, { supplementId: supplement.id, date: today, amount: amountValue, price: priceValue });
    haptics.success();
    toast.show('Confezione aggiunta', 'cart.fill');
  };

  const remove = () => {
    if (!supplement) return;
    router.back();
    deleteWithUndo({ key: `supplement:${supplement.id}`, title: `${supplement.name} eliminato`, run: () => deleteSupplement(db, supplement.id) });
  };

  const purchases = (stock?.purchases ?? []).filter((p) => !pending.has(`purchase:${p.id}`));
  const left = stock?.stock?.left ?? null;
  const daysLeft = stock?.stock?.daysLeft ?? null;

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets>
      <Stack.Screen options={{ title: supplement ? supplement.name : 'Nuovo integratore' }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Annulla" onPress={() => router.back()} />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="checkmark" variant="prominent" accessibilityLabel="Salva" disabled={!valid} onPress={() => void save()} />
      </Stack.Toolbar>

      {!supplement ? (
        <View style={styles.presets}>
          {SUPPLEMENT_PRESETS.map((p) => (
            <Chip key={p.name} label={p.name} selected={name === p.name} onPress={() => applyPreset(p)} />
          ))}
        </View>
      ) : null}

      <ListGroup>
        <FieldRow label="Nome" value={name} onChangeText={setName} placeholder="Es. Creatina" autoCapitalize="sentences" />
        <View style={styles.row}>
          <AppText style={styles.flex}>Dose</AppText>
          <FieldInline value={dose} onChangeText={setDose} invalid={dose !== '' && (doseValue === null || doseValue <= 0)} />
          <MenuButton
            icon="scalemass"
            accessibilityLabel="Unità"
            groups={[
              {
                actions: DOSE_UNITS.map((u) => ({
                  label: u.many,
                  checked: u.key === unit,
                  onPress: () => setUnit(u.key),
                })),
              },
            ]}>
            <View style={styles.pick}>
              <AppText tone="accent">{unitLabel(unit, doseValue ?? 2)}</AppText>
              <Icon name="chevron.up.chevron.down" size={12} tone="accent" />
            </View>
          </MenuButton>
        </View>
        <View style={styles.row}>
          <AppText style={styles.flex}>Volte al giorno</AppText>
          <StepButton symbol="minus" label="Una volta in meno" disabled={times <= 1} onPress={() => setTimes(Math.max(1, times - 1))} />
          <AppText variant="headline" numeric style={styles.count}>
            {times}
          </AppText>
          <StepButton symbol="plus" label="Una volta in più" disabled={times >= 4} onPress={() => setTimes(Math.min(4, times + 1))} />
        </View>
      </ListGroup>

      <SectionTitle>Quando</SectionTitle>
      <ListGroup>
        <Row
          title="Ogni quanto"
          chevron={false}
          detail={
            <MenuButton
              icon="calendar"
              accessibilityLabel="Ogni quanto si prende"
              groups={[
                {
                  actions: SCHEDULES.map((s) => ({
                    label: s.label,
                    checked: s.key === schedule,
                    onPress: () => setSchedule(s.key),
                  })),
                },
              ]}>
              <View style={styles.pick}>
                <AppText tone="accent" numberOfLines={1}>
                  {SCHEDULES.find((s) => s.key === schedule)?.label}
                </AppText>
                <Icon name="chevron.up.chevron.down" size={12} tone="accent" />
              </View>
            </MenuButton>
          }
        />
        {schedule === 'weekdays' ? <WeekdayPicker value={weekdays} onChange={setWeekdays} /> : null}
        {schedule !== 'asNeeded' ? (
          <Row
            title="Momento"
            chevron={false}
            detail={
              <MenuButton
                icon="clock"
                accessibilityLabel="Momento della giornata"
                groups={[
                  {
                    actions: (moments ?? []).map((m) => ({
                      label: m.name,
                      checked: m.id === moment,
                      onPress: () => setMoment(m.id),
                    })),
                  },
                  {
                    actions: [
                      {
                        label: 'Un orario preciso',
                        checked: moment === null,
                        onPress: () => {
                          setMoment(null);
                          setReminder((r) => r ?? '08:00');
                        },
                      },
                    ],
                  },
                ]}>
                <View style={styles.pick}>
                  <AppText tone="accent" numberOfLines={1}>
                    {moment === null ? 'Un orario preciso' : ((moments ?? []).find((m) => m.id === moment)?.name ?? 'Mattina')}
                  </AppText>
                  <Icon name="chevron.up.chevron.down" size={12} tone="accent" />
                </View>
              </MenuButton>
            }
          />
        ) : null}
        {schedule !== 'asNeeded' && moment === null ? (
          <Row
            title="Ora"
            chevron={false}
            detail={
              <TimePicker
                {...parseTimeKey(reminder ?? '08:00')}
                accessibilityLabel="Ora in cui si prende"
                onChange={(t) => setReminder(timeKey(t.hour, t.minute))}
              />
            }
          />
        ) : null}
      </ListGroup>
      <SectionFooter>
        {schedule === 'active'
          ? 'Nei giorni con un allenamento o un’attività in calendario.'
          : schedule === 'alternate'
            ? 'Un giorno sì e uno no, a partire da quando l’hai aggiunto.'
            : schedule === 'asNeeded'
              ? 'Non è mai dovuto: lo spunti quando lo prendi.'
              : 'Lo trovi da spuntare nel calendario, nel suo momento della giornata.'}
      </SectionFooter>

      <SectionTitle>Come prenderlo</SectionTitle>
      <ListGroup>
        <FieldRow label="Contiene" value={contents} onChangeText={setContents} placeholder="Es. 100 µg D3" autoCapitalize="none" />
        <FieldRow label="Nota" value={note} onChangeText={setNote} placeholder="Es. con un pasto" autoCapitalize="sentences" />
      </ListGroup>

      <SectionTitle>Confezione</SectionTitle>
      <ListGroup>
        <FieldRow
          label="Contiene"
          value={packageAmount}
          onChangeText={setPackageAmount}
          placeholder="Es. 500"
          suffix={unitLabel(unit, 2)}
          numeric
          invalid={packageAmount.trim() !== '' && (amountValue === null || amountValue <= 0)}
        />
        <FieldRow
          label="Prezzo"
          value={packagePrice}
          onChangeText={setPackagePrice}
          placeholder="Es. 24,90"
          suffix="€"
          numeric
          invalid={packagePrice.trim() !== '' && priceValue === null}
        />
      </ListGroup>
      <SectionFooter>
        {each !== null
          ? `${formatEuro(each)} a dose${schedule === 'daily' ? ` · circa ${formatEuro(each * times * 30)} al mese` : ''}.`
          : 'Con quantità e prezzo sai quanto spendi e quando finisce.'}
      </SectionFooter>

      {supplement ? (
        <>
          <SectionTitle>Scorte</SectionTitle>
          <ListGroup>
            <Row
              title="Rimasto"
              chevron={false}
              detail={
                left === null ? (
                  <AppText tone="textSecondary">—</AppText>
                ) : (
                  <AppText tone={daysLeft !== null && daysLeft <= 7 ? 'warning' : 'textSecondary'} numeric>
                    {`${formatNumber(left, 0)} ${unitLabel(unit, left)}${daysLeft !== null ? ` · ${daysLeft} gg` : ''}`}
                  </AppText>
                )
              }
            />
            {purchases.map((p) => (
              <SwipeToDelete
                key={p.id}
                onDelete={() =>
                  deleteWithUndo({ key: `purchase:${p.id}`, title: 'Acquisto eliminato', run: () => deletePurchase(db, p.id) })
                }>
                <Row
                  icon={<Icon name="cart" size={18} tone="textSecondary" />}
                  title={formatShortDate(p.date)}
                  subtitle={formatDose(p.amount, unit)}
                  chevron={false}
                  detail={formatEuro(p.price)}
                />
              </SwipeToDelete>
            ))}
            <ActionRow label="Ho comprato una confezione" symbol="cart.badge.plus" onPress={() => void buy()} />
          </ListGroup>
          <SectionFooter>Ogni dose spuntata scala dalle scorte. Gli acquisti fanno la spesa nel report.</SectionFooter>

          <View style={styles.actions}>
            <Button title="Elimina integratore" variant="destructive" onPress={remove} />
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

/** The amount, typed in the row before its unit. */
function FieldInline({ value, onChangeText, invalid }: { value: string; onChangeText: (text: string) => void; invalid: boolean }) {
  const theme = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder="5"
      placeholderTextColor={theme.textTertiary}
      keyboardType="decimal-pad"
      inputAccessoryViewButtonLabel="Fine"
      accessibilityLabel="Dose"
      style={[styles.inline, { color: invalid ? theme.danger : theme.text }]}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl * 2 },
  flex: { flex: 1 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 52, paddingLeft: Spacing.lg, paddingRight: Spacing.lg },
  inline: { minWidth: 64, fontSize: 17, textAlign: 'right', paddingVertical: Spacing.md, fontVariant: ['tabular-nums'] },
  count: { minWidth: 32, textAlign: 'center' },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, maxWidth: 220 },
  actions: { paddingTop: Spacing.xl },
});
