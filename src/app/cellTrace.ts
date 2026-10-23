/**
 * Which trace, and which step in it, explains a grid cell.
 *
 * Site rows read the engine's own trace. Subtotal and total rows are a
 * presentation sum of the site values as displayed, so their trace is built
 * here: one input per member site, each carrying that site's trace as a part.
 */
import { TraceBuilder, type Ref, type TraceStep } from '../engine/index.ts';
import { displayRound } from './format.ts';
import { columnSpec, type ColumnKey, type GridRow, type NumericKey } from './model.ts';

export interface CellTrace {
  steps: readonly TraceStep[];
  focus: string;
}

/** Step key per column in an unfiltered site-week trace. */
const SITE_FOCUS: Readonly<Partial<Record<ColumnKey, string>>> = {
  volume: 'volume',
  aht: 'aht',
  workload: 'workload',
  occ: 'occupancyCeiling',
  shrink: 'shrinkage',
  productive: 'productive',
  required: 'required',
  opening: 'flow.opening',
  attrition: 'flow.attrition',
  hires: 'flow.hiresProductive',
  planned: 'flow.closing',
  overUnder: 'flow.overUnder',
  hireNeed: 'flow.hiresToStart',
  classStart: 'flow.startPeriod',
};

/** Step key per column in a filtered slice trace. Others read the site trace. */
const SLICE_FOCUS: Readonly<Partial<Record<ColumnKey, string>>> = {
  volume: 'volume',
  aht: 'aht',
  workload: 'workload',
  productive: 'productive',
  required: 'required',
  opening: 'opening',
  attrition: 'attrition',
  hires: 'hiresProductive',
  planned: 'closing',
  overUnder: 'overUnder',
  hireNeed: 'hiresToStart',
};

/** Step key per column in an actual site-week trace, whole or sliced. */
const ACTUAL_FOCUS: Readonly<Partial<Record<ColumnKey, string>>> = {
  volume: 'volume',
  aht: 'aht',
  workload: 'workload',
  productive: 'productive',
  required: 'required',
  planned: 'headcount',
  overUnder: 'overUnder',
};

const ACTUAL_SITE_FOCUS: Readonly<Partial<Record<ColumnKey, string>>> = {
  occ: 'occupancyCeiling',
  shrink: 'shrinkage',
};

export function cellTrace(row: GridRow, key: ColumnKey, members: readonly GridRow[] = []): CellTrace | null {
  if (key === 'site' || row.kind === 'group') return null;
  if (row.kind === 'site' && row.actual) {
    const a = row.actual;
    if (ACTUAL_FOCUS[key]) return { steps: a.trace, focus: ACTUAL_FOCUS[key] };
    const focus = ACTUAL_SITE_FOCUS[key];
    return focus ? { steps: a.siteTrace, focus } : null;
  }
  if (row.kind === 'site') {
    const slice = row.slice;
    if (!slice) return null;
    if (slice.allocated && SLICE_FOCUS[key]) return { steps: slice.trace, focus: SLICE_FOCUS[key] };
    const focus = SITE_FOCUS[key];
    return focus ? { steps: slice.siteTrace, focus } : null;
  }
  return aggregateTrace(key, members);
}

