import { daysBetween, addDays, type DateKey } from './dates';

/** Energy in one kg of body weight change (mostly fat, some water and lean tissue). */
export const KCAL_PER_KG = 7700;

export type WeightPoint = { date: DateKey; kg: number };

/** Least-squares slope of weight against days, in kg per day. Null with fewer than two days. */
export function weightSlope(points: readonly WeightPoint[]): number | null {
  if (points.length < 2) return null;
  const origin = points[0].date;
  const xs = points.map((p) => daysBetween(origin, p.date));
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = points.reduce((a, p) => a + p.kg, 0) / points.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < points.length; i++) {
    num += (xs[i] - meanX) * (points[i].kg - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  return den === 0 ? null : num / den;
}

export type DayIntake = { date: DateKey; kcal: number; target: number };

export type ExpenditureEstimate = {
  /** Estimated maintenance calories per day. */
  tdee: number;
  averageIntake: number;
  /** Weight change per week from the trend, negative when losing. */
  weeklyChange: number;
  loggedDays: number;
  weighIns: number;
  /** "high" with at least 3 weeks of data, regular logging and weigh-ins. */
  confidence: 'medium' | 'high';
};

export type ExpenditureResult =
  | { ok: true; estimate: ExpenditureEstimate }
  | { ok: false; reason: string };

/** A day counts as logged when it reaches half of its target: emptier days are probably incomplete. */
export function isCompleteDay(day: DayIntake): boolean {
  return day.kcal >= (day.target > 0 ? day.target * 0.5 : 1000);
}

/**
 * Real maintenance calories from what was eaten and how weight moved: if weight is stable
 * the average intake is maintenance; every kg lost per week means 7700 kcal/7 a day of deficit.
 * Uses the last `windowDays` days ending at `end`.
 */
export function estimateExpenditure(
  intake: readonly DayIntake[],
  weights: readonly WeightPoint[],
  end: DateKey,
  windowDays = 28,
): ExpenditureResult {
  const start = addDays(end, -windowDays + 1);
  const inWindow = (d: DateKey) => d >= start && d <= end;
  const days = intake.filter((d) => inWindow(d.date) && isCompleteDay(d));
  const points = weights.filter((w) => inWindow(w.date)).sort((a, b) => a.date.localeCompare(b.date));

  if (days.length < 10) {
    return { ok: false, reason: `Servono almeno 10 giorni registrati per intero nelle ultime 4 settimane (ora ${days.length}).` };
  }
  if (points.length < 4) {
    return { ok: false, reason: `Servono almeno 4 pesate nelle ultime 4 settimane (ora ${points.length}).` };
  }
  const span = daysBetween(points[0].date, points[points.length - 1].date);
  if (span < 14) {
    return { ok: false, reason: 'Le pesate devono coprire almeno 2 settimane.' };
  }
  const slope = weightSlope(points) ?? 0;
  const averageIntake = days.reduce((sum, d) => sum + d.kcal, 0) / days.length;
  const tdee = averageIntake - slope * KCAL_PER_KG;
  const confidence = days.length >= 21 && points.length >= 8 && span >= 21 ? 'high' : 'medium';
  return {
    ok: true,
    estimate: {
      tdee: Math.round(tdee),
      averageIntake: Math.round(averageIntake),
      weeklyChange: slope * 7,
      loggedDays: days.length,
      weighIns: points.length,
      confidence,
    },
  };
}

export type GoalForecast =
  | { kind: 'reached' }
  | { kind: 'eta'; date: DateKey; weeks: number }
  | { kind: 'wrong-way' }
  | { kind: 'flat' };

/** When the goal weight is reached at the current pace (slope in kg/day, from recent weigh-ins). */
export function forecastGoal(current: WeightPoint, goalKg: number, slopePerDay: number | null): GoalForecast {
  const remaining = goalKg - current.kg;
  if (Math.abs(remaining) < 0.3) return { kind: 'reached' };
  if (slopePerDay === null || Math.abs(slopePerDay) < 0.005) return { kind: 'flat' };
  if (Math.sign(remaining) !== Math.sign(slopePerDay)) return { kind: 'wrong-way' };
  const days = Math.round(remaining / slopePerDay);
  return { kind: 'eta', date: addDays(current.date, days), weeks: days / 7 };
}
