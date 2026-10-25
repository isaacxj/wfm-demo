/**
 * Demo FY27 budget. Every figure is invented.
 *
 * Finance set the budget in September 2026 from the forecast as it stood then:
 * before any registered event was known. It funds a whole number of FTE per
 * site per month, a little either side of that forecast's requirement, and
 * the same in every week of the month.
 */
import type { PlanResult, PlanWeek } from '../engine/index.ts';
import { between, streamFor } from './rng.ts';
import { SEED } from './dataset.ts';

export interface Budget {
  /** Version name, e.g. "FY27 Budget". */
  name: string;
  /** Record code prefix for budget lines, e.g. "BUD27". */
  code: string;
  /** Budgeted FTE per site id, one entry per horizon week. */
  bySite: Readonly<Record<string, readonly number[]>>;
}

/** Month of a week by the ISO rule: the month its Thursday falls in. "2027-03". */
export function monthKey(week: PlanWeek): string {
  const thursday = new Date(`${week.start}T00:00:00Z`);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  return thursday.toISOString().slice(0, 7);
}

/** `forecastPlan` is the plan without registered events: the forecast finance budgeted from. */
export function buildBudget(forecastPlan: PlanResult, seed = SEED): Budget {
  const weeks = forecastPlan.weeks;
  const keys = weeks.map(monthKey);
  const bySite: Record<string, number[]> = {};
  for (const sp of forecastPlan.sites) {
    const rand = streamFor(seed, `budget:${sp.site.id}`);
    const perMonth = new Map<string, number>();
    for (const key of [...new Set(keys)]) {
      const inMonth = sp.periods.filter((_, i) => keys[i] === key);
      const required = inMonth.reduce((s, p) => s + p.requiredFte, 0) / inMonth.length;
      perMonth.set(key, Math.round(required * (1 + between(rand, -0.03, 0.02))));
    }
    bySite[sp.site.id] = keys.map((k) => perMonth.get(k)!);
  }
  return { name: 'FY27 Budget', code: 'BUD27', bySite };
}
