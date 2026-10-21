import { describe, expect, it } from 'vitest';
import { demoDataset } from '../data/dataset.ts';
import { engine } from '../engine/index.ts';
import { applyScenario, parseStoredScenarios, type Override, type Scenario } from './scenario.ts';

const base = demoDataset().plan;
const basePlan = engine.computePlan(base);

const scenario = (...overrides: Override[]): Scenario => ({
  id: 's1',
  code: 'SC1',
  name: 'Scenario 1',
  forkedFrom: 'v3',
  overrides,
});

const weekVolume = (plan: typeof base, w: number) =>
  Object.values(plan.demand).reduce((s, cells) => s + cells[w - 1]!.volume, 0);

describe('applyScenario', () => {
  it('never changes the baseline', () => {
    const before = JSON.stringify(base);
    applyScenario(base, scenario({ code: 'SC1.OV1', kind: 'volume', scope: { type: 'all' }, mode: 'add', value: 10_000, fromWeek: 1, toWeek: 52 }));
    expect(JSON.stringify(base)).toBe(before);
  });

  it('adds exactly 10,000 contacts every week across all sites', () => {
    const s = applyScenario(base, scenario({ code: 'SC1.OV1', kind: 'volume', scope: { type: 'all' }, mode: 'add', value: 10_000, fromWeek: 1, toWeek: 52 }));
    for (let w = 1; w <= 52; w++) expect(weekVolume(s, w) - weekVolume(base, w)).toBe(10_000);
  });

  it('limits a volume override to its weeks and scope', () => {
    const s = applyScenario(base, scenario({ code: 'SC1.OV1', kind: 'volume', scope: { type: 'site', siteId: 'MNL1' }, mode: 'add', value: 5_000, fromWeek: 10, toWeek: 12 }));
    expect(weekVolume(s, 9)).toBe(weekVolume(base, 9));
    expect(weekVolume(s, 11) - weekVolume(base, 11)).toBe(5_000);
    const touched = Object.entries(s.demand).filter(([id, cells]) => cells[10]!.volume !== base.demand[id]![10]!.volume);
    expect(touched.every(([id]) => id.startsWith('MNL1-'))).toBe(true);
  });

  it('tags every overridden input with the override code', () => {
    const s = applyScenario(base, scenario({ code: 'SC1.OV1', kind: 'aht', scope: { type: 'outsourcer', outsourcer: 'Accenture' }, pct: 0.05, fromWeek: 1, toWeek: 52 }));
    expect(s.demand['SZX-MOB-EN-VO']![0]!.source).toBe('FC27.SZX-MOB-EN-VO.W01 + SC1.OV1');
    expect(s.demand['MNL1-MOB-EN-VO']![0]!.source).toBe('FC27.MNL1-MOB-EN-VO.W01');
  });

  it('AHT +5% raises required FTE by 5% in every week', () => {
    const s = engine.computePlan(applyScenario(base, scenario({ code: 'SC1.OV1', kind: 'aht', scope: { type: 'all' }, pct: 0.05, fromWeek: 1, toWeek: 52 })));
    const total = (p: typeof basePlan, w: number) => p.sites.reduce((x, sp) => x + sp.periods[w - 1]!.requiredFte, 0);
    for (const w of [1, 12, 32, 52]) expect(total(s, w) / total(basePlan, w)).toBeCloseTo(1.05, 9);
  });

  it('a Manila-1 cap below requirement binds and surfaces the shortfall', () => {
    const s = engine.computePlan(applyScenario(base, scenario({ code: 'SC1.OV1', kind: 'cap', scope: { type: 'site', siteId: 'MNL1' }, value: 900 })));
    const mnl1 = s.sites.find((x) => x.site.id === 'MNL1')!;
    const p = mnl1.periods[11]!;
    expect(p.flow.closing).toBeLessThanOrEqual(900 + 1e-9);
    expect(p.flow.atCap).toBe(true);
    expect(p.flow.capShortfall).toBeGreaterThan(50);
    expect(p.trace.find((x) => x.key === 'flow.cap')?.assumption).toBe('SC1.OV1');
  });

  it('shrinkage and attrition overrides reach the site and carry their code', () => {
    const s = applyScenario(
      base,
      scenario(
        { code: 'SC1.OV1', kind: 'shrinkage', scope: { type: 'site', siteId: 'KIN' }, value: 0.35 },
        { code: 'SC1.OV2', kind: 'attrition', scope: { type: 'outsourcer', outsourcer: 'Teleperformance' }, value: 0.06 },
      ),
    );
    const kin = s.sites.find((x) => x.id === 'KIN')!;
    expect(kin.shrinkage).toBe(0.35);
    expect(kin.codes.shrinkage).toBe('SC1.OV1');
    expect(s.sites.filter((x) => x.monthlyAttrition === 0.06).map((x) => x.id)).toEqual(['MNL1', 'MNL2', 'CAI']);
  });

  it('computes a scenario well inside one second', () => {
    const t0 = performance.now();
    engine.computePlan(applyScenario(base, scenario({ code: 'SC1.OV1', kind: 'volume', scope: { type: 'all' }, mode: 'add', value: 10_000, fromWeek: 1, toWeek: 52 })));
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe('stored scenarios', () => {
  it('migrates scenarios saved with the old vendor scope', () => {
    const old = JSON.stringify([
      {
        id: 's1',
        code: 'SC1',
        name: 'Scenario 1',
        forkedFrom: 'FY27 Production Plan v3',
        overrides: [{ code: 'SC1.OV1', kind: 'aht', scope: { type: 'vendor', vendor: 'Accenture' }, pct: 0.05, fromWeek: 1, toWeek: 52 }],
      },
    ]);
    const [s] = parseStoredScenarios(old);
    expect(s?.overrides[0]?.scope).toEqual({ type: 'outsourcer', outsourcer: 'Accenture' });
    const plan = engine.computePlan(applyScenario(base, s!));
    expect(plan.sites.find((x) => x.site.id === 'SZX')!.periods[0]!.units[0]!.aht).toBeGreaterThan(
      basePlan.sites.find((x) => x.site.id === 'SZX')!.periods[0]!.units[0]!.aht,
    );
  });

  it('drops anything it cannot read instead of failing', () => {
    expect(parseStoredScenarios('not json')).toEqual([]);
    expect(parseStoredScenarios('{"a":1}')).toEqual([]);
    expect(parseStoredScenarios('[null, {"id":1}, {"id":"x","code":"SC9","name":"x","overrides":[{"kind":"bogus"}]}]')).toEqual([]);
  });
});
