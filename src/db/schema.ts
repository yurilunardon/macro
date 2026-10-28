import type { SQLiteDatabase } from 'expo-sqlite';

import { seedActivityTypes } from './calendar';
import { refreshSearchText } from './foods';
import { seedExercises } from './exercises';
import { seedGenericFoods } from './generic';

export const DATABASE_NAME = 'macro.db';

type Migration = string | ((db: SQLiteDatabase) => Promise<void>);

/**
 * Each migration runs once, in order, and the index + 1 becomes the database's user_version.
 * Never edit a migration that has shipped: add a new one, so existing diaries are upgraded in place.
 */
export const MIGRATIONS: readonly Migration[] = [
  `
  CREATE TABLE foods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode TEXT UNIQUE,
    name TEXT NOT NULL,
    brand TEXT,
    unit TEXT NOT NULL DEFAULT 'g',
    kcal REAL NOT NULL,
    protein REAL NOT NULL,
    carbs REAL NOT NULL,
    fat REAL NOT NULL,
    sugars REAL,
    fiber REAL,
    sat_fat REAL,
    salt REAL,
    serving_size REAL,
    serving_label TEXT,
    image_url TEXT,
    source TEXT NOT NULL,
    favorite INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX foods_name ON foods (name COLLATE NOCASE);

  CREATE TABLE entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    meal TEXT NOT NULL,
    food_id INTEGER REFERENCES foods (id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    brand TEXT,
    unit TEXT NOT NULL DEFAULT 'g',
    quantity REAL NOT NULL,
    kcal REAL NOT NULL,
    protein REAL NOT NULL,
    carbs REAL NOT NULL,
    fat REAL NOT NULL,
    sugars REAL,
    fiber REAL,
    sat_fat REAL,
    salt REAL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX entries_date ON entries (date);
  CREATE INDEX entries_food ON entries (food_id, created_at);

  CREATE TABLE weights (date TEXT PRIMARY KEY NOT NULL, kg REAL NOT NULL);
  CREATE TABLE water (date TEXT PRIMARY KEY NOT NULL, ml INTEGER NOT NULL);
  CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  `,
  // 2: basic foods (a stable reference and a category) and accent-insensitive search.
  async (db) => {
    await db.execAsync(`
      ALTER TABLE foods ADD COLUMN ref TEXT;
      ALTER TABLE foods ADD COLUMN category TEXT;
      ALTER TABLE foods ADD COLUMN search_text TEXT NOT NULL DEFAULT '';
      CREATE UNIQUE INDEX foods_ref ON foods (ref);
    `);
    await refreshSearchText(db);
  },
  // 3: recipes, saved meals, training/rest days; water tracking removed.
  `
  DROP TABLE IF EXISTS water;
  DELETE FROM settings WHERE key = 'waterGoalMl';

  CREATE TABLE recipes (
    food_id INTEGER PRIMARY KEY NOT NULL REFERENCES foods (id) ON DELETE CASCADE,
    cooked_weight REAL,
    servings REAL
  );
  CREATE TABLE recipe_ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER NOT NULL REFERENCES recipes (food_id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    food_id INTEGER REFERENCES foods (id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    brand TEXT,
    unit TEXT NOT NULL,
    quantity REAL NOT NULL,
    kcal REAL NOT NULL,
    protein REAL NOT NULL,
    carbs REAL NOT NULL,
    fat REAL NOT NULL,
    sugars REAL,
    fiber REAL,
    sat_fat REAL,
    salt REAL
  );
  CREATE INDEX recipe_ingredients_recipe ON recipe_ingredients (recipe_id, position);

  CREATE TABLE saved_meals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE saved_meal_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    saved_meal_id INTEGER NOT NULL REFERENCES saved_meals (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    food_id INTEGER REFERENCES foods (id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    brand TEXT,
    unit TEXT NOT NULL,
    quantity REAL NOT NULL,
    kcal REAL NOT NULL,
    protein REAL NOT NULL,
    carbs REAL NOT NULL,
    fat REAL NOT NULL,
    sugars REAL,
    fiber REAL,
    sat_fat REAL,
    salt REAL
  );
  CREATE INDEX saved_meal_items_meal ON saved_meal_items (saved_meal_id, position);

  CREATE TABLE day_types (date TEXT PRIMARY KEY NOT NULL, type TEXT NOT NULL);
  `,
  // 4: body measurements and intermittent fasting.
  `
  CREATE TABLE measurements (
    date TEXT NOT NULL,
    kind TEXT NOT NULL,
    value REAL NOT NULL,
    PRIMARY KEY (date, kind)
  );
  CREATE TABLE fasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start TEXT NOT NULL,
    end TEXT,
    goal_hours REAL NOT NULL
  );
  CREATE INDEX fasts_start ON fasts (start);
  `,
  // 5: intermittent fasting removed.
  `
  DROP TABLE fasts;
  DELETE FROM settings WHERE key = 'fasting';
  `,
  // 6: weight training. Exercises (shipped and custom), programs made of days with planned
  // exercises, and the workouts actually done with every set.
  `
  CREATE TABLE exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT,
    name TEXT NOT NULL,
    muscle TEXT NOT NULL,
    secondary TEXT NOT NULL DEFAULT '',
    equipment TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'weight',
    track_rir INTEGER NOT NULL DEFAULT 0,
    rest_seconds INTEGER,
    note TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    search_text TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX exercises_ref ON exercises (ref);

  CREATE TABLE programs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    notes TEXT,
    active INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE program_days (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id INTEGER NOT NULL REFERENCES programs (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL
  );
  CREATE INDEX program_days_program ON program_days (program_id, position);
  CREATE TABLE day_exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day_id INTEGER NOT NULL REFERENCES program_days (id) ON DELETE CASCADE,
    exercise_id INTEGER NOT NULL REFERENCES exercises (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    sets INTEGER NOT NULL,
    rep_min INTEGER NOT NULL,
    rep_max INTEGER NOT NULL,
    rest_seconds INTEGER,
    note TEXT
  );
  CREATE INDEX day_exercises_day ON day_exercises (day_id, position);

  CREATE TABLE workouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day_id INTEGER REFERENCES program_days (id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    notes TEXT
  );
  CREATE INDEX workouts_started ON workouts (started_at);
  CREATE INDEX workouts_date ON workouts (date);
  CREATE TABLE workout_exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_id INTEGER NOT NULL REFERENCES workouts (id) ON DELETE CASCADE,
    exercise_id INTEGER NOT NULL REFERENCES exercises (id),
    position INTEGER NOT NULL,
    rep_min INTEGER,
    rep_max INTEGER,
    rest_seconds INTEGER,
    note TEXT
  );
  CREATE INDEX workout_exercises_workout ON workout_exercises (workout_id, position);
  CREATE INDEX workout_exercises_exercise ON workout_exercises (exercise_id);
  CREATE TABLE workout_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_exercise_id INTEGER NOT NULL REFERENCES workout_exercises (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'normal',
    weight REAL,
    reps INTEGER,
    seconds INTEGER,
    rir REAL,
    target_weight REAL,
    target_reps INTEGER,
    done INTEGER NOT NULL DEFAULT 0,
    done_at TEXT
  );
  CREATE INDEX workout_sets_exercise ON workout_sets (workout_exercise_id, position);
  `,
  // 7: English names of the exercises, filled in by the exercise seeding.
  `
  ALTER TABLE exercises ADD COLUMN name_en TEXT;
  `,
  // 8: a program opened from a template is a draft until it is added to the user's own.
  `
  ALTER TABLE programs ADD COLUMN draft INTEGER NOT NULL DEFAULT 0;
  `,
  // 9: the calendar. Kinds of activity (the gym, volleyball…), activities repeated every week
  // (plans) or on one date (records, which also hold one day of a plan changed by hand), and the
  // supplements with the doses ticked and the packages bought.
  `
  CREATE TABLE activity_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT,
    name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    color TEXT NOT NULL,
    minutes INTEGER,
    position INTEGER NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX activity_types_ref ON activity_types (ref);

  CREATE TABLE activity_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type_id INTEGER NOT NULL REFERENCES activity_types (id) ON DELETE CASCADE,
    weekdays TEXT NOT NULL,
    time TEXT,
    minutes INTEGER,
    day_id INTEGER REFERENCES program_days (id) ON DELETE SET NULL,
    note TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type_id INTEGER NOT NULL REFERENCES activity_types (id) ON DELETE CASCADE,
    plan_id INTEGER REFERENCES activity_plans (id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    time TEXT,
    minutes INTEGER,
    day_id INTEGER REFERENCES program_days (id) ON DELETE SET NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'planned',
    created_at TEXT NOT NULL
  );
  CREATE INDEX activities_date ON activities (date);
  CREATE UNIQUE INDEX activities_plan_date ON activities (plan_id, date) WHERE plan_id IS NOT NULL;

  CREATE TABLE supplements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    dose REAL NOT NULL,
    unit TEXT NOT NULL,
    times_per_day INTEGER NOT NULL DEFAULT 1,
    schedule TEXT NOT NULL DEFAULT 'daily',
    weekdays TEXT NOT NULL DEFAULT '',
    reminder TEXT,
    package_amount REAL,
    package_price REAL,
    position INTEGER NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    started_on TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE supplement_doses (
    supplement_id INTEGER NOT NULL REFERENCES supplements (id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    dose_index INTEGER NOT NULL,
    taken_at TEXT NOT NULL,
    PRIMARY KEY (supplement_id, date, dose_index)
  );
  CREATE INDEX supplement_doses_date ON supplement_doses (date);
  CREATE TABLE supplement_purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplement_id INTEGER NOT NULL REFERENCES supplements (id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    price REAL NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX supplement_purchases_supplement ON supplement_purchases (supplement_id, date);
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** Brings the database up to date and adds any missing basic foods. Runs every time the app opens it. */
export async function migrateDatabase(db: SQLiteDatabase): Promise<void> {
  if (process.env.EXPO_PUBLIC_SAMPLE_DATA === '1') {
    // The web preview's SQLite has no exclusive transactions; plain ones are enough there.
    db.withExclusiveTransactionAsync = (task) => db.withTransactionAsync(() => task(db as never));
  }
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    const migration = MIGRATIONS[version];
    const next = version + 1;
    await db.withExclusiveTransactionAsync(async (tx) => {
      if (typeof migration === 'string') await tx.execAsync(migration);
      else await migration(tx);
      await tx.execAsync(`PRAGMA user_version = ${next}`);
    });
    version = next;
  }
  // A template only looked at when the app was closed is not kept.
  await db.runAsync('DELETE FROM programs WHERE draft = 1');
  await seedGenericFoods(db);
  await seedExercises(db);
  await seedActivityTypes(db);
  if (process.env.EXPO_PUBLIC_SAMPLE_DATA === '1') {
    const { seedSampleData } = await import('./sample-data');
    await seedSampleData(db);
  }
}
