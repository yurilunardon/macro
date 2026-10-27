import type { SQLiteDatabase } from 'expo-sqlite';

import { deleteWeight } from '@/db/body';
import type { DateKey } from '@/lib/dates';

import { deleteWithUndo } from './undo';

/** A weigh-in leaves its list at once, with "Annulla" for a few seconds, as every row does. */
export function removeWeight(db: SQLiteDatabase, date: DateKey): void {
  deleteWithUndo({
    key: `weight:${date}`,
    title: 'Pesata eliminata',
    run: () => deleteWeight(db, date),
  });
}
