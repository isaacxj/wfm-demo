/**
 * Demo actuals for the weeks before the landing week. Every figure is invented.
 *
 * Actuals are what was observed, so they are generated as data: the locked
 * plan's forecast and headcount, moved by a small seeded amount, a few percent
 * either way. One site has drifted: Mexico City took more contacts than
 * forecast, they ran longer, and attrition ran ahead of plan.
 */
import type { ActualInput, DemandCell, ObservedHeadcount, PlanInput, PlanResult } from '../engine/index.ts';
import { between, streamFor } from './rng.ts';
import { SEED } from './dataset.ts';

/** Weeks 1 to 11 have elapsed: the plan lands on week 12. */
export const ACTUALS_THROUGH_WEEK = 11;

/** The site that has drifted off plan, and by how much once the drift is fully in. */
export const DRIFT_SITE = 'MEX';
const DRIFT = { volume: 0.07, aht: 0.035, headcount: -0.025 };
/** The drift builds from week 3 and is fully in by week 8. */
const driftIn = (week: number) => Math.min(1, Math.max(0, (week - 2) / 6));

export function buildActuals(input: PlanInput, plan: PlanResult, seed = SEED, throughWeek = ACTUALS_THROUGH_WEEK): ActualInput {
  const weeks = input.weeks.slice(0, throughWeek);
  const code = (w: number) => `W${String(w).padStart(2, '0')}`;

  // A site-week moves together (a busy week is busy on every queue), then each unit varies a little.
  const siteSwing = new Map(
    input.sites.map((s) => {
      const rand = streamFor(seed, `actual-site:${s.id}`);
      return [s.id, weeks.map(() => ({ volume: between(rand, -0.025, 0.025), aht: between(rand, -0.012, 0.012) }))];
    }),
  );

  const demand: Record<string, DemandCell[]> = {};
  for (const unit of input.units) {
    // Actuals scatter around what the plan expected: the forecast moved by any registered events.
    const periods = plan.sites.find((sp) => sp.site.id === unit.siteId)?.periods;
    if (!periods) throw new Error(`No plan for unit ${unit.id}`);
    const forecast = periods.map((p) => p.units.find((u) => u.unit.id === unit.id)!);
    const rand = streamFor(seed, `actual-unit:${unit.id}`);
    const swing = siteSwing.get(unit.siteId)!;
    const drifted = unit.siteId === DRIFT_SITE;
    demand[unit.id] = weeks.map((week, w) => {
      const f = forecast[w]!;
      const d = drifted ? driftIn(week.index) : 0;
      const volume = Math.round(f.volume * (1 + swing[w]!.volume + between(rand, -0.02, 0.02) + DRIFT.volume * d));
      const aht = Math.round(f.aht * (1 + swing[w]!.aht + between(rand, -0.01, 0.01) + DRIFT.aht * d));
      return { volume, aht, source: `ACT27.${unit.id}.${code(week.index)}` };
    });
  }

  const headcount: Record<string, ObservedHeadcount[]> = {};
  for (const sp of plan.sites) {
    const rand = streamFor(seed, `actual-hc:${sp.site.id}`);
    const drifted = sp.site.id === DRIFT_SITE;
    headcount[sp.site.id] = weeks.map((week, w) => {
      const planned = sp.periods[w]!.flow.closing;
      const d = drifted ? driftIn(week.index) : 0;
      const observed = Math.round(planned * (1 + between(rand, -0.012, 0.012) + DRIFT.headcount * d));
      return {
        // A site cannot hold more heads than its contract allows.
        value: sp.site.cap === null ? observed : Math.min(observed, sp.site.cap),
        source: `ACT27.${sp.site.id}.HC.${code(week.index)}`,
      };
    });
  }

  return { throughWeek, demand, headcount };
}