function aggregateTrace(key: ColumnKey, members: readonly GridRow[]): CellTrace | null {
  const spec = columnSpec(key);
  const sites = members.filter((m) => m.kind === 'site' && (m.slice || m.actual) && m.cells[key as NumericKey] != null);
  if (sites.length === 0) return null;
  const raw = (m: GridRow, k: NumericKey) => m.cells[k] ?? 0;
  const t = new TraceBuilder();

  const memberInput = (m: GridRow, k: ColumnKey, value: number, unitKey: string, label: string): Ref => {
    const ref = t.input(`${m.siteId}.${unitKey}`, `${m.label} ${label}`, value, unitOf(k));
    const sub = cellTrace(m, k);
    if (sub) t.attach(ref.key, [{ id: m.id, label: m.label, steps: sub.steps, focus: sub.focus }]);
    return ref;
  };

  switch (spec.aggregate) {
    case 'sum': {
      const refs = sites.map((m) =>
        memberInput(m, key, displayRound(m.cells[key as keyof typeof m.cells] ?? 0, spec.format ?? 'one'), key, '(as displayed)'),
      );
      const total = displayRound(
        refs.reduce((s, r) => s + r.value, 0),
        spec.format ?? 'one',
      );
      t.calc('total', `${spec.header} (Σ ${refs.length} sites)`, total, unitOf(key), `Σ site ${spec.header.toLowerCase()} as displayed`, refs.map((r) => r.expr).join('+'), refs);
      return { steps: t.steps, focus: 'total' };
    }
    case 'ahtWeighted': {
      const vols = sites.map((m) => memberInput(m, 'volume', raw(m, 'volume'), 'volume', 'volume'));
      const ahts = sites.map((m) => memberInput(m, 'aht', raw(m, 'aht'), 'aht', 'AHT'));
      const vol = vols.reduce((s, r) => s + r.value, 0);
      const handled = sites.reduce((s, m) => s + raw(m, 'volume') * raw(m, 'aht'), 0);
      t.calc(
        'total',
        'AHT (volume weighted)',
        vol === 0 ? 0 : handled / vol,
        'seconds',
        'Σ(volume × AHT) ÷ Σ volume',
        vol === 0 ? '0' : `(${vols.map((v, i) => `${v.expr}*${ahts[i]!.expr}`).join('+')})/(${vols.map((v) => v.expr).join('+')})`,
        [...vols, ...ahts],
      );
      return { steps: t.steps, focus: 'total' };
    }
    case 'effectiveShrink': {
      const prod = sites.map((m) => memberInput(m, 'productive', raw(m, 'productive'), 'productive', 'productive FTE'));
      const reqd = sites.map((m) => memberInput(m, 'required', raw(m, 'required'), 'required', 'required FTE'));
      const r = reqd.reduce((s, x) => s + x.value, 0);
      t.calc(
        'total',
        'Effective shrinkage',
        r === 0 ? 0 : 1 - prod.reduce((s, x) => s + x.value, 0) / r,
        'ratio',
        '1 − Σ productive ÷ Σ required',
        r === 0 ? '0' : `1-(${prod.map((x) => x.expr).join('+')})/(${reqd.map((x) => x.expr).join('+')})`,
        [...prod, ...reqd],
      );
      return { steps: t.steps, focus: 'total' };
    }
    case 'none':
      return null;
  }
}

function unitOf(key: ColumnKey) {
  switch (key) {
    case 'volume':
      return 'contacts' as const;
    case 'workload':
      return 'hours' as const;
    case 'aht':
      return 'seconds' as const;
    case 'opening':
    case 'attrition':
    case 'hires':
    case 'planned':
    case 'hireNeed':
      return 'heads' as const;
    default:
      return 'FTE' as const;
  }
}

/** Steps the focus depends on, in trace order, ending with the focus. */
export function chainOf(steps: readonly TraceStep[], focus: string): TraceStep[] {
  const byKey = new Map(steps.map((s) => [s.key, s]));
  const keep = new Set<string>();
  const visit = (k: string) => {
    if (keep.has(k)) return;
    const s = byKey.get(k);
    if (!s) return;
    keep.add(k);
    for (const d of s.deps ?? []) visit(d);
  };
  visit(focus);
  return steps.filter((s) => keep.has(s.key));
}

/** Members of an aggregate row: the site rows it sums. */
export function membersOf(rows: readonly GridRow[], row: GridRow): GridRow[] {
  if (row.kind === 'total') return rows.filter((r) => r.kind === 'site');
  if (row.kind !== 'subtotal') return [];
  const i = rows.indexOf(row);
  const out: GridRow[] = [];
  for (let j = i - 1; j >= 0 && rows[j]!.kind === 'site'; j--) out.unshift(rows[j]!);
  return out;
}
