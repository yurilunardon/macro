import type { SQLiteDatabase } from 'expo-sqlite';

import { notifyChange } from './live';

type OrderedTable = 'program_days' | 'day_exercises' | 'workout_exercises';
type ParentColumn = 'program_id' | 'day_id' | 'workout_id';

/** Swaps a row with the one before (-1) or after (1) it among its siblings, renumbering them. */
export async function moveRow(
  db: SQLiteDatabase,
  table: OrderedTable,
  parentColumn: ParentColumn,
  id: number,
  direction: -1 | 1,
): Promise<void> {
  const row = await db.getFirstAsync<{ parent: number }>(`SELECT ${parentColumn} AS parent FROM ${table} WHERE id = ?`, id);
  if (!row) return;
  const ids = (
    await db.getAllAsync<{ id: number }>(`SELECT id FROM ${table} WHERE ${parentColumn} = ? ORDER BY position, id`, row.parent)
  ).map((r) => r.id);
  const index = ids.indexOf(id);
  const other = index + direction;
  if (index < 0 || other < 0 || other >= ids.length) return;
  [ids[index], ids[other]] = [ids[other], ids[index]];
  for (const [position, rowId] of ids.entries()) {
    await db.runAsync(`UPDATE ${table} SET position = ? WHERE id = ?`, position, rowId);
  }
  notifyChange('training');
}

/** Saves the order of a parent's rows after they have been dragged: `ids` from first to last. */
export async function setOrder(db: SQLiteDatabase, table: OrderedTable, ids: readonly number[]): Promise<void> {
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const [position, id] of ids.entries()) {
      await tx.runAsync(`UPDATE ${table} SET position = ? WHERE id = ?`, position, id);
    }
  });
  notifyChange('training');
}
