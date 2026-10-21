import { describe, expect, it } from 'vitest';
import { demoDataset } from '../data/dataset.ts';
import { engine } from '../engine/index.ts';
import { applyScenario } from '../scenario/scenario.ts';
import { buildHiringPlan, sumClasses } from './hiring.ts';

const ds = demoDataset();
const plan = engine.computePlan(ds.plan);
const hp = buildHiringPlan(plan, ds.plan.constants, ds.plan.isoYear);

describe('hiring plan', () => {
  it('lists every recommended class, and only those', () => {
    const fromPlan = plan.sites.flatMap((sp) => sp.periods.filter((p) => p.flow.hiresToStart > 0));
    expect(hp.classes).toHaveLength(fromPlan.length);
    expect(sumClasses(hp.classes).starters).toBe(fromPlan.reduce((s, p) => s + p.flow.hiresToStart, 0));
  });

  it('groups by start week in order, and the groups add to the total', () => {
    const weeks = hp.byWeek.map((g) => g.week);
    expect(weeks).toEqual([...weeks].sort((a, b) => a - b));
    expect(new Set(weeks).size).toBe(weeks.length);
    expect(hp.byWeek.reduce((s, g) => s + sumClasses(g.classes).starters, 0)).toBe(sumClasses(hp.classes).starters);
  });

  it('schedules each class training, then nesting, then production in the week of need', () => {
    for (const c of hp.classes) {
      expect(c.productiveWeek - c.startWeek).toBe(hp.trainingWeeks + hp.nestingWeeks);
      expect(c.startWeek).toBeGreaterThanOrEqual(1);
      expect(c.trainingLabel.startsWith(c.startLabel.slice(5))).toBe(true);
    }
    const first = hp.byWeek[0]!;
    expect(first.label).toBe('2027-W01');
    expect(first.date).toBe('2027-01-04');
  });

  it('never asks for a class below the minimum unless the cap leaves less room', () => {
    for (const c of hp.classes) if (c.starters < hp.minClassSize) expect(c.capLimited, c.id).toBe(true);
  });

  it('lists what hiring cannot cover: the lead time and the Manila-1 cap', () => {
    const lead = hp.exceptions.filter((e) => e.kind === 'lead');
    expect(lead.length).toBeGreaterThan(0);
    for (const e of lead) expect(Math.max(...e.weeks)).toBeLessThanOrEqual(6);
    const cap = hp.exceptions.find((e) => e.kind === 'cap' && e.siteId === 'MNL1');
    expect(cap?.weeks).toContain(32);
  });

  it('filters by outsourcer', () => {
    const tp = buildHiringPlan(plan, ds.plan.constants, ds.plan.isoYear, new Set(['Teleperformance']));
    expect(new Set(tp.classes.map((c) => c.outsourcer))).toEqual(new Set(['Teleperformance']));
  });

  it('follows a scenario: more volume means more starters', () => {
    const scen = engine.computePlan(
      applyScenario(ds.plan, {
        id: 's',
        code: 'SC1',
        name: 'Scenario 1',
        forkedFrom: 'v3',
        overrides: [{ code: 'SC1.OV1', kind: 'volume', scope: { type: 'all' }, mode: 'add', value: 10_000, fromWeek: 1, toWeek: 52 }],
      }),
    );
    const more = buildHiringPlan(scen, ds.plan.constants, ds.plan.isoYear);
    expect(sumClasses(more.classes).starters).toBeGreaterThan(sumClasses(hp.classes).starters);
  });
});
