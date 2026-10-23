/**
 * Periods view model (v2 Mode A): time across the columns, the hierarchy down
 * the rows, one metric in the cells.
 *
 * Each week's column is the Metrics row model for that week, so every column
 * reconciles exactly as the Metrics grid does: site values add to subtotals
 * and the grand total digit for digit, under any filter or grouping.
 */
import type { PlanResult, PlanWeek } from '../engine/index.ts';
import { buildRows, type ColumnKey, type Filters, type GridRow, type Grouping, type NumericKey } from './model.ts';

/** Metrics the Periods grid can show, in selector order. */
export const PERIOD_METRICS: readonly NumericKey[] = ['volume', 'aht', 'productive', 'required', 'planned', 'overUnder', 'hireNeed'];

/** Over/Under is the number a planner opens the grid to find. */
export const DEFAULT_PERIOD_METRIC: NumericKey = 'overUnder';

export function isPeriodMetric(key: ColumnKey): key is NumericKey {
  return (PERIOD_METRICS as readonly string[]).includes(key);
}

export interface PeriodRow {
  id: string;
  kind: GridRow['kind'];
  label: string;
  code?: string;
  /** The row as the Metrics grid builds it, one per horizon week. */
  byWeek: readonly GridRow[];
}

export interface PeriodModel {
  rows: PeriodRow[];
  /** Metrics row model per week, index 0 = week 1. Rows align by position. */
  rowsByWeek: GridRow[][];
}

export function buildPeriodRows(plan: PlanResult, filters: Filters, grouping: Grouping): PeriodModel {
  const rowsByWeek = plan.weeks.map((w) => buildRows(plan, { week: w.index, filters, grouping }));
  const first = rowsByWeek[0] ?? [];
  // Filters and grouping do not vary by week, so every week yields the same rows in the same order.
  for (const wk of rowsByWeek) {
    if (wk.length !== first.length || wk.some((r, i) => r.id !== first[i]?.id)) {
      throw new Error('Row model differs between weeks');
    }
  }
  const rows = first.map((r, i) => ({
    id: r.id,
    kind: r.kind,
    label: r.label,
    code: r.code,
    byWeek: rowsByWeek.map((wk) => wk[i]!),
  }));
  return { rows, rowsByWeek };
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
