import type { SQLiteDatabase } from 'expo-sqlite';

import { getFood } from '@/db/foods';
import { getWordsCatalog } from '@/db/food-words';
import { parseWords, WORDS_SCHEMA, wordsQuestion, wordsSystem, type WordsItem, type WordsKind } from '@/lib/food-words';
import type { Nutrients } from '@/lib/nutrition';

import { askCoach, CoachError } from './coach';

export type ReadItem = WordsItem & { per100: Nutrients };

/** The coach reads the text into foods of the app, each with the values it counts with. */
export async function readWords(db: SQLiteDatabase, kind: WordsKind, text: string): Promise<{ title: string; items: ReadItem[] }> {
  const catalog = await getWordsCatalog(db);
  const answer = await askCoach(wordsSystem(catalog), [{ role: 'user', text: wordsQuestion(kind, text) }], WORDS_SCHEMA);
  const result = parseWords(answer, new Map(catalog.map((f) => [f.id, f])), kind);
  if (!result) throw new CoachError('Il coach non ha trovato alimenti in questo testo');
  const items: ReadItem[] = [];
  for (const item of result.items) {
    if (item.food.kind === 'new') {
      items.push({ ...item, per100: item.food.per100 });
    } else {
      const food = await getFood(db, item.food.id);
      if (food) items.push({ ...item, per100: food.per100 });
    }
  }
  return { title: result.title, items };
}
