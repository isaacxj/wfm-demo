import { describe, expect, it } from 'vitest';
import { demoDataset } from '../data/dataset.ts';
import { engine } from '../engine/index.ts';
import { applyScenario, type Override } from '../scenario/scenario.ts';
import { evaluateExcel } from '../testing/excel.ts';
import { buildCompare, COMPARE_METRICS, deltaOf, deltaTrace, horizonSummary } from './compare.ts';
import { columnSpec } from './model.ts';
import { ALL_FILTERS } from './model.ts';

const base = demoDataset().plan;
const basePlan = engine.computePlan(base);
const scen = (o: Override) => engine.computePlan(applyScenario(base, { id: 's', code: 'SC1', name: 'Scenario 1', forkedFrom: 'v3', overrides: [o] }));
const opts = { week: 12, filters: ALL_FILTERS, grouping: 'outsourcer' as const };

const plus10k = scen({ code: 'SC1.OV1', kind: 'volume', scope: { type: 'all' }, mode: 'add', value: 10_000, fromWeek: 1, toWeek: 52 });
const capMnl1 = scen({ code: 'SC1.OV1', kind: 'cap', scope: { type: 'site', siteId: 'MNL1' }, value: 900 });

describe('comparison', () => {
  it('shows +10,000 contacts in the grand total volume delta', () => {
    const m = buildCompare(basePlan, plus10k, opts, false);
    const total = m.rows.find((r) => r.kind === 'total')!;
    expect(deltaOf(total, 'volume')).toBe(10_000);
    expect(deltaOf(total, 'required')!).toBeGreaterThan(0);
  });

  it('site deltas add to subtotal and total deltas for every summed metric', () => {
    const m = buildCompare(basePlan, plus10k, opts, false);
    for (const key of COMPARE_METRICS.filter((k) => columnSpec(k).aggregate === 'sum')) {
      const sites = m.rows.filter((r) => r.kind === 'site');
      const total = m.rows.find((r) => r.kind === 'total')!;
      const add = sites.reduce((s, r) => s + deltaOf(r, key)!, 0);
      expect(deltaOf(total, key), key).toBeCloseTo(add, 9);
    }
  });

  it('changed rows only keeps just the changed site, its group and the total', () => {
    // W13: in W12 Manila-1 has no class of its own (its start week, W06, is blocked), so it sits below any cap.
    const m = buildCompare(basePlan, capMnl1, { ...opts, week: 13 }, true);
    expect(m.changedSites).toBe(1);
    expect(m.rows.map((r) => `${r.kind}:${r.base.label}`)).toEqual([
      'group:Teleperformance',
      'site:Manila-1',
      'subtotal:Subtotal Teleperformance',
      'total:Grand total',
    ]);
    const mnl1 = m.rows[1]!;
    expect(mnl1.scen.atCap).toBe(true);
    expect(deltaOf(mnl1, 'overUnder')!).toBeLessThan(-50);
  });

  it('with no overrides nothing has changed', () => {
    const m = buildCompare(basePlan, engine.computePlan(base), opts, true);
    expect(m.changedSites).toBe(0);
    expect(m.rows).toHaveLength(0);
  });

  it('a delta trace reproduces the delta and opens into both chains', () => {
    const m = buildCompare(basePlan, plus10k, opts, false);
    for (const row of m.rows.filter((r) => r.kind !== 'group')) {
      for (const key of ['volume', 'required', 'planned', 'overUnder'] as const) {
        const t = deltaTrace(row, key, m, 'Scenario 1')!;
        const focus = t.steps.find((s) => s.key === t.focus)!;
        expect(focus.value).toBeCloseTo(deltaOf(row, key)!, 9);
        expect(evaluateExcel(focus.excel!)).toBeCloseTo(focus.value, 9);
        expect(t.steps.filter((s) => s.parts).length).toBe(2);
      }
    }
  });

  it('summarises the horizon', () => {
    const s = horizonSummary(basePlan, plus10k);
    expect(s.avgRequired[1]).toBeGreaterThan(s.avgRequired[0]);
    expect(s.starters[1]).toBeGreaterThan(s.starters[0]);
    const c = horizonSummary(basePlan, capMnl1);
    expect(c.capShortfallWeeks[1]).toBeGreaterThan(c.capShortfallWeeks[0]);
  });
});
