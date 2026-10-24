import { describe, expect, it } from 'vitest';
import { demoDataset, EVENTS } from '../data/dataset.ts';
import { engine } from '../engine/index.ts';
import { applyScenario, parseStoredScenarios, type Scenario } from '../scenario/scenario.ts';
import { evaluateExcel } from '../testing/excel.ts';
import { membersOf } from './cellTrace.ts';
import { contribution, eventImpact, eventsInRow, withoutEvent } from './events.ts';
import { ALL_FILTERS, buildRows } from './model.ts';

const ds = demoDataset();
const base = ds.plan;
const plan = engine.computePlan(base);
const total = (p: typeof plan, week: number) => p.sites.reduce((s, sp) => s + sp.periods[week - 1]!.requiredFte, 0);
const unitPeriod = (p: typeof plan, unitId: string, week: number) =>
  p.sites.flatMap((sp) => sp.periods[week - 1]!.units).find((u) => u.unit.id === unitId)!;
const scenario = (overrides: Scenario['overrides']): Scenario => ({ id: 's', code: 'SC1', name: 'Scenario 1', forkedFrom: 'v3', overrides });

describe('event register', () => {
  it('seeds a campaign in weeks 31 to 34, a compliance training programme and a platform migration', () => {
    expect(EVENTS.map((e) => [e.code, e.type])).toEqual([
      ['EV01', 'campaign'],
      ['EV02', 'training'],
      ['EV03', 'system'],
    ]);
    expect([EVENTS[0]!.fromWeek, EVENTS[0]!.toWeek]).toEqual([31, 34]);
    for (const code of ['EV01.VOL', 'EV01.AHT', 'EV02.AHT', 'EV03.VOL', 'EV03.AHT']) expect(ds.assumptions.some((a) => a.code === code)).toBe(true);
  });

  it('the forecast holds no spike: the campaign makes it, through the plan', () => {
    const forecast = (w: number) => Object.values(base.demand).reduce((s, cells) => s + cells[w - 1]!.volume, 0);
    expect(forecast(32) / forecast(30)).toBeLessThan(1.03);
    expect(total(plan, 32) / total(plan, 30)).toBeGreaterThan(1.15);
    const off = engine.computePlan(withoutEvent(base, 'EV01'));
    expect(total(off, 32) / total(off, 30)).toBeLessThan(1.03);
  });

  it('a unit trace shows the forecast, each event and the result, and reproduces it in Excel', () => {
    const u = unitPeriod(plan, 'MNL1-MOB-EN-VO', 32);
    const step = (k: string) => u.requirement.trace.find((s) => s.key === k)!;
    expect(step('volumeForecast').value).toBe(base.demand['MNL1-MOB-EN-VO']![31]!.volume);
    expect(step('event.EV01.volume')).toMatchObject({ value: 0.16, assumption: 'EV01.VOL', label: 'Summer offer campaign (EV01)' });
    expect(step('volume').value).toBe(Math.round(step('volumeForecast').value * 1.16));
    expect(step('volume').deps).toEqual(['volumeForecast', 'event.EV01.volume']);
    expect(evaluateExcel(step('volume').excel!)).toBe(step('volume').value);
    expect(step('aht').value).toBeCloseTo(step('ahtForecast').value * 1.04, 9);
    expect(evaluateExcel(step('required').excel!)).toBeCloseTo(u.requirement.requiredFte, 6);
  });

  it('applies only within its scope and weeks', () => {
    expect(unitPeriod(plan, 'MNL1-MOB-EN-VO', 15).requirement.trace.some((s) => s.key === 'event.EV02.aht')).toBe(true);
    expect(unitPeriod(plan, 'MNL1-INT-EN-VO', 15).requirement.trace.some((s) => s.key.startsWith('event.'))).toBe(false);
    expect(unitPeriod(plan, 'MNL1-MOB-EN-VO', 20).requirement.trace.some((s) => s.key.startsWith('event.'))).toBe(false);
    expect(unitPeriod(plan, 'MNL1-INT-EN-VO', 39).requirement.trace.some((s) => s.key === 'event.EV03.volume')).toBe(true);
    expect(plan.sites[0]!.periods[38]!.events).toEqual(['EV03']);
  });

  it('names the events in a row and week, and measures what each contributes', () => {
    const opts = { week: 32, filters: ALL_FILTERS, grouping: 'outsourcer' as const };
    const rows = buildRows(plan, opts);
    const totalRow = rows.find((r) => r.kind === 'total')!;
    expect(eventsInRow(plan, EVENTS, totalRow, membersOf(rows, totalRow), 32, ALL_FILTERS).map((e) => e.code)).toEqual(['EV01']);
    expect(eventsInRow(plan, EVENTS, totalRow, membersOf(rows, totalRow), 30, ALL_FILTERS)).toEqual([]);
    const off = engine.computePlan(withoutEvent(base, 'EV01'));
    const c = contribution(plan, off, 'total', 'required', opts)!;
    expect(c.with - c.without).toBeGreaterThan(500);
    expect(c.without).toBeCloseTo(buildRows(off, opts).find((r) => r.id === 'total')!.cells.required!, 9);
    // A filter that leaves out the event's business unit names no event.
    const internet = { ...ALL_FILTERS, lob: ['Internet'] };
    const iRows = buildRows(plan, { ...opts, week: 15, filters: internet });
    const iTotal = iRows.find((r) => r.kind === 'total')!;
    expect(eventsInRow(plan, EVENTS, iTotal, membersOf(iRows, iTotal), 15, internet)).toEqual([]);
  });

  it('measures each event on the whole plan: peak Required FTE in its weeks, and the hiring it causes', () => {
    const im = eventImpact(plan, engine.computePlan(withoutEvent(base, 'EV01')), EVENTS[0]!);
    expect(im.peakWeek).toBeGreaterThanOrEqual(31);
    expect(im.peakWeek).toBeLessThanOrEqual(34);
    expect(im.peakRequired).toBeGreaterThan(500);
    expect(im.starters).toBeGreaterThan(0);
  });

  it('a scenario switches a plan event off, or registers one under its override code', () => {
    const off = applyScenario(base, scenario([{ code: 'SC1.OV1', kind: 'event', scope: { type: 'all' }, remove: 'EV01' }]));
    expect(off.events!.map((e) => e.code)).toEqual(['EV02', 'EV03']);
    const added = applyScenario(
      base,
      scenario([
        { code: 'SC1.OV1', kind: 'event', scope: { type: 'all' }, add: { name: 'Price letters', type: 'campaign', scope: { type: 'site', siteId: 'CAI' }, fromWeek: 20, toWeek: 21, volumePct: 0.1 } },
      ]),
    );
    const p = engine.computePlan(added);
    const step = unitPeriod(p, 'CAI-MOB-EN-VO', 20).requirement.trace.find((s) => s.key === 'event.SC1.OV1.volume');
    expect(step?.assumption).toBe('SC1.OV1.VOL');
    expect(unitPeriod(p, 'MNL1-MOB-EN-VO', 20).requirement.trace.some((s) => s.key.startsWith('event.'))).toBe(false);
    const saved = parseStoredScenarios(JSON.stringify([scenario([{ code: 'SC1.OV1', kind: 'event', scope: { type: 'all' }, remove: 'EV02' }])]));
    expect(saved[0]!.overrides[0]).toMatchObject({ kind: 'event', remove: 'EV02' });
  });
});
