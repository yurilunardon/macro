/** Body measurements besides weight, one value per kind per day. */

export type MeasurementKind = 'waist' | 'hips' | 'chest' | 'arm' | 'thigh' | 'neck' | 'bodyFat';

export const MEASUREMENTS: readonly { kind: MeasurementKind; label: string; unit: 'cm' | '%'; min: number; max: number }[] = [
  { kind: 'waist', label: 'Vita', unit: 'cm', min: 40, max: 200 },
  { kind: 'hips', label: 'Fianchi', unit: 'cm', min: 50, max: 200 },
  { kind: 'chest', label: 'Petto', unit: 'cm', min: 50, max: 200 },
  { kind: 'arm', label: 'Braccio', unit: 'cm', min: 15, max: 70 },
  { kind: 'thigh', label: 'Coscia', unit: 'cm', min: 30, max: 100 },
  { kind: 'neck', label: 'Collo', unit: 'cm', min: 25, max: 60 },
  { kind: 'bodyFat', label: 'Massa grassa', unit: '%', min: 3, max: 60 },
];

export function isMeasurementKind(value: unknown): value is MeasurementKind {
  return MEASUREMENTS.some((m) => m.kind === value);
}

export type Measurement = { date: string; kind: MeasurementKind; value: number };

/** Latest value of each kind and its change from the first value since `from`. */
export function measurementChanges(rows: readonly Measurement[], from: string) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  return MEASUREMENTS.flatMap((m) => {
    const values = sorted.filter((r) => r.kind === m.kind);
    if (values.length === 0) return [];
    const latest = values[values.length - 1];
    const first = values.find((r) => r.date >= from) ?? latest;
    return [{ ...m, latest, change: first.date === latest.date ? null : latest.value - first.value }];
  });
}
