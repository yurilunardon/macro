import { macroEnergySplit, type Nutrients } from './nutrition';

type MacroTotals = Pick<Nutrients, 'kcal' | 'protein' | 'carbs' | 'fat'>;

export type StatDay = MacroTotals & { date: string; targetKcal: number; targetProtein: number };

export type PeriodSummary = {
  /** Days with at least one entry. */
  loggedDays: number;
  average: MacroTotals;
  /** Share of energy from protein, carbs and fat, in percent. */
  split: { protein: number; carbs: number; fat: number };
  /** Logged days within ±10% of the calorie target, in percent. */
  onTarget: number;
  /** Logged days that reached at least 90% of the protein target, in percent. */
  proteinReached: number;
};

/** Averages and adherence over the days that have something logged. */
export function summarizePeriod(days: readonly StatDay[]): PeriodSummary | null {
  const logged = days.filter((d) => d.kcal > 0);
  if (logged.length === 0) return null;
  const sum = (key: keyof MacroTotals) => logged.reduce((total, d) => total + d[key], 0);
  const average = {
    kcal: sum('kcal') / logged.length,
    protein: sum('protein') / logged.length,
    carbs: sum('carbs') / logged.length,
    fat: sum('fat') / logged.length,
  };
  const share = (count: number) => Math.round((count / logged.length) * 100);
  return {
    loggedDays: logged.length,
    average,
    split: macroEnergySplit(average),
    onTarget: share(logged.filter((d) => d.targetKcal > 0 && Math.abs(d.kcal - d.targetKcal) <= d.targetKcal * 0.1).length),
    proteinReached: share(logged.filter((d) => d.targetProtein > 0 && d.protein >= d.targetProtein * 0.9).length),
  };
}
