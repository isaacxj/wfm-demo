/**
 * Periods view model (v2 Mode A): time across the columns, the hierarchy down
 * the rows, one metric in the cells.
 *
 * Each week's column is the Metrics row model for that week, so every column
 * reconciles exactly as the Metrics grid does: site values add to subtotals
 * and the grand total digit for digit, under any filter or grouping.
 *
 * Weeks fall in three bands. Elapsed weeks show actuals; the remaining weeks
 * show the locked plan, or the open scenario. Variance is the shown value
 * against the locked plan: actual − plan, or scenario − plan.
 */
import type { ActualResult, PlanResult, PlanWeek } from '../engine/index.ts';
import { differenceOf } from './compare.ts';
import type { Tone } from './format.ts';
import { buildActualRows, buildRows, type ColumnKey, type Filters, type GridRow, type Grouping, type NumericKey } from './model.ts';

/** Metrics the Periods grid can show, in selector order. */
export const PERIOD_METRICS: readonly NumericKey[] = ['volume', 'aht', 'productive', 'required', 'planned', 'overUnder', 'hireNeed'];

/** Over/Under is the number a planner opens the grid to find. */
export const DEFAULT_PERIOD_METRIC: NumericKey = 'overUnder';

export function isPeriodMetric(key: ColumnKey): key is NumericKey {
  return (PERIOD_METRICS as readonly string[]).includes(key);
}

export type Band = 'actual' | 'plan' | 'scenario';

/** A site is off plan when its Over/Under variance over the latest elapsed weeks averages this share of its requirement. */
export const DRIFT_THRESHOLD = 0.05;
export const DRIFT_WEEKS = 4;

export interface Drift {
  /** Mean Over/Under variance over the window, FTE. Negative: further under than planned. */
  overUnder: number;
  /** That mean as a share of the plan's mean Required FTE. */
  share: number;
  fromWeek: number;
  toWeek: number;
}

export interface PeriodRow {
  id: string;
  kind: GridRow['kind'];
  label: string;
  code?: string;
  /** The row each week shows, as the Metrics grid builds it: actuals for elapsed weeks, then plan or scenario. */
  byWeek: readonly GridRow[];
  /** The locked plan's row each week, which variance is measured against. */
  planByWeek: readonly GridRow[];
  /** Site rows only: set when the site has drifted off plan. */
  drift: Drift | null;
}

export interface PeriodModel {
  rows: PeriodRow[];
  /** Band per week, index 0 = week 1. */
  bands: readonly Band[];
  /** Shown row model per week, index 0 = week 1. Rows align by position. */
  rowsByWeek: GridRow[][];
  /** Locked plan row model per week. */
  planByWeek: GridRow[][];
  /** Last elapsed week, 0 without actuals. */
  throughWeek: number;
}

export interface PeriodSources {
  /** Observed weeks. Without them every week is planned. */
  actuals?: ActualResult | null;
  /** Open scenario: shown in place of the plan after the elapsed weeks. */
  scenario?: PlanResult | null;
}

export function buildPeriodRows(plan: PlanResult, filters: Filters, grouping: Grouping, sources: PeriodSources = {}): PeriodModel {
  const { actuals, scenario } = sources;
  const throughWeek = actuals?.throughWeek ?? 0;
  const bands: Band[] = plan.weeks.map((w) => (w.index <= throughWeek ? 'actual' : scenario ? 'scenario' : 'plan'));
  const planByWeek = plan.weeks.map((w) => buildRows(plan, { week: w.index, filters, grouping }));
  const rowsByWeek = plan.weeks.map((w, i) => {
    const opts = { week: w.index, filters, grouping };
    if (bands[i] === 'actual') return buildActualRows(actuals!, plan, opts);
    if (bands[i] === 'scenario') return buildRows(scenario!, opts);
    return planByWeek[i]!;
  });
  const first = planByWeek[0] ?? [];
  // Filters and grouping do not vary by week, so every week yields the same rows in the same order.
  for (const wk of [...planByWeek, ...rowsByWeek]) {
    if (wk.length !== first.length || wk.some((r, i) => r.id !== first[i]?.id)) {
      throw new Error('Row model differs between weeks');
    }
  }
  const rows = first.map((r, i): PeriodRow => {
    const row: PeriodRow = {
      id: r.id,
      kind: r.kind,
      label: r.label,
      code: r.code,
      byWeek: rowsByWeek.map((wk) => wk[i]!),
      planByWeek: planByWeek.map((wk) => wk[i]!),
      drift: null,
    };
    if (r.kind === 'site') row.drift = driftOf(row, throughWeek);
    return row;
  });
  return { rows, bands, rowsByWeek, planByWeek, throughWeek };
}

/** Shown value − locked plan value, as the grid shows them. Null in plan weeks. */
export function varianceOf(model: PeriodModel, row: PeriodRow, weekIndex: number, metric: NumericKey): number | null {
  if (model.bands[weekIndex] === 'plan') return null;
  return differenceOf(row.planByWeek[weekIndex]!, row.byWeek[weekIndex]!, metric);
}

/**
 * Which way is better for each metric, read through Over/Under: more demand
 * pushes a site under, more headcount pushes it over.
 */
const BETTER: Readonly<Partial<Record<NumericKey, 1 | -1>>> = {
  volume: -1,
  aht: -1,
  workload: -1,
  productive: -1,
  required: -1,
  planned: 1,
  overUnder: 1,
};

/** --pos when the variance moves the site towards over, --neg towards under. */
export function varianceTone(metric: NumericKey, value: number): Tone {
  if (value === 0) return 'muted';
  const better = BETTER[metric];
  if (!better) return undefined;
  return value * better > 0 ? 'pos' : 'neg';
}

function driftOf(row: PeriodRow, throughWeek: number): Drift | null {
  if (throughWeek === 0) return null;
  const fromWeek = Math.max(1, throughWeek - DRIFT_WEEKS + 1);
  let variance = 0;
  let required = 0;
  for (let w = fromWeek; w <= throughWeek; w++) {
    const shown = row.byWeek[w - 1]!.cells;
    const planned = row.planByWeek[w - 1]!.cells;
    variance += (shown.overUnder ?? 0) - (planned.overUnder ?? 0);
    required += planned.required ?? 0;
  }
  const n = throughWeek - fromWeek + 1;
  const share = required === 0 ? 0 : variance / required;
  return Math.abs(share) >= DRIFT_THRESHOLD ? { overUnder: variance / n, share, fromWeek, toWeek: throughWeek } : null;
}

/** Month of a week by the ISO rule: the month its Thursday falls in. */
export function monthOf(week: PlanWeek): { key: string; label: string } {
  const thursday = new Date(`${week.start}T00:00:00Z`);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  const label = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(thursday);
  return { key: thursday.toISOString().slice(0, 7), label };
}

/** True for the first week of each month after the first, where the heavier rule falls. */
export function startsMonth(weeks: readonly PlanWeek[], i: number): boolean {
  const w = weeks[i];
  const prev = weeks[i - 1];
  return w !== undefined && prev !== undefined && monthOf(w).key !== monthOf(prev).key;
}
