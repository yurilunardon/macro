import type { SQLiteDatabase } from 'expo-sqlite';

import { promptNumber } from '@/components/prompt';
import { setWeight } from '@/db/body';
import { formatDayTitle, todayKey, type DateKey } from '@/lib/dates';
import { numberToInput } from '@/lib/format';

import { haptics } from './haptics';

/**
 * Asks for a day's weight and saves it, in place of the one already there: from the calendar's
 * day, the weight page and the list of weigh-ins. Starts from the day's weight, or the last one.
 */
export function logWeight(db: SQLiteDatabase, date: DateKey, current: { kg: number } | null, today: DateKey = todayKey()): void {
  promptNumber({
    title: date === today ? 'Peso di oggi' : `Peso · ${formatDayTitle(date, today)}`,
    message: 'In chilogrammi.',
    defaultValue: current ? numberToInput(current.kg) : '',
    min: 20,
    max: 400,
    onSubmit: (kg) => {
      void setWeight(db, date, kg);
      haptics.success();
    },
  });
}
