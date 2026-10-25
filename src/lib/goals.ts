import { parseDecimal } from './format';

export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type GoalType = 'lose' | 'lose_slow' | 'maintain' | 'gain_slow' | 'gain';

export type Profile = {
  sex: Sex;
  birthYear: number;
  heightCm: number;
  weightKg: number;
  activity: ActivityLevel;
  goal: GoalType;
  /** Grams of protein per kg of body weight. */
  proteinPerKg: number;
  /** Share of daily energy from fat, in percent. */
  fatPercent: number;
};

export type Targets = {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
};

export const DEFAULT_TARGETS: Targets = { kcal: 2000, protein: 120, carbs: 240, fat: 60 };

export const ACTIVITY_LEVELS: readonly { key: ActivityLevel; label: string; detail: string; factor: number }[] = [
  { key: 'sedentary', label: 'Sedentario', detail: 'Lavoro da seduto, poco movimento', factor: 1.2 },
  { key: 'light', label: 'Leggero', detail: 'Allenamento 1–3 volte a settimana', factor: 1.375 },
  { key: 'moderate', label: 'Moderato', detail: 'Allenamento 3–5 volte a settimana', factor: 1.55 },
  { key: 'active', label: 'Intenso', detail: 'Allenamento 6–7 volte a settimana', factor: 1.725 },
  { key: 'very_active', label: 'Molto intenso', detail: 'Lavoro fisico e allenamento quotidiano', factor: 1.9 },
];

export const GOAL_TYPES: readonly { key: GoalType; label: string; factor: number }[] = [
  { key: 'lose', label: 'Dimagrire (−20%)', factor: 0.8 },
  { key: 'lose_slow', label: 'Dimagrire piano (−10%)', factor: 0.9 },
  { key: 'maintain', label: 'Mantenere', factor: 1 },
  { key: 'gain_slow', label: 'Massa pulita (+5%)', factor: 1.05 },
  { key: 'gain', label: 'Massa (+10%)', factor: 1.1 },
];

export function ageInYear(birthYear: number, year: number): number {
  return Math.max(0, year - birthYear);
}

/** Basal metabolic rate with the Mifflin–St Jeor equation. */
export function basalMetabolicRate(p: Pick<Profile, 'sex' | 'heightCm' | 'weightKg'>, age: number): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * age;
  return p.sex === 'male' ? base + 5 : base - 161;
}

/** Total daily energy expenditure: BMR times the activity factor. */
export function totalDailyEnergy(p: Profile, age: number): number {
  const activity = ACTIVITY_LEVELS.find((a) => a.key === p.activity)?.factor ?? 1.2;
  return basalMetabolicRate(p, age) * activity;
}

/** Daily targets: energy adjusted for the goal, protein by body weight, fat by share, carbs fill the rest. */
export function computeTargets(p: Profile, year: number): Targets {
  const age = ageInYear(p.birthYear, year);
  const goalFactor = GOAL_TYPES.find((g) => g.key === p.goal)?.factor ?? 1;
  const kcal = Math.round(totalDailyEnergy(p, age) * goalFactor);
  const protein = Math.round(p.proteinPerKg * p.weightKg);
  const fat = Math.round((kcal * (p.fatPercent / 100)) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, carbs, fat };
}

/** The text of the profile form. */
export type ProfileFields = {
  sex: Sex;
  birthYear: string;
  heightCm: string;
  weightKg: string;
  activity: ActivityLevel;
  goal: GoalType;
  proteinPerKg: string;
  fatPercent: string;
};

export type TargetFields = { kcal: string; protein: string; carbs: string; fat: string };

function inRange(text: string, min: number, max: number): number | null {
  const value = parseDecimal(text);
  return value !== null && value >= min && value <= max ? value : null;
}

/** Reads the profile form. Each field outside its plausible range is reported as invalid. */
export function parseProfile(f: ProfileFields, currentYear: number) {
  const values = {
    birthYear: inRange(f.birthYear, 1900, currentYear - 10),
    heightCm: inRange(f.heightCm, 100, 250),
    weightKg: inRange(f.weightKg, 30, 300),
    proteinPerKg: inRange(f.proteinPerKg, 0.5, 4),
    fatPercent: inRange(f.fatPercent, 10, 60),
  };
  const invalid = new Set(
    (Object.keys(values) as (keyof typeof values)[]).filter((key) => values[key] === null),
  );
  if (values.birthYear !== null && !Number.isInteger(values.birthYear)) invalid.add('birthYear');
  if (invalid.size > 0) return { profile: null, invalid };
  const profile: Profile = {
    sex: f.sex,
    activity: f.activity,
    goal: f.goal,
    birthYear: values.birthYear as number,
    heightCm: values.heightCm as number,
    weightKg: values.weightKg as number,
    proteinPerKg: values.proteinPerKg as number,
    fatPercent: values.fatPercent as number,
  };
  return { profile, invalid };
}

/** Reads the daily targets form; values are rounded to whole numbers. */
export function parseTargets(f: TargetFields) {
  const values = {
    kcal: inRange(f.kcal, 800, 8000),
    protein: inRange(f.protein, 0, 600),
    carbs: inRange(f.carbs, 0, 1200),
    fat: inRange(f.fat, 0, 600),
  };
  const invalid = new Set((Object.keys(values) as (keyof Targets)[]).filter((key) => values[key] === null));
  if (invalid.size > 0) return { targets: null, invalid };
  const targets: Targets = {
    kcal: Math.round(values.kcal as number),
    protein: Math.round(values.protein as number),
    carbs: Math.round(values.carbs as number),
    fat: Math.round(values.fat as number),
  };
  return { targets, invalid };
}

export type DayType = 'training' | 'rest';

/** Monday first, as on Italian calendars; `day` is Date.getDay() (0 = Sunday). */
export const WEEKDAYS: readonly { day: number; short: string; label: string }[] = [
  { day: 1, short: 'L', label: 'Lunedì' },
  { day: 2, short: 'M', label: 'Martedì' },
  { day: 3, short: 'M', label: 'Mercoledì' },
  { day: 4, short: 'G', label: 'Giovedì' },
  { day: 5, short: 'V', label: 'Venerdì' },
  { day: 6, short: 'S', label: 'Sabato' },
  { day: 0, short: 'D', label: 'Domenica' },
];

/** A day chosen by hand wins; otherwise the weekly schedule decides. */
export function dayTypeFor(weekday: number, trainingWeekdays: readonly number[], override: DayType | null): DayType {
  if (override) return override;
  return trainingWeekdays.includes(weekday) ? 'training' : 'rest';
}

/**
 * Rest-day targets from training-day ones: fewer calories, taken from carbs, while protein
 * and fat stay the same.
 */
export function deriveRestTargets(training: Targets, reductionPercent = 15): Targets {
  const kcal = Math.round(training.kcal * (1 - reductionPercent / 100));
  const carbs = Math.max(0, Math.round((kcal - training.protein * 4 - training.fat * 9) / 4));
  return { kcal, protein: training.protein, carbs, fat: training.fat };
}
