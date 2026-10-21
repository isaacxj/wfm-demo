import { describe, expect, it } from 'vitest';
import { demoDataset } from '../data/dataset.ts';
import { engine, type TraceStep } from '../engine/index.ts';
import { evaluateExcel } from '../testing/excel.ts';
import { cellTrace, chainOf, membersOf } from './cellTrace.ts';
import { ALL_FILTERS, buildRows, COLUMNS, type Filters, type GridRow, type NumericKey } from './model.ts';

const plan = engine.computePlan(demoDataset().plan);

/** Inputs that are structural rather than assumptions: no record code needed. */
const STRUCTURAL = new Set(['transfersIn', 'transfersOut', 'week', 'occupancy']);
const tail = (key: string) => key.split('.').at(-1)!;

/** Every value reachable from the focus resolves to coded inputs or sub-chains. */
function expectTraceable(steps: readonly TraceStep[], focus: string, where: string, depth = 0): void {
  const chain = chainOf(steps, focus);
  expect(chain.at(-1)?.key, where).toBe(focus);
  for (const s of chain) {
    const isInput = s.formula === undefined;
    if (isInput) {
      const ok = s.assumption !== undefined || s.parts !== undefined || (s.deps?.length ?? 0) > 0 || STRUCTURAL.has(tail(s.key));
      expect(ok, `${where}: input ${s.key} has no source`).toBe(true);
    } else {
      expect((s.deps?.length ?? 0) > 0 || s.parts !== undefined, `${where}: ${s.key} has no inputs`).toBe(true);
    }
    // Follow sub-chains one level: unit traces and member sites.
    if (depth < 1) for (const p of s.parts ?? []) expectTraceable(p.steps, p.focus, `${where} > ${p.label}`, depth + 1);
  }
}

function checkRows(rows: readonly GridRow[], label: string): void {
  for (const row of rows) {
    if (row.kind === 'group') continue;
    for (const col of COLUMNS) {
      if (col.key === 'site') continue;
      const ct = cellTrace(row, col.key, membersOf(rows, row));
      const where = `${label} ${row.label} ${col.key}`;
      if (col.key === 'classStart') {
        if (row.classStart) expect(ct, where).not.toBeNull();
        continue;
      }
      const cell = row.cells[col.key as NumericKey];
      if (cell === null || cell === undefined) continue;
      expect(ct, where).not.toBeNull();
      const focus = ct!.steps.find((s) => s.key === ct!.focus)!;
      expect(focus.value, where).toBeCloseTo(cell, 6);
      // What "Copy as Excel formula" puts on the clipboard reproduces the cell.
      expect(evaluateExcel(focus.excel!), `${where} excel`).toBeCloseTo(cell, 6);
      expectTraceable(ct!.steps, ct!.focus, where);
    }
  }
}

describe('every grid number traces to its inputs', () => {
  it('unfiltered, weeks 1, 7, 12, 32 and 52, every grouping', () => {
    for (const week of [1, 7, 12, 32, 52]) {
      for (const grouping of ['outsourcer', 'country', 'none'] as const) {
        checkRows(buildRows(plan, { week, filters: ALL_FILTERS, grouping }), `W${week} ${grouping}`);
      }
    }
  });

  it('under filters', () => {
    const cases: Filters[] = [
      { ...ALL_FILTERS, channel: ['chat'] },
      { lob: ['Mobile'], language: ['EN', 'TL'], channel: ['voice', 'deferred'] },
    ];
    for (const filters of cases) checkRows(buildRows(plan, { week: 32, filters, grouping: 'outsourcer' }), 'filtered');
  });

  it('states that Required FTE includes shrinkage wherever the step appears', () => {
    const rows = buildRows(plan, { week: 12, filters: ALL_FILTERS, grouping: 'outsourcer' });
    const site = rows.find((r) => r.kind === 'site')!;
    const ct = cellTrace(site, 'required')!;
    const step = ct.steps.find((s) => s.key === ct.focus)!;
    expect(step.label).toBe('Required FTE (Σ 12 units)');
    expect(step.note).toBe('Required FTE includes shrinkage.');
    for (const part of step.parts ?? []) expect(part.steps.find((s) => s.key === 'required')?.note).toBe('Required FTE includes shrinkage.');
    const flow = chainOf(site.slice!.siteTrace, 'flow.overUnder').find((s) => s.key === 'flow.required');
    expect(flow?.note).toBe('Required FTE includes shrinkage.');
  });

  it('opening headcount links back to the prior week', () => {
    const p = plan.sites[0]!.periods[11]!;
    const opening = p.trace.find((s) => s.key === 'flow.opening')!;
    expect(opening.parts?.[0]?.label).toBe('2027-W11 closing');
    expect(opening.parts?.[0]?.steps).toBe(plan.sites[0]!.periods[10]!.trace);
  });

  it('the chain for Over/Under ends on it and includes the attrition rate', () => {
    const p = plan.sites[0]!.periods[31]!;
    const keys = chainOf(p.trace, 'flow.overUnder').map((s) => s.key);
    expect(keys.at(-1)).toBe('flow.overUnder');
    expect(keys).toContain('flow.attr.periodAttrition');
    expect(keys).toContain('required');
  });
});
