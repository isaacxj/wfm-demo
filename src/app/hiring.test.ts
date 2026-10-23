import { describe, expect, it } from 'vitest';
import { demoDataset } from '../data/dataset.ts';
import { engine } from '../engine/index.ts';
import { applyScenario } from '../scenario/scenario.ts';
import { buildHiringPlan, sumClasses } from './hiring.ts';

const ds = demoDataset();
const plan = engine.computePlan(ds.plan);
const hp = buildHiringPlan(plan, ds.plan.constants, ds.plan.isoYear);

describe('hiring plan', () => {
  it('lists every recommended starter, and only those', () => {
    const own = plan.sites.reduce((s, sp) => s + sp.periods.reduce((a, p) => a + p.flow.hiresToStart, 0), 0);
    const moved = plan.sites.reduce((s, sp) => s + sp.moved.reduce((a, m) => a + m.starters, 0), 0);
    expect(moved).toBeGreaterThan(0);
    expect(sumClasses(hp.classes).starters).toBe(own + moved);
  });

  it('no proposed class breaks a class constraint', () => {
    const c = ds.plan.constants;
    const blocked = new Set(c.blockedWeeks);
    const perSiteWeek = new Map<string, number>();
    for (const k of hp.classes) {
      expect(blocked.has(k.startWeek), `${k.id} starts in a blocked week`).toBe(false);
      expect(k.starters, k.id).toBeLessThanOrEqual(c.maxClassSize!);
      expect(k.starters, k.id).toBeGreaterThanOrEqual(c.minClassSize);
      const key = `${k.siteId}:${k.startWeek}`;
      perSiteWeek.set(key, (perSiteWeek.get(key) ?? 0) + 1);
    }
    for (const [key, n] of perSiteWeek) expect(n, key).toBeLessThanOrEqual(c.maxClassesPerWeek!);
  });

  it('every moved class starts earlier, never later, and explains itself', () => {
    const c = ds.plan.constants;
    const moves = plan.sites.flatMap((sp) => sp.moved);
    expect(moves.some((m) => m.reason.includes('Holy Week'))).toBe(true);
    expect(moves.some((m) => m.reason.includes('full: 2 classes of 30'))).toBe(true);
    for (const m of moves) {
      expect(m.startWeek).toBeLessThan(m.idealStartWeek);
      expect(m.landWeek).toBe(m.startWeek + c.trainingWeeks + c.nestingWeeks);
      expect(m.forWeek).toBe(m.idealStartWeek + c.trainingWeeks + c.nestingWeeks);
      const listed = hp.exceptions.find((e) => e.kind === 'moved' && e.move === m);
      expect(listed?.reason, `${m.siteId} W${m.startWeek}`).toBe(m.reason);
      expect(hp.classes.filter((k) => k.siteId === m.siteId && k.startWeek === m.startWeek).every((k) => k.moved.includes(m))).toBe(true);
    }
  });

  it('a moved class covers the week it was hired for, and its graduates are not counted against the weeks between', () => {
    const kin = plan.sites.find((sp) => sp.site.id === 'KIN')!;
    const m = kin.moved.find((x) => x.idealStartWeek === 12)!;
    expect(m.startWeek).toBe(11);
    const forWeek = kin.periods[m.forWeek - 1]!;
    expect(forWeek.flow.hiresToStart).toBe(0);
    expect(forWeek.flow.overUnder).toBeGreaterThanOrEqual(-1e-9);
    // The week it lands, the graduates are in supply but held for later.
    const landing = kin.periods[m.landWeek - 1]!;
    expect(landing.flow.earlyGraduates).toBeGreaterThan(0);
    expect(landing.flow.reserved).toBeCloseTo(landing.flow.earlyGraduates, 9);
  });

  it('lists a need no week can take, with the reason', () => {
    const e = hp.exceptions.find((x) => x.kind === 'constraint' && x.siteId === 'MNL1');
    expect(e?.weeks).toContain(12);
    expect(e?.reason).toContain('W06 blocked (Lunar New Year)');
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
