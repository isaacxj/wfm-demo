/**
 * Reference cases, brief section 3.5. Every one must pass.
 */
import { describe, expect, it } from 'vitest';
import { engine } from './index.ts';
import { evaluateExcel } from '../testing/excel.ts';
import { findStep } from './trace.ts';

describe('3.5 reference cases', () => {
  it('100 calls / 30 min, AHT 180s, 80% in 20s, no ceiling → 14 agents', () => {
    const r = engine.intervalStaffing({
      contacts: 100,
      intervalSeconds: 1800,
      aht: 180,
      serviceLevelTarget: 0.8,
      serviceLevelSeconds: 20,
    });
    expect(r.trafficErlangs).toBe(10);
    expect(r.agents).toBe(14);
    expect(r.serviceLevel).toBeGreaterThanOrEqual(0.8);
    expect(r.occupancyBound).toBe(false);
  });

  it('8,000 / 30 min, AHT 420s, 80% in 60s, no ceiling → 1,876 agents above 99% occupancy', () => {
    const r = engine.intervalStaffing({
      contacts: 8000,
      intervalSeconds: 1800,
      aht: 420,
      serviceLevelTarget: 0.8,
      serviceLevelSeconds: 60,
    });
    expect(r.agents).toBe(1876);
    expect(r.occupancy).toBeGreaterThan(0.99);
  });

  it('same with 85% ceiling → 2,197 agents, occupancy bound', () => {
    const r = engine.intervalStaffing({
      contacts: 8000,
      intervalSeconds: 1800,
      aht: 420,
      serviceLevelTarget: 0.8,
      serviceLevelSeconds: 60,
      occupancyCeiling: 0.85,
    });
    expect(r.erlangAgents).toBe(1876);
    expect(r.agents).toBe(2197);
    expect(r.occupancyBound).toBe(true);
    expect(r.occupancy).toBeLessThanOrEqual(0.85);
  });

  it('AHT 420 → 441 (+5%), 85% ceiling → +109 agents, +156 after 30% shrinkage', () => {
    const at = (aht: number) =>
      engine.intervalStaffing({
        contacts: 8000,
        intervalSeconds: 1800,
        aht,
        serviceLevelTarget: 0.8,
        serviceLevelSeconds: 60,
        occupancyCeiling: 0.85,
      }).agents;
    const delta = at(441) - at(420);
    expect(delta).toBe(109);
    expect(Math.round(engine.requiredFromProductive(delta, 0.3))).toBe(156);
  });

  it('chat AHT 600s, c=3, eff 0.75 → effective AHT 266.7s', () => {
    expect(engine.effectiveChatAht(600, 3, 0.75)).toBeCloseTo(266.67, 2);
    expect(engine.effectiveChatAht(600, 3)).toBeCloseTo(266.67, 2);
    const r = engine.periodRequirement({
      volume: 1000,
      aht: 600,
      channel: 'chat',
      concurrency: 3,
      workWeekHours: 40,
      occupancyCeiling: 0.85,
      shrinkage: 0,
    });
    expect(r.effectiveAht).toBeCloseTo(266.67, 2);
  });

  it('232,400 contacts, AHT 418s, 45h, 85% ceiling, 30.5% shrinkage → 26,984.2 hrs, 705.5 productive, 1,015.1 required', () => {
    const r = engine.periodRequirement({
      volume: 232_400,
      aht: 418,
      channel: 'voice',
      workWeekHours: 45,
      occupancyCeiling: 0.85,
      shrinkage: 0.305,
    });
    expect(r.workloadHours.toFixed(1)).toBe('26984.2');
    expect(r.productiveFte.toFixed(1)).toBe('705.5');
    expect(r.requiredFte.toFixed(1)).toBe('1015.1');
  });

  it('20,000 deferred, AHT 300s, 32h → 52.08 FTE', () => {
    const r = engine.periodRequirement({
      volume: 20_000,
      aht: 300,
      channel: 'deferred',
      workWeekHours: 32,
      occupancyCeiling: 0.85,
      shrinkage: 0,
    });
    expect(r.occupancyApplied).toBe(1);
    expect(r.productiveFte.toFixed(2)).toBe('52.08');
  });

  it('1,000 on-phone, 30% shrinkage → 1,428.6 required', () => {
    expect(engine.requiredFromProductive(1000, 0.3).toFixed(1)).toBe('1428.6');
  });

  it('5% monthly attrition, weekly → 1.178%, and 5.89 heads lost from 500', () => {
    const rate = engine.periodAttritionRate(0.05, 4.33).rate;
    expect((rate * 100).toFixed(3)).toBe('1.178');
    const rf = engine.rollForward({ opening: 500, monthlyAttrition: 0.05, hiresProductive: 0 });
    expect(rf.attrition.toFixed(2)).toBe('5.89');
    expect(rf.closing).toBeCloseTo(500 - 5.888, 2);
  });

  it('gap 60, 15% training attrition → 71 starters, 6 weeks earlier', () => {
    const r = engine.hiringNeed({
      requiredFte: 560,
      closing: 500,
      neededPeriod: 20,
      trainingAttrition: 0.15,
      trainingWeeks: 4,
      nestingWeeks: 2,
    });
    expect(r.gap).toBe(60);
    expect(r.hiresToStart).toBe(71);
    expect(r.leadWeeks).toBe(6);
    expect(r.startPeriod).toBe(14);
  });
});

