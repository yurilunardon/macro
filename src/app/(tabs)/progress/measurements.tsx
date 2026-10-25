import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ListGroup, Row, SectionFooter, SectionTitle } from '@/components/card';
import { FieldRow } from '@/components/form';
import { ScreenScroll } from '@/components/screen';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Spacing } from '@/constants/theme';
import { useLiveQuery } from '@/db/live';
import { deleteMeasurementsOn, getMeasurements, setMeasurements } from '@/db/measurements';
import { useToday } from '@/hooks/use-today';
import { formatDayTitle } from '@/lib/dates';
import { formatNumber, numberToInput, parseDecimal } from '@/lib/format';
import { MEASUREMENTS, type Measurement, type MeasurementKind } from '@/lib/measurements';
import { haptics } from '@/services/haptics';

type Fields = Record<MeasurementKind, string>;

export default function MeasurementsScreen() {
  const today = useToday();
  const { data } = useLiveQuery('measurements', (database) => getMeasurements(database));
  if (!data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  // Keyed by day so the form starts again from the saved values tomorrow.
  return <MeasurementsForm key={today} rows={data} today={today} />;
}

function MeasurementsForm({ rows, today }: { rows: Measurement[]; today: string }) {
  const db = useSQLiteContext();
  const [fields, setFields] = useState<Fields>(() => {
    const todays = Object.fromEntries(rows.filter((r) => r.date === today).map((r) => [r.kind, numberToInput(r.value)]));
    return Object.fromEntries(MEASUREMENTS.map((m) => [m.kind, todays[m.kind] ?? ''])) as Fields;
  });
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  const latest = (kind: MeasurementKind) => [...rows].reverse().find((r) => r.kind === kind && r.date !== today);
  const parsed = MEASUREMENTS.map((m) => {
    const text = fields[m.kind].trim();
    const value = text === '' ? null : parseDecimal(text);
    return { ...m, value, invalid: text !== '' && (value === null || value < m.min || value > m.max) };
  });
  const hasErrors = parsed.some((p) => p.invalid);

  const save = async () => {
    setShowErrors(true);
    if (hasErrors) return;
    setSaving(true);
    try {
      await setMeasurements(db, today, Object.fromEntries(parsed.map((p) => [p.kind, p.value])));
      haptics.success();
    } finally {
      setSaving(false);
    }
  };

  const byDate = new Map<string, Measurement[]>();
  for (const row of [...rows].reverse()) byDate.set(row.date, [...(byDate.get(row.date) ?? []), row]);

  return (
    <ScreenScroll>
      <SectionTitle>{`Oggi · ${formatDayTitle(today, today)}`}</SectionTitle>
      <ListGroup>
        {parsed.map((m) => {
          const previous = latest(m.kind);
          return (
            <FieldRow
              key={m.kind}
              label={m.label}
              value={fields[m.kind]}
              onChangeText={(text) => setFields((f) => ({ ...f, [m.kind]: text }))}
              placeholder={previous ? formatNumber(previous.value, 1) : '—'}
              suffix={m.unit}
              numeric
              invalid={showErrors && m.invalid}
            />
          );
        })}
      </ListGroup>
      <SectionFooter>
        Misura sempre allo stesso modo: al mattino, a digiuno, con il metro appoggiato senza stringere. In grigio
        l’ultima misura. Lascia vuoti i campi che non misuri.
      </SectionFooter>
      <View style={styles.button}>
        <Button title="Salva misure" onPress={() => void save()} loading={saving} />
      </View>

      {byDate.size > 0 ? (
        <>
          <SectionTitle>Storico</SectionTitle>
          <ListGroup>
            {[...byDate].map(([date, values]) => (
              <SwipeToDelete key={date} onDelete={() => void deleteMeasurementsOn(db, date)}>
                <Row
                  title={formatDayTitle(date, today)}
                  subtitle={values
                    .map((v) => {
                      const m = MEASUREMENTS.find((x) => x.kind === v.kind);
                      return m ? `${m.label} ${formatNumber(v.value, 1)}${m.unit === '%' ? '%' : ''}` : '';
                    })
                    .join(' · ')}
                  chevron={false}
                  onLongPress={() =>
                    Alert.alert('Eliminare le misure di questo giorno?', formatDayTitle(date, today), [
                      { text: 'Annulla', style: 'cancel' },
                      { text: 'Elimina', style: 'destructive', onPress: () => void deleteMeasurementsOn(db, date) },
                    ])
                  }
                />
              </SwipeToDelete>
            ))}
          </ListGroup>
          <SectionFooter>Centimetri, tranne la massa grassa. Scorri a sinistra per eliminare un giorno.</SectionFooter>
        </>
      ) : null}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  button: { paddingTop: Spacing.xl },
});
