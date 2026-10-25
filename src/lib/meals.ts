import type { SFSymbol } from 'expo-symbols';

export type MealKey = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export const MEALS: readonly { key: MealKey; label: string; symbol: SFSymbol }[] = [
  { key: 'breakfast', label: 'Colazione', symbol: 'sunrise.fill' },
  { key: 'lunch', label: 'Pranzo', symbol: 'sun.max.fill' },
  { key: 'dinner', label: 'Cena', symbol: 'moon.stars.fill' },
  { key: 'snack', label: 'Spuntini', symbol: 'carrot.fill' },
];

export function isMealKey(value: unknown): value is MealKey {
  return MEALS.some((m) => m.key === value);
}

export function mealLabel(key: MealKey): string {
  return MEALS.find((m) => m.key === key)?.label ?? key;
}

/** The meal someone is most likely logging at this time of day. */
export function mealForTime(date: Date = new Date()): MealKey {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 18 && hour < 23) return 'dinner';
  return 'snack';
}
