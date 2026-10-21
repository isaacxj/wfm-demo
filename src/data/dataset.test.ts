import { describe, expect, it } from 'vitest';
import { engine } from '../engine/index.ts';
import { buildDataset, demoDataset, HORIZON_WEEKS, MARKETING_SPIKE_WEEKS, SITE_TABLE, WEEKLY_HIRE_RATE } from './dataset.ts';
import { fnv1a } from './rng.ts';

const ds = demoDataset();
const plan = engine.computePlan(ds.plan);
const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

describe('demo dataset', () => {
  it('is identical on every build', () => {
    const again = buildDataset();
    expect(JSON.stringify(again.plan)).toBe(JSON.stringify(ds.plan));
  });

  it('is pinned, so a screenshot today matches next month', () => {
    expect(fnv1a(JSON.stringify(ds.plan)).toString(16).padStart(8, '0')).toBe('36e6e728');
  });

  it('has eight sites across four outsourcers, as tabled in the brief', () => {
    expect(ds.plan.sites).toHaveLength(8);
    expect(new Set(ds.plan.sites.map((s) => s.outsourcer)).size).toBe(4);
    for (const row of SITE_TABLE) {
      const site = ds.plan.sites.find((s) => s.id === row.id);
      expect(site).toMatchObject(row);
    }
  });

  it('covers 52 ISO weeks of 2027', () => {
    expect(ds.plan.weeks).toHaveLength(HORIZON_WEEKS);
    expect(ds.plan.weeks[0]).toEqual({ index: 1, label: '2027-W01', start: '2027-01-04' });
    expect(ds.plan.weeks.at(-1)).toEqual({ index: 52, label: '2027-W52', start: '2027-12-27' });
  });

  it('uses every business unit, language and channel', () => {
    expect(new Set(ds.units.map((u) => u.lob))).toEqual(new Set(['Mobile', 'Internet', 'Cable']));
    expect(new Set(ds.units.map((u) => u.language))).toEqual(new Set(['EN', 'FR', 'ES', 'TL']));
    expect(new Set(ds.units.map((u) => u.channel))).toEqual(new Set(['voice', 'chat', 'deferred']));
  });

  it('gives every unit a positive integer volume and AHT every week', () => {
    for (const u of ds.units) {
      const cells = ds.plan.demand[u.id] ?? [];
      expect(cells).toHaveLength(HORIZON_WEEKS);
      for (const c of cells) {
        expect(Number.isInteger(c.volume) && c.volume > 0).toBe(true);
        expect(Number.isInteger(c.aht) && c.aht > 0).toBe(true);
      }
    }
  });

  it('commits round(opening HC × 0.03) hires a week for the lead time, then none', () => {
    const lead = ds.plan.constants.trainingWeeks + ds.plan.constants.nestingWeeks;
    for (const s of ds.plan.sites) {
      const hires = Math.round(s.openingHeadcount * WEEKLY_HIRE_RATE);
      expect(s.committedHires.slice(0, lead)).toEqual(Array<number>(lead).fill(hires));
      expect(s.committedHires.slice(lead).every((h) => h === 0)).toBe(true);
    }
  });

  it('every input code resolves to an assumption record', () => {
    const codes = new Set(ds.assumptions.map((a) => a.code));
    for (const s of ds.plan.sites) {
      for (const [field, code] of Object.entries(s.codes)) {
        if (field === 'cap' && s.cap === null) continue;
        expect(codes.has(code), code).toBe(true);
      }
    }
    for (const u of ds.units) {
      for (const code of Object.values(u.codes ?? {})) expect(codes.has(code), code).toBe(true);
    }
    for (const code of Object.values(ds.plan.constants.codes)) expect(codes.has(code), code).toBe(true);
  });
});

describe('demand shape', () => {
  const weekly = (w: number) => sum(plan.sites.map((s) => s.periods[w - 1]!.volume));
  const avg = (weeks: readonly number[]) => sum(weeks.map(weekly)) / weeks.length;

  it('shows the marketing spike in weeks 31 to 34', () => {
    expect(avg(MARKETING_SPIKE_WEEKS)).toBeGreaterThan(avg([27, 28, 29, 30]) * 1.08);
    expect(avg(MARKETING_SPIKE_WEEKS)).toBeGreaterThan(avg([35, 36, 37, 38]) * 1.08);
  });

  it('shows the year-end lift', () => {
    expect(avg([49, 50, 51, 52])).toBeGreaterThan(avg([40, 41, 42, 43]) * 1.12);
  });

  it('shows the summer trough', () => {
    expect(avg([26, 27, 28])).toBeLessThan(avg([1, 2, 3]) * 0.9);
  });
});

