import { describe, expect, it } from 'vitest';
import { demoDataset, PART_TIME } from '../data/dataset.ts';
import { engine, workWeekOf } from '../engine/index.ts';
import { applyScenario, parseStoredScenarios, type Scenario } from '../scenario/scenario.ts';
import { allFilters, bulkDrafts, bulkRows, editedValue, filterApplies, invalidEdit } from './bulk.ts';
import { ALL_FILTERS, buildRows, unitPredicate } from './model.ts';

const ds = demoDataset();
const base = ds.plan;
const plan = engine.computePlan(base);
const scenario = (overrides: Scenario['overrides']): Scenario => ({ id: 's', code: 'SC1', name: 'Scenario 1', forkedFrom: 'v3', overrides });

describe('staff type', () => {
  it('splits voice and chat queues at the sites with a part-time programme, and nowhere else', () => {
    const pt = ds.units.filter((u) => u.staffType === 'part-time');
    expect(new Set(pt.map((u) => u.siteId))).toEqual(new Set(Object.keys(PART_TIME)));
    for (const u of pt) {
      expect(u.channel).not.toBe('deferred');
      expect(ds.units.some((f) => f.id === u.id.replace(/-PT$/, '') && f.staffType === 'full-time')).toBe(true);
    }
    expect(ds.units).toHaveLength(88);
  });

  it('a part-time unit plans at its site part-time work week, with its own assumption record', () => {
    const site = base.sites.find((s) => s.id === 'YYZ')!;
    const unit = base.units.find((u) => u.siteId === 'YYZ' && u.staffType === 'part-time')!;
    expect(workWeekOf(site, unit)).toEqual({ hours: 20, code: 'YYZ.PTW' });
    const up = plan.sites.find((s) => s.site.id === 'YYZ')!.periods[11]!.units.find((u) => u.unit.id === unit.id)!;
    const step = up.requirement.trace.find((s) => s.key === 'workWeekHours')!;
    expect([step.value, step.assumption]).toEqual([20, 'YYZ.PTW']);
    expect(up.requirement.productiveFte).toBeCloseTo(up.requirement.workloadHours / (20 * site.occupancyCeiling), 9);
    expect(ds.assumptions.some((a) => a.code === 'YYZ.PTW' && a.value === 20)).toBe(true);
  });

  it('filters by staff type: part-time shows only the three sites, and the two slices add to the site', () => {
    const ptRows = buildRows(plan, { week: 12, filters: { ...ALL_FILTERS, staffType: ['part-time'] }, grouping: 'none' });
    expect(ptRows.filter((r) => r.kind === 'site').map((r) => r.siteId)).toEqual(['KIN', 'MEX', 'YYZ']);
    const p = plan.sites.find((s) => s.site.id === 'MEX')!.periods[11]!;
    const ft = engine.sliceSitePeriod(p, unitPredicate({ ...ALL_FILTERS, staffType: ['full-time'] }))!;
    const pt = engine.sliceSitePeriod(p, unitPredicate({ ...ALL_FILTERS, staffType: ['part-time'] }))!;
    expect(ft.requiredFte + pt.requiredFte).toBeCloseTo(p.requiredFte, 9);
    expect(ft.closing + pt.closing).toBeCloseTo(p.flow.closing, 9);
  });
});