describe('engine behaviour beyond the reference cases', () => {
  it('chat with concurrency alone understates staffing by about a third', () => {
    const naive = 600 / 3;
    const real = engine.effectiveChatAht(600, 3);
    expect(real / naive).toBeCloseTo(1 / 0.75, 6);
  });

  it('rejects a concurrency with no default efficiency', () => {
    expect(() => engine.effectiveChatAht(600, 5)).toThrow(RangeError);
  });

  it('dividing a monthly rate by four is not what the engine does', () => {
    const rate = engine.periodAttritionRate(0.05).rate;
    expect(rate).not.toBeCloseTo(0.05 / 4, 4);
    // Compounding 4.33 weekly periods recovers the monthly rate.
    expect(1 - Math.pow(1 - rate, 4.33)).toBeCloseTo(0.05, 12);
  });

  it('zero traffic needs zero agents', () => {
    const r = engine.intervalStaffing({
      contacts: 0,
      intervalSeconds: 1800,
      aht: 300,
      serviceLevelTarget: 0.8,
      serviceLevelSeconds: 20,
      occupancyCeiling: 0.85,
    });
    expect(r.agents).toBe(0);
    expect(r.serviceLevel).toBe(1);
  });

  it('a cap holds productive hires back and surfaces the shortfall', () => {
    const rf = engine.rollForward({ opening: 975, monthlyAttrition: 0.052, hiresProductive: 28, cap: 980 });
    expect(rf.closing).toBeCloseTo(980, 9);
    expect(rf.atCap).toBe(true);
    expect(rf.hiresHeldByCap).toBeGreaterThan(0);

    const h = engine.hiringNeed({
      requiredFte: 1100,
      closing: rf.closing,
      neededPeriod: 32,
      trainingAttrition: 0.15,
      trainingWeeks: 4,
      nestingWeeks: 2,
      cap: 980,
    });
    expect(h.gap).toBeCloseTo(120, 6);
    expect(h.hireableGap).toBeCloseTo(0, 9);
    expect(h.capShortfall).toBeCloseTo(120, 6);
    expect(h.hiresToStart).toBe(0);
  });

  it('a surplus starts no class', () => {
    const h = engine.hiringNeed({
      requiredFte: 400,
      closing: 450,
      neededPeriod: 10,
      trainingAttrition: 0.15,
      trainingWeeks: 4,
      nestingWeeks: 2,
    });
    expect(h.gap).toBe(-50);
    expect(h.hiresToStart).toBe(0);
  });
});

describe('trace', () => {
  const r = engine.periodRequirement({
    volume: 232_400,
    aht: 418,
    channel: 'voice',
    workWeekHours: 45,
    occupancyCeiling: 0.85,
    shrinkage: 0.305,
    codes: { volume: 'FC-TEST', shrinkage: 'SITE.SHR' },
  });

  it('is ordered inputs-to-output and ends on the returned value', () => {
    expect(r.trace.map((s) => s.key)).toEqual([
      'volume',
      'aht',
      'workload',
      'workWeekHours',
      'occupancy',
      'productive',
      'shrinkage',
      'required',
    ]);
    expect(r.trace.at(-1)?.value).toBe(r.requiredFte);
  });

  it('carries formulas on computed steps and assumption codes on inputs', () => {
    expect(findStep(r.trace, 'workload').formula).toBe('volume × AHT ÷ 3600');
    expect(findStep(r.trace, 'volume').assumption).toBe('FC-TEST');
    expect(findStep(r.trace, 'shrinkage').assumption).toBe('SITE.SHR');
  });

  it('every Excel expression reproduces its step value', () => {
    for (const step of r.trace) {
      expect(step.excel, step.key).toBeDefined();
      expect(evaluateExcel(step.excel as string), step.key).toBeCloseTo(step.value, 9);
    }
  });

  it('roll-forward and hiring Excel expressions reproduce their values', () => {
    const rf = engine.rollForward({ opening: 975, monthlyAttrition: 0.052, hiresProductive: 28, cap: 980 });
    const h = engine.hiringNeed({
      requiredFte: 1100,
      closing: 960.5,
      neededPeriod: 32,
      trainingAttrition: 0.15,
      trainingWeeks: 4,
      nestingWeeks: 2,
      cap: 980,
    });
    for (const step of [...rf.trace, ...h.trace]) {
      expect(evaluateExcel(step.excel as string), step.key).toBeCloseTo(step.value, 9);
    }
  });
});
