/**
 * Backup file format. A backup is a JSON copy of every table, so that the diary survives
 * deleting the app or changing the Apple ID used to sign it.
 */
import { isDateKey } from './dates';

export const BACKUP_APP = 'macro';
/**
 * 2 added `ref` and `category` to foods. 3 added recipes, saved meals and day types, and
 * dropped water. 4 added measurements and fasts, 5 dropped fasts, 6 added training. Older files
 * are still accepted.
 */
export const BACKUP_VERSION = 6;

export type FoodRow = {
  id: number;
  barcode: string | null;
  name: string;
  brand: string | null;
  unit: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  sugars: number | null;
  fiber: number | null;
  sat_fat: number | null;
  salt: number | null;
  serving_size: number | null;
  serving_label: string | null;
  image_url: string | null;
  source: string;
  favorite: number;
  created_at: string;
  updated_at: string;
  ref: string | null;
  category: string | null;
};

export type EntryRow = {
  id: number;
  date: string;
  meal: string;
  food_id: number | null;
  name: string;
  brand: string | null;
  unit: string;
  quantity: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  sugars: number | null;
  fiber: number | null;
  sat_fat: number | null;
  salt: number | null;
  created_at: string;
};

export type WeightRow = { date: string; kg: number };
export type SettingRow = { key: string; value: string };

/** A recipe is a food (source "recipe") plus how its weight is spread. */
export type RecipeRow = { food_id: number; cooked_weight: number | null; servings: number | null };

type NutrientColumns = {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  sugars: number | null;
  fiber: number | null;
  sat_fat: number | null;
  salt: number | null;
};

/** Nutrients are per 100 g or ml of the ingredient, copied when it was added. */
export type RecipeIngredientRow = NutrientColumns & {
  id: number;
  recipe_id: number;
  position: number;
  food_id: number | null;
  name: string;
  brand: string | null;
  unit: string;
  quantity: number;
};

export type SavedMealRow = { id: number; name: string; created_at: string };

/** Nutrients are totals for the quantity, like a diary entry. */
export type SavedMealItemRow = NutrientColumns & {
  id: number;
  saved_meal_id: number;
  position: number;
  food_id: number | null;
  name: string;
  brand: string | null;
  unit: string;
  quantity: number;
};

export type DayTypeRow = { date: string; type: string };
export type MeasurementRow = { date: string; kind: string; value: number };

export type ExerciseRow = {
  id: number;
  ref: string | null;
  name: string;
  name_en: string | null;
  muscle: string;
  secondary: string;
  equipment: string;
  kind: string;
  track_rir: number;
  rest_seconds: number | null;
  note: string | null;
  archived: number;
  created_at: string;
};
export type ProgramRow = { id: number; name: string; notes: string | null; active: number; created_at: string };
export type ProgramDayRow = { id: number; program_id: number; name: string; position: number };
export type DayExerciseRow = {
  id: number;
  day_id: number;
  exercise_id: number;
  position: number;
  sets: number;
  rep_min: number;
  rep_max: number;
  rest_seconds: number | null;
  note: string | null;
};
export type WorkoutRow = {
  id: number;
  day_id: number | null;
  name: string;
  date: string;
  started_at: string;
  ended_at: string | null;
  notes: string | null;
};
export type WorkoutExerciseRow = {
  id: number;
  workout_id: number;
  exercise_id: number;
  position: number;
  rep_min: number | null;
  rep_max: number | null;
  rest_seconds: number | null;
  note: string | null;
};
export type WorkoutSetRow = {
  id: number;
  workout_exercise_id: number;
  position: number;
  type: string;
  weight: number | null;
  reps: number | null;
  seconds: number | null;
  rir: number | null;
  target_weight: number | null;
  target_reps: number | null;
  done: number;
  done_at: string | null;
};

export type BackupData = {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: string;
  foods: FoodRow[];
  entries: EntryRow[];
  weights: WeightRow[];
  settings: SettingRow[];
  recipes: RecipeRow[];
  recipe_ingredients: RecipeIngredientRow[];
  saved_meals: SavedMealRow[];
  saved_meal_items: SavedMealItemRow[];
  day_types: DayTypeRow[];
  measurements: MeasurementRow[];
  exercises: ExerciseRow[];
  programs: ProgramRow[];
  program_days: ProgramDayRow[];
  day_exercises: DayExerciseRow[];
  workouts: WorkoutRow[];
  workout_exercises: WorkoutExerciseRow[];
  workout_sets: WorkoutSetRow[];
};

