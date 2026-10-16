/**
 * Plan computation: demand requirement per planning unit per week, rolled up
 * to site, then supply roll-forward and the hiring need per site per week.
 *
 * A scenario is a modified PlanInput. The engine holds no state.
 */
import { periodLabel } from './calendar.ts';
import { periodRequirement, type Channel, type RequirementResult } from './requirement.ts';
import { hiringNeed, rollForward, type HiringResult, type RollForwardResult } from './supply.ts';
import { TraceBuilder, group, type TraceStep } from './trace.ts';

export interface PlanWeek {
  /** 1-based position in the horizon. */
  index: number;
  /** ISO week label, e.g. "2027-W12". */
  label: string;
  /** Monday, yyyy-mm-dd. */
  start: string;
}

export interface PlanConstants {
  periodsPerMonth: number;
  trainingWeeks: number;
  nestingWeeks: number;
  trainingAttrition: number;
  codes: {
    periodsPerMonth: string;
    trainingWeeks: string;
    nestingWeeks: string;
    trainingAttrition: string;
  };
}

export interface SiteInput {
  id: string;
  vendor: string;
  name: string;
  country: string;
  workWeekHours: number;
  occupancyCeiling: number;
  shrinkage: number;
  monthlyAttrition: number;
  /** Contracted headcount cap, or null. */
  cap: number | null;
  openingHeadcount: number;
  /** Planned hires reaching production, one entry per horizon week. */
  hiresProductive: readonly number[];
  transfersIn?: readonly number[];
  transfersOut?: readonly number[];
  codes: {
    workWeekHours: string;
    occupancyCeiling: string;
    shrinkage: string;
    monthlyAttrition: string;
    cap: string;
    openingHeadcount: string;
    hiresProductive: string;
  };
}

export interface PlanningUnit {
  id: string;
  siteId: string;
  lob: string;
  language: string;
  channel: Channel;
  /** Chat only. */
  concurrency?: number;
  /** Chat only. Overrides the default efficiency. */
  chatEfficiency?: number;
  codes?: { concurrency?: string; chatEfficiency?: string };
}

export interface DemandCell {
  volume: number;
  /** Seconds. */
  aht: number;
  /** Forecast record code that supplied volume and AHT. */
  source: string;
}

export interface PlanInput {
  /** ISO year the horizon starts in; week index 1 is its ISO week 1. */
  isoYear: number;
  weeks: readonly PlanWeek[];
  constants: PlanConstants;
  sites: readonly SiteInput[];
  units: readonly PlanningUnit[];
  /** Demand per unit id, one cell per horizon week. */
  demand: Readonly<Record<string, readonly DemandCell[]>>;
}

export interface UnitPeriod {
  unit: PlanningUnit;
  week: number;
  volume: number;
  aht: number;
  requirement: RequirementResult;
}

export interface SitePeriod {
  siteId: string;
  week: number;
  weekLabel: string;
  volume: number;
  /** Volume-weighted handle time, seconds. */
  aht: number;
  workloadHours: number;
  occupancyCeiling: number;
  shrinkage: number;
  requiredFte: number;
  rosteredFte: number;
  supply: RollForwardResult;
  hiring: HiringResult;
  classStartLabel: string;
  units: UnitPeriod[];
  /** Demand roll-up, then supply, then hiring. */
  trace: TraceStep[];
}

export interface SitePlan {
  site: SiteInput;
  periods: SitePeriod[];
}

export interface PlanResult {
  weeks: readonly PlanWeek[];
  sites: SitePlan[];
}