describe('plan on the demo dataset', () => {
  it('Manila-1 breaches its contracted cap within the horizon', () => {
    const mnl1 = plan.sites.find((s) => s.site.id === 'MNL1')!;
    const breached = mnl1.periods.filter((p) => p.requiredFte > (mnl1.site.cap ?? Infinity));
    expect(breached.length).toBeGreaterThan(0);
    expect(breached.every((p) => p.flow.capShortfall > 0)).toBe(true);
    expect(mnl1.periods.some((p) => p.flow.atCap)).toBe(true);
    expect(mnl1.periods.every((p) => p.flow.closing <= 980 + 1e-9)).toBe(true);
  });

  it('site requirement reconciles to its planning units', () => {
    for (const sp of plan.sites) {
      for (const p of sp.periods) {
        expect(p.volume).toBe(sum(p.units.map((u) => u.volume)));
        expect(p.workloadHours).toBeCloseTo(sum(p.units.map((u) => u.requirement.workloadHours)), 6);
        expect(p.requiredFte).toBeCloseTo(sum(p.units.map((u) => u.requirement.requiredFte)), 6);
      }
    }
  });

  it('headcount rolls forward week to week from the opening table', () => {
    for (const sp of plan.sites) {
      expect(sp.periods[0]!.flow.opening).toBe(sp.site.openingHeadcount);
      for (let w = 1; w < sp.periods.length; w++) {
        expect(sp.periods[w]!.flow.opening).toBe(sp.periods[w - 1]!.flow.closing);
      }
    }
  });

  it('supply has shape by week 12', () => {
    for (const sp of plan.sites) {
      expect(sp.periods[11]!.flow.opening).not.toBe(sp.site.openingHeadcount);
    }
  });

  it('every site trace ends on Over/Under and reproduces the grid values', () => {
    const p = plan.sites[0]!.periods[11]!;
    const step = (k: string) => p.trace.find((s) => s.key === k)?.value;
    expect(step('required')).toBe(p.requiredFte);
    expect(step('flow.closing')).toBe(p.flow.closing);
    expect(step('flow.overUnder')).toBe(p.flow.overUnder);
    expect(p.trace.at(-1)?.key).toBe('flow.overUnder');
  });

  it('hires for a deficit once: after a class lands, a site is under only by its cap shortfall', () => {
    for (const sp of plan.sites) {
      for (const p of sp.periods) {
        if (!p.flow.classPossible) continue;
        expect(-p.flow.overUnder, `${sp.site.id} ${p.weekLabel}`).toBeLessThanOrEqual(p.flow.capShortfall + 1e-9);
      }
    }
  });

  it('runs no class below the minimum class size unless a cap leaves less room', () => {
    const min = ds.plan.constants.minClassSize;
    for (const sp of plan.sites) {
      for (const p of sp.periods) {
        const n = p.flow.hiresToStart;
        if (n === 0 || n >= min) continue;
        const room = p.trace.find((s) => s.key === 'flow.classRoom')?.value;
        expect(room, `${sp.site.id} ${p.weekLabel} class of ${n}`).toBeLessThan(min);
      }
    }
  });

  it('starts no class inside the lead time', () => {
    for (const sp of plan.sites) {
      for (const p of sp.periods.slice(0, 6)) {
        expect(p.flow.classPossible).toBe(false);
        expect(p.flow.hiresToStart).toBe(0);
      }
      expect(sp.periods[6]!.flow.classPossible).toBe(true);
    }
  });

  it('recommends classes for the spike and the year-end lift', () => {
    const starters = (weeks: number[]) =>
      sum(plan.sites.flatMap((sp) => weeks.map((w) => sp.periods[w - 1]!.flow.hiresToStart)));
    expect(starters([31, 32])).toBeGreaterThan(50);
    expect(starters([47, 48, 49, 50, 51, 52])).toBeGreaterThan(100);
  });
});

describe('filtered slices', () => {
  const p = plan.sites.find((s) => s.site.id === 'MEX')!.periods[11]!;

  it('an unfiltered slice is the site row itself', () => {
    const s = engine.sliceSitePeriod(p, () => true)!;
    expect(s.allocated).toBe(false);
    expect(s.trace).toBe(p.trace);
    expect(s.closing).toBe(p.flow.closing);
  });

  it('complementary slices add back to the site', () => {
    const voice = engine.sliceSitePeriod(p, (u) => u.channel === 'voice')!;
    const other = engine.sliceSitePeriod(p, (u) => u.channel !== 'voice')!;
    expect(voice.allocated && other.allocated).toBe(true);
    expect(voice.volume + other.volume).toBe(p.volume);
    expect(voice.requiredFte + other.requiredFte).toBeCloseTo(p.requiredFte, 9);
    expect(voice.closing + other.closing).toBeCloseTo(p.flow.closing, 9);
    expect(voice.overUnder + other.overUnder).toBeCloseTo(p.flow.overUnder, 9);
    expect(voice.share + other.share).toBeCloseTo(1, 12);
  });

  it('a filter matching nothing at a site returns no slice', () => {
    expect(engine.sliceSitePeriod(p, (u) => u.language === 'TL')).toBeNull();
  });
});