export class BackupFormatError extends Error {}

type Check = 'number' | 'string' | 'number?' | 'string?';

const FOOD_COLUMNS: Record<keyof FoodRow, Check> = {
  id: 'number',
  barcode: 'string?',
  name: 'string',
  brand: 'string?',
  unit: 'string',
  kcal: 'number',
  protein: 'number',
  carbs: 'number',
  fat: 'number',
  sugars: 'number?',
  fiber: 'number?',
  sat_fat: 'number?',
  salt: 'number?',
  serving_size: 'number?',
  serving_label: 'string?',
  image_url: 'string?',
  source: 'string',
  favorite: 'number',
  created_at: 'string',
  updated_at: 'string',
  ref: 'string?',
  category: 'string?',
};

const ENTRY_COLUMNS: Record<keyof EntryRow, Check> = {
  id: 'number',
  date: 'string',
  meal: 'string',
  food_id: 'number?',
  name: 'string',
  brand: 'string?',
  unit: 'string',
  quantity: 'number',
  kcal: 'number',
  protein: 'number',
  carbs: 'number',
  fat: 'number',
  sugars: 'number?',
  fiber: 'number?',
  sat_fat: 'number?',
  salt: 'number?',
  created_at: 'string',
};

const WEIGHT_COLUMNS: Record<keyof WeightRow, Check> = { date: 'string', kg: 'number' };
const SETTING_COLUMNS: Record<keyof SettingRow, Check> = { key: 'string', value: 'string' };

const NUTRIENT_COLUMNS: Record<keyof NutrientColumns, Check> = {
  kcal: 'number',
  protein: 'number',
  carbs: 'number',
  fat: 'number',
  sugars: 'number?',
  fiber: 'number?',
  sat_fat: 'number?',
  salt: 'number?',
};

const RECIPE_COLUMNS: Record<keyof RecipeRow, Check> = {
  food_id: 'number',
  cooked_weight: 'number?',
  servings: 'number?',
};

const RECIPE_INGREDIENT_COLUMNS: Record<keyof RecipeIngredientRow, Check> = {
  id: 'number',
  recipe_id: 'number',
  position: 'number',
  food_id: 'number?',
  name: 'string',
  brand: 'string?',
  unit: 'string',
  quantity: 'number',
  ...NUTRIENT_COLUMNS,
};

const SAVED_MEAL_COLUMNS: Record<keyof SavedMealRow, Check> = { id: 'number', name: 'string', created_at: 'string' };

const SAVED_MEAL_ITEM_COLUMNS: Record<keyof SavedMealItemRow, Check> = {
  id: 'number',
  saved_meal_id: 'number',
  position: 'number',
  food_id: 'number?',
  name: 'string',
  brand: 'string?',
  unit: 'string',
  quantity: 'number',
  ...NUTRIENT_COLUMNS,
};