export function computePlan(input: PlanInput): PlanResult {
  const { weeks, constants } = input;
  const unitsBySite = new Map<string, PlanningUnit[]>();
  for (const u of input.units) {
    const list = unitsBySite.get(u.siteId) ?? [];
    list.push(u);
    unitsBySite.set(u.siteId, list);
  }

  const sites = input.sites.map((site): SitePlan => {
    expectLength(`${site.id} hiresProductive`, site.hiresProductive, weeks.length);
    const units = unitsBySite.get(site.id) ?? [];
    const periods: SitePeriod[] = [];
    let opening = site.openingHeadcount;

    weeks.forEach((week, w) => {
      const unitPeriods = units.map((unit): UnitPeriod => {
        const cells = input.demand[unit.id];
        if (!cells) throw new Error(`No demand for unit ${unit.id}`);
        expectLength(`${unit.id} demand`, cells, weeks.length);
        const cell = cells[w] as DemandCell;
        const requirement = periodRequirement({
          volume: cell.volume,
          aht: cell.aht,
          channel: unit.channel,
          workWeekHours: site.workWeekHours,
          occupancyCeiling: site.occupancyCeiling,
          shrinkage: site.shrinkage,
          concurrency: unit.concurrency,
          chatEfficiency: unit.chatEfficiency,
          codes: {
            volume: cell.source,
            aht: cell.source,
            workWeekHours: site.codes.workWeekHours,
            occupancyCeiling: site.codes.occupancyCeiling,
            shrinkage: site.codes.shrinkage,
            concurrency: unit.codes?.concurrency,
            chatEfficiency: unit.codes?.chatEfficiency,
          },
        });
        return { unit, week: week.index, volume: cell.volume, aht: cell.aht, requirement };
      });

      const t = new TraceBuilder();
      const volume = sumStep(t, 'volume', 'Volume', 'contacts', unitPeriods, (u) => u.volume, (u) => String(u.volume));
      const handled = unitPeriods.reduce((s, u) => s + u.volume * u.aht, 0);
      const aht = volume.value === 0 ? 0 : handled / volume.value;
      t.calc(
        'aht',
        'AHT (volume weighted)',
        aht,
        'seconds',
        'Σ(volume × AHT) ÷ Σ volume',
        volume.value === 0
          ? '0'
          : `(${unitPeriods.map((u) => `${u.volume}*${u.aht}`).join('+') || '0'})/${group(volume.expr)}`,
      );
      const workload = sumStep(t, 'workload', 'Workload', 'hours', unitPeriods, (u) => u.requirement.workloadHours, (u) =>
        excelOf(u.requirement, 'workload'),
      );
      const required = sumStep(t, 'required', 'Required FTE', 'FTE', unitPeriods, (u) => u.requirement.requiredFte, (u) =>
        excelOf(u.requirement, 'required'),
      );
      const rostered = sumStep(t, 'rostered', 'Rostered FTE', 'FTE', unitPeriods, (u) => u.requirement.rosteredFte, (u) =>
        excelOf(u.requirement, 'rostered'),
      );

      const supply = rollForward({
        opening,
        monthlyAttrition: site.monthlyAttrition,
        periodsPerMonth: constants.periodsPerMonth,
        hiresProductive: site.hiresProductive[w] ?? 0,
        transfersIn: site.transfersIn?.[w] ?? 0,
        transfersOut: site.transfersOut?.[w] ?? 0,
        cap: site.cap,
        codes: {
          opening: w === 0 ? site.codes.openingHeadcount : undefined,
          monthlyAttrition: site.codes.monthlyAttrition,
          periodsPerMonth: constants.codes.periodsPerMonth,
          hiresProductive: site.codes.hiresProductive,
          cap: site.codes.cap,
        },
      });
      t.include('supply', supply.trace);

      const hiring = hiringNeed({
        rosteredRequired: rostered.value,
        closing: supply.closing,
        neededPeriod: week.index,
        trainingAttrition: constants.trainingAttrition,
        trainingWeeks: constants.trainingWeeks,
        nestingWeeks: constants.nestingWeeks,
        cap: site.cap,
        codes: {
          trainingAttrition: constants.codes.trainingAttrition,
          trainingWeeks: constants.codes.trainingWeeks,
          nestingWeeks: constants.codes.nestingWeeks,
          cap: site.codes.cap,
        },
      });
      t.include('hiring', hiring.trace);

      periods.push({
        siteId: site.id,
        week: week.index,
        weekLabel: week.label,
        volume: volume.value,
        aht,
        workloadHours: workload.value,
        occupancyCeiling: site.occupancyCeiling,
        shrinkage: site.shrinkage,
        requiredFte: required.value,
        rosteredFte: rostered.value,
        supply,
        hiring,
        classStartLabel: periodLabel(input.isoYear, hiring.startPeriod),
        units: unitPeriods,
        trace: t.steps,
      });
      opening = supply.closing;
    });

    return { site, periods };
  });

  return { weeks, sites };
}

function sumStep(
  t: TraceBuilder,
  key: string,
  label: string,
  unit: 'contacts' | 'hours' | 'FTE',
  units: readonly UnitPeriod[],
  value: (u: UnitPeriod) => number,
  expr: (u: UnitPeriod) => string,
) {
  const total = units.reduce((s, u) => s + value(u), 0);
  const parts = units.map((u) => group(expr(u)));
  return t.calc(key, `${label} (Σ ${units.length} units)`, total, unit, `Σ unit ${label.toLowerCase()}`, parts.length ? parts.join('+') : '0');
}

function excelOf(r: RequirementResult, key: string): string {
  const step = r.trace.find((s) => s.key === key);
  if (!step?.excel) throw new Error(`Missing ${key} in requirement trace`);
  return step.excel.slice(1);
}

function expectLength(what: string, arr: readonly unknown[], n: number): void {
  if (arr.length !== n) throw new Error(`${what}: expected ${n} weeks, got ${arr.length}`);
}