describe('bulk entry', () => {
  const filters = allFilters(base);

  it('lists units for volume and AHT, sites for site inputs, and site × staff type for the work week', () => {
    expect(bulkRows(base, 'aht', filters, 12)).toHaveLength(88);
    expect(bulkRows(base, 'shrinkage', filters, 12)).toHaveLength(8);
    expect(bulkRows(base, 'workWeek', filters, 12)).toHaveLength(11);
    const accenture = bulkRows(base, 'aht', { ...filters, outsourcer: ['Accenture'], channel: ['voice'] }, 12);
    expect(new Set(accenture.map((r) => r.site.id))).toEqual(new Set(['SZX', 'MEX']));
    expect(accenture.every((r) => r.unit?.channel === 'voice')).toBe(true);
    expect(filterApplies('shrinkage', 'channel')).toBe(false);
    expect(filterApplies('workWeek', 'staffType')).toBe(true);
  });

  it('reads current values in the units a planner types', () => {
    const shr = bulkRows(base, 'shrinkage', filters, 12).find((r) => r.key === 'MNL1')!;
    expect(shr.current).toBeCloseTo(30.5, 9);
    const aht = bulkRows(base, 'aht', filters, 12).find((r) => r.key === 'MNL1-MOB-EN-VO')!;
    expect(aht.current).toBe(base.demand['MNL1-MOB-EN-VO']![11]!.aht);
    expect(editedValue('aht', aht, 10)).toBeCloseTo(aht.current! * 1.1, 9);
    expect(invalidEdit('shrinkage', 120)).not.toBeNull();
    expect(invalidEdit('aht', 5)).toBeNull();
  });

  it('turns edits into one override per metric, converted to plan units', () => {
    const drafts = bulkDrafts({ aht: { 'SZX-MOB-EN-VO': 5, 'MEX-MOB-ES-VO': 5 }, shrinkage: { CAI: 30 }, workWeek: { 'YYZ:part-time': 16 } }, { aht: [12, 52] }, [12, 52]);
    expect(drafts.map((d) => d.metric)).toEqual(['aht', 'shrinkage', 'workWeek']);
    expect(drafts[0]).toMatchObject({ values: { 'SZX-MOB-EN-VO': 0.05 }, fromWeek: 12, toWeek: 52 });
    expect(drafts[1]!.values).toEqual({ CAI: 0.3 });
    expect(drafts[2]!.values).toEqual({ 'YYZ:part-time': 16 });
  });

  it('a bulk AHT edit changes only the listed units, in the listed weeks, and tags them', () => {
    const rows = bulkRows(base, 'aht', { ...filters, outsourcer: ['Accenture'] }, 12);
    const [draft] = bulkDrafts({ aht: Object.fromEntries(rows.map((r) => [r.key, 5])) }, {}, [12, 52]);
    expect([draft!.fromWeek, draft!.toWeek]).toEqual([12, 52]);
    const s = applyScenario(base, scenario([{ ...draft!, code: 'SC1.OV1' }]));
    const szx = 'SZX-MOB-EN-VO';
    expect(s.demand[szx]![11]!.aht).toBeCloseTo(base.demand[szx]![11]!.aht * 1.05, 9);
    expect(s.demand[szx]![11]!.source).toContain('SC1.OV1');
    expect(s.demand[szx]![10]!.aht).toBe(base.demand[szx]![10]!.aht);
    expect(s.demand['MNL1-MOB-EN-VO']![11]!.aht).toBe(base.demand['MNL1-MOB-EN-VO']![11]!.aht);
  });

  it('a shorter part-time week needs more heads for the same work, and carries the override code', () => {
    const [draft] = bulkDrafts({ workWeek: { 'YYZ:part-time': 16 } }, {}, [12, 52]);
    const after = engine.computePlan(applyScenario(base, scenario([{ ...draft!, code: 'SC1.OV1' }])));
    const at = (p: typeof plan, staffType: 'full-time' | 'part-time') =>
      engine.sliceSitePeriod(p.sites.find((x) => x.site.id === 'YYZ')!.periods[20]!, unitPredicate({ ...ALL_FILTERS, staffType: [staffType] }))!.requiredFte;
    expect(at(after, 'part-time') / at(plan, 'part-time')).toBeCloseTo(20 / 16, 9);
    expect(at(after, 'full-time')).toBeCloseTo(at(plan, 'full-time'), 9);
    const unit = after.sites.find((x) => x.site.id === 'YYZ')!.periods[20]!.units.find((u) => u.unit.staffType === 'part-time')!;
    expect(unit.requirement.trace.find((s) => s.key === 'workWeekHours')?.assumption).toBe('SC1.OV1');
  });

  it('keeps bulk overrides through browser storage', () => {
    const [draft] = bulkDrafts({ cap: { MNL1: 950 } }, {}, [12, 52]);
    const saved = JSON.stringify([scenario([{ ...draft!, code: 'SC1.OV1' }])]);
    expect(parseStoredScenarios(saved)[0]!.overrides[0]).toMatchObject({ kind: 'bulk', metric: 'cap', values: { MNL1: 950 } });
  });
});