const DAY_TYPE_COLUMNS: Record<keyof DayTypeRow, Check> = { date: 'string', type: 'string' };
const MEASUREMENT_COLUMNS: Record<keyof MeasurementRow, Check> = { date: 'string', kind: 'string', value: 'number' };
const EXERCISE_COLUMNS: Record<keyof ExerciseRow, Check> = {
  id: 'number',
  ref: 'string?',
  name: 'string',
  name_en: 'string?',
  muscle: 'string',
  secondary: 'string',
  equipment: 'string',
  kind: 'string',
  track_rir: 'number',
  rest_seconds: 'number?',
  note: 'string?',
  archived: 'number',
  created_at: 'string',
};
const PROGRAM_COLUMNS: Record<keyof ProgramRow, Check> = {
  id: 'number',
  name: 'string',
  notes: 'string?',
  active: 'number',
  created_at: 'string',
};
const PROGRAM_DAY_COLUMNS: Record<keyof ProgramDayRow, Check> = {
  id: 'number',
  program_id: 'number',
  name: 'string',
  position: 'number',
};
const DAY_EXERCISE_COLUMNS: Record<keyof DayExerciseRow, Check> = {
  id: 'number',
  day_id: 'number',
  exercise_id: 'number',
  position: 'number',
  sets: 'number',
  rep_min: 'number',
  rep_max: 'number',
  rest_seconds: 'number?',
  note: 'string?',
};
const WORKOUT_COLUMNS: Record<keyof WorkoutRow, Check> = {
  id: 'number',
  day_id: 'number?',
  name: 'string',
  date: 'string',
  started_at: 'string',
  ended_at: 'string?',
  notes: 'string?',
};
const WORKOUT_EXERCISE_COLUMNS: Record<keyof WorkoutExerciseRow, Check> = {
  id: 'number',
  workout_id: 'number',
  exercise_id: 'number',
  position: 'number',
  rep_min: 'number?',
  rep_max: 'number?',
  rest_seconds: 'number?',
  note: 'string?',
};
const WORKOUT_SET_COLUMNS: Record<keyof WorkoutSetRow, Check> = {
  id: 'number',
  workout_exercise_id: 'number',
  position: 'number',
  type: 'string',
  weight: 'number?',
  reps: 'number?',
  seconds: 'number?',
  rir: 'number?',
  target_weight: 'number?',
  target_reps: 'number?',
  done: 'number',
  done_at: 'string?',
};

/** Settings of features that were removed: water (before version 3) and fasting (version 4). */
const OBSOLETE_SETTINGS = new Set(['waterGoalMl', 'fasting']);

function matches(value: unknown, check: Check): boolean {
  if (check.endsWith('?') && (value === null || value === undefined)) return true;
  const type = check.replace('?', '');
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === 'string';
}

/** `since`: the backup version that introduced the table; older files simply lack it. */
function readRows<T>(data: Record<string, unknown>, table: string, columns: Record<string, Check>, since = 1): T[] {
  const rows = data[table];
  if (rows === undefined && typeof data.version === 'number' && data.version < since) return [];
  if (!Array.isArray(rows)) throw new BackupFormatError(`Manca la tabella "${table}"`);
  return rows.map((row, index) => {
    if (typeof row !== 'object' || row === null) {
      throw new BackupFormatError(`Riga ${index + 1} di "${table}" non valida`);
    }
    const clean: Record<string, unknown> = {};
    for (const [column, check] of Object.entries(columns)) {
      const value = (row as Record<string, unknown>)[column];
      if (!matches(value, check)) {
        throw new BackupFormatError(`Valore non valido in "${table}", riga ${index + 1}, campo "${column}"`);
      }
      clean[column] = value ?? null;
    }
    return clean as T;
  });
}

