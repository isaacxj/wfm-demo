/**
 * Comparison view model: baseline and scenario rows side by side, with a
 * delta per metric.
 *
 * Both sides come from buildRows, so each side reconciles on its own, and a
 * summed metric's delta is the difference of the displayed values: site deltas
 * add to the subtotal delta digit for digit.
 */
import { TraceBuilder, type PlanResult } from '../engine/index.ts';
import { cellTrace, membersOf, type CellTrace } from './cellTrace.ts';
import { displayRound } from './format.ts';
import { buildRows, columnSpec, type ColumnKey, type GridRow, type NumericKey, type RowModelOptions } from './model.ts';

export type Side = 'base' | 'scen' | 'delta';

/** Metrics the comparison can show, in display order. */
export const COMPARE_METRICS: readonly NumericKey[] = [
  'volume',
  'aht',
  'workload',
  'shrink',
  'productive',
  'required',
  'opening',
  'attrition',
  'hires',
  'planned',
  'overUnder',
  'hireNeed',
];

export const DEFAULT_COMPARE_HIDDEN: ReadonlySet<ColumnKey> = new Set<ColumnKey>([
  'workload',
  'shrink',
  'productive',
  'opening',
  'attrition',
  'hires',
]);

export interface CompareRow {
  id: string;
  kind: GridRow['kind'];
  base: GridRow;
  scen: GridRow;
  /** Any metric differs, before display rounding. */
  changed: boolean;
}

export interface CompareModel {
  rows: CompareRow[];
  baseRows: GridRow[];
  scenRows: GridRow[];
  changedSites: number;
  totalSites: number;
}

export function buildCompare(base: PlanResult, scen: PlanResult, opts: RowModelOptions, changedOnly: boolean): CompareModel {
  const baseRows = buildRows(base, opts);
  const scenRows = buildRows(scen, opts);
  const scenById = new Map(scenRows.map((r) => [r.id, r]));

  const all: CompareRow[] = baseRows.map((b) => {
    const s = scenById.get(b.id);
    if (!s) throw new Error(`Scenario has no row ${b.id}`);
    return { id: b.id, kind: b.kind, base: b, scen: s, changed: differs(b, s) };
  });

  const sites = all.filter((r) => r.kind === 'site');
  const changedSites = sites.filter((r) => r.changed).length;
  let rows = all;
  if (changedOnly) {
    // Keep changed sites, and the headers and totals of groups that hold one.
    rows = [];
    let block: CompareRow[] = [];
    for (const r of all) {
      if (r.kind === 'group') block = [r];
      else if (r.kind === 'site') {
        if (r.changed) block.push(r);
      } else if (r.kind === 'subtotal') {
        if (block.some((x) => x.kind === 'site')) rows.push(...block, r);
        block = [];
      } else {
        if (block.some((x) => x.kind === 'site')) rows.push(...block);
        block = [];
        if (changedSites > 0) rows.push(r);
      }
    }
  }
  return { rows, baseRows, scenRows, changedSites, totalSites: sites.length };
}

function differs(a: GridRow, b: GridRow): boolean {
  if (a.kind === 'group') return false;
  if (a.classStart !== b.classStart || a.atCap !== b.atCap) return true;
  return COMPARE_METRICS.some((k) => Math.abs((a.cells[k] ?? 0) - (b.cells[k] ?? 0)) > 1e-9);
}

/** Delta as the grid shows it: difference of displayed values for summed metrics. */
export function deltaOf(row: CompareRow, key: NumericKey): number | null {
  return differenceOf(row.base, row.scen, key);
}

/** `other` − `base` for one metric, as the grid shows it: summed metrics differ by their displayed values. */
export function differenceOf(base: GridRow, other: GridRow, key: NumericKey): number | null {
  const b = base.cells[key];
  const s = other.cells[key];
  if (b === null || b === undefined || s === null || s === undefined) return null;
  const spec = columnSpec(key);
  const format = spec.format ?? 'one';
  if (spec.aggregate === 'sum') return displayRound(displayRound(s, format) - displayRound(b, format), format);
  return s - b;
}

/** Trace for a delta cell: scenario minus baseline, each side opening into its own chain. */
export function deltaTrace(row: CompareRow, key: NumericKey, model: CompareModel, scenarioName: string): CellTrace | null {
  return differenceTrace(
    { row: row.base, rows: model.baseRows, label: 'Baseline' },
    { row: row.scen, rows: model.scenRows, label: scenarioName },
    key,
    { label: `${columnSpec(key).header} change`, formula: 'scenario − baseline' },
  );
}

export interface TraceSide {
  row: GridRow;
  /** The rows the side was built in, to find an aggregate row's members. */
  rows: readonly GridRow[];
  label: string;
}

/** Trace for `other` − `base`: each side an input that opens into its own chain. */
export function differenceTrace(base: TraceSide, other: TraceSide, key: NumericKey, step: { label: string; formula: string }): CellTrace | null {
  const spec = columnSpec(key);
  const format = spec.format ?? 'one';
  const baseTrace = cellTrace(base.row, key, membersOf(base.rows, base.row));
  const otherTrace = cellTrace(other.row, key, membersOf(other.rows, other.row));
  const b = base.row.cells[key];
  const s = other.row.cells[key];
  if (!baseTrace || !otherTrace || b == null || s == null) return null;
  const summed = spec.aggregate === 'sum';
  const unit = baseTrace.steps.find((x) => x.key === baseTrace.focus)?.unit ?? 'FTE';
  const t = new TraceBuilder();
  const bRef = t.input('base', summed ? `${base.label} (as displayed)` : base.label, summed ? displayRound(b, format) : b, unit);
  t.attach('base', [{ id: 'base', label: base.label, steps: baseTrace.steps, focus: baseTrace.focus }]);
  const sRef = t.input('scen', summed ? `${other.label} (as displayed)` : other.label, summed ? displayRound(s, format) : s, unit);
  t.attach('scen', [{ id: 'scen', label: other.label, steps: otherTrace.steps, focus: otherTrace.focus }]);
  const value = differenceOf(base.row, other.row, key) ?? 0;
  t.calc('delta', step.label, value, unit, step.formula, `${sRef.expr}-${bRef.expr}`, [sRef, bRef]);
  return { steps: t.steps, focus: 'delta' };
}

/** Horizon totals for the summary strip. */
export interface HorizonSummary {
  avgRequired: [number, number];
  starters: [number, number];
  capShortfallWeeks: [number, number];
  leadShortfallFte: [number, number];
}

export function horizonSummary(base: PlanResult, scen: PlanResult): HorizonSummary {
  const sum = (p: PlanResult, f: (x: PlanResult['sites'][number]['periods'][number]) => number) =>
    p.sites.reduce((a, sp) => a + sp.periods.reduce((b, x) => b + f(x), 0), 0);
  const both = (f: (p: PlanResult) => number): [number, number] => [f(base), f(scen)];
  return {
    avgRequired: both((p) => sum(p, (x) => x.requiredFte) / p.weeks.length),
    starters: both((p) => sum(p, (x) => x.flow.hiresToStart)),
    capShortfallWeeks: both((p) => sum(p, (x) => (x.flow.capShortfall > 0.05 ? 1 : 0))),
    leadShortfallFte: both((p) => sum(p, (x) => x.flow.leadTimeShortfall)),
  };
}