/** Validates a parsed backup file and returns only the known columns. Throws BackupFormatError. */
export function parseBackup(json: unknown): BackupData {
  if (typeof json !== 'object' || json === null) throw new BackupFormatError('Il file non è un backup');
  const data = json as Record<string, unknown>;
  if (data.app !== BACKUP_APP) throw new BackupFormatError('Il file non è un backup di Fuel');
  if (typeof data.version !== 'number' || data.version > BACKUP_VERSION) {
    throw new BackupFormatError('Backup creato da una versione più recente dell’app');
  }
  const backup: BackupData = {
    app: BACKUP_APP,
    version: data.version,
    exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : '',
    foods: readRows<FoodRow>(data, 'foods', FOOD_COLUMNS),
    entries: readRows<EntryRow>(data, 'entries', ENTRY_COLUMNS),
    weights: readRows<WeightRow>(data, 'weights', WEIGHT_COLUMNS),
    // Water (before version 3) and fasts (version 4) are no longer used and are ignored.
    settings: readRows<SettingRow>(data, 'settings', SETTING_COLUMNS).filter((s) => !OBSOLETE_SETTINGS.has(s.key)),
    recipes: readRows<RecipeRow>(data, 'recipes', RECIPE_COLUMNS, 3),
    recipe_ingredients: readRows<RecipeIngredientRow>(data, 'recipe_ingredients', RECIPE_INGREDIENT_COLUMNS, 3),
    saved_meals: readRows<SavedMealRow>(data, 'saved_meals', SAVED_MEAL_COLUMNS, 3),
    saved_meal_items: readRows<SavedMealItemRow>(data, 'saved_meal_items', SAVED_MEAL_ITEM_COLUMNS, 3),
    day_types: readRows<DayTypeRow>(data, 'day_types', DAY_TYPE_COLUMNS, 3),
    measurements: readRows<MeasurementRow>(data, 'measurements', MEASUREMENT_COLUMNS, 4),
    exercises: readRows<ExerciseRow>(data, 'exercises', EXERCISE_COLUMNS, 6),
    programs: readRows<ProgramRow>(data, 'programs', PROGRAM_COLUMNS, 6),
    program_days: readRows<ProgramDayRow>(data, 'program_days', PROGRAM_DAY_COLUMNS, 6),
    day_exercises: readRows<DayExerciseRow>(data, 'day_exercises', DAY_EXERCISE_COLUMNS, 6),
    workouts: readRows<WorkoutRow>(data, 'workouts', WORKOUT_COLUMNS, 6),
    workout_exercises: readRows<WorkoutExerciseRow>(data, 'workout_exercises', WORKOUT_EXERCISE_COLUMNS, 6),
    workout_sets: readRows<WorkoutSetRow>(data, 'workout_sets', WORKOUT_SET_COLUMNS, 6),
  };
  for (const row of [...backup.entries, ...backup.weights, ...backup.day_types, ...backup.measurements]) {
    if (!isDateKey(row.date)) throw new BackupFormatError(`Data non valida nel backup: ${row.date}`);
  }
  for (const row of backup.day_types) {
    if (row.type !== 'training' && row.type !== 'rest') {
      throw new BackupFormatError(`Tipo di giorno non valido nel backup: ${row.type}`);
    }
  }

  // Links to rows that are not in the file are dropped rather than failing the restore.
  const foodIds = new Set(backup.foods.map((f) => f.id));
  const unlink = <R extends { food_id: number | null }>(row: R) => {
    if (row.food_id !== null && !foodIds.has(row.food_id)) row.food_id = null;
  };
  backup.entries.forEach(unlink);
  backup.recipes = backup.recipes.filter((r) => foodIds.has(r.food_id));
  const recipeIds = new Set(backup.recipes.map((r) => r.food_id));
  backup.recipe_ingredients = backup.recipe_ingredients.filter((i) => recipeIds.has(i.recipe_id));
  backup.recipe_ingredients.forEach(unlink);
  const mealIds = new Set(backup.saved_meals.map((m) => m.id));
  backup.saved_meal_items = backup.saved_meal_items.filter((i) => mealIds.has(i.saved_meal_id));
  backup.saved_meal_items.forEach(unlink);

  // Training rows hang off one another: drop the ones whose parent is missing.
  const exerciseIds = new Set(backup.exercises.map((e) => e.id));
  const programIds = new Set(backup.programs.map((p) => p.id));
  backup.program_days = backup.program_days.filter((d) => programIds.has(d.program_id));
  const dayIds = new Set(backup.program_days.map((d) => d.id));
  backup.day_exercises = backup.day_exercises.filter((x) => dayIds.has(x.day_id) && exerciseIds.has(x.exercise_id));
  for (const w of backup.workouts) if (w.day_id !== null && !dayIds.has(w.day_id)) w.day_id = null;
  const workoutIds = new Set(backup.workouts.map((w) => w.id));
  backup.workout_exercises = backup.workout_exercises.filter(
    (x) => workoutIds.has(x.workout_id) && exerciseIds.has(x.exercise_id),
  );
  const workoutExerciseIds = new Set(backup.workout_exercises.map((x) => x.id));
  backup.workout_sets = backup.workout_sets.filter((s) => workoutExerciseIds.has(s.workout_exercise_id));
  for (const w of backup.workouts) {
    if (!isDateKey(w.date)) throw new BackupFormatError(`Data non valida nel backup: ${w.date}`);
  }
  return backup;
}

export function backupFileName(exportedAt: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${exportedAt.getFullYear()}-${pad(exportedAt.getMonth() + 1)}-${pad(exportedAt.getDate())}`;
  return `macro-backup-${stamp}.json`;
}
