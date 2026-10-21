/**
 * Plan computation: demand requirement per planning unit per week, rolled up
 * to site, then per site and week the supply roll-forward with the
 * recommended class fed back in.
 *
 * A scenario is a modified PlanInput. The engine holds no state.
 */
import { periodLabel } from './calendar.ts';
import { periodRequirement, REQUIRED_FTE_NOTE, type Channel, type RequirementResult } from './requirement.ts';
import { siteWeek, type SiteWeekResult } from './siteweek.ts';
import { TraceBuilder, group, type TracePart, type TraceStep } from './trace.ts';

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
  /** Smallest class worth running. */
  minClassSize: number;
  codes: {
    periodsPerMonth: string;
    trainingWeeks: string;
    nestingWeeks: string;
    trainingAttrition: string;
    minClassSize: string;
  };
}

export interface SiteInput {
  id: string;
  outsourcer: string;
  name: string;
  country: string;
  workWeekHours: number;
  occupancyCeiling: number;
  shrinkage: number;
  monthlyAttrition: number;
  /** Contracted headcount cap, or null. */
  cap: number | null;
  openingHeadcount: number;
  /**
   * Hires from classes already in training at plan start, reaching
   * production, one entry per horizon week. New classes are the engine's.
   */
  committedHires: readonly number[];
  transfersIn?: readonly number[];
  transfersOut?: readonly number[];
  codes: {
    workWeekHours: string;
    occupancyCeiling: string;
    shrinkage: string;
    monthlyAttrition: string;
    cap: string;
    openingHeadcount: string;
    committedHires: string;
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
  productiveFte: number;
  requiredFte: number;
  /** Supply roll-forward with the recommended class, and the resulting Over/Under. */
  flow: SiteWeekResult;
  /** ISO week the recommended class starts, or null when none is needed. */
  classStartLabel: string | null;
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
    expectLength(`${site.id} committedHires`, site.committedHires, weeks.length);
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
      const { volume, aht, workload, productive, required } = rollUpDemand(t, unitPeriods);

      const flow = siteWeek({
        opening,
        monthlyAttrition: site.monthlyAttrition,
        periodsPerMonth: constants.periodsPerMonth,
        committedHires: site.committedHires[w] ?? 0,
        transfersIn: site.transfersIn?.[w] ?? 0,
        transfersOut: site.transfersOut?.[w] ?? 0,
        cap: site.cap,
        requiredFte: required.value,
        week: week.index,
        firstStartWeek: weeks[0]?.index ?? 1,
        trainingAttrition: constants.trainingAttrition,
        minClassSize: constants.minClassSize,
        trainingWeeks: constants.trainingWeeks,
        nestingWeeks: constants.nestingWeeks,
        codes: {
          opening: w === 0 ? site.codes.openingHeadcount : undefined,
          monthlyAttrition: site.codes.monthlyAttrition,
          periodsPerMonth: constants.codes.periodsPerMonth,
          committedHires: site.codes.committedHires,
          cap: site.codes.cap,
          trainingAttrition: constants.codes.trainingAttrition,
          minClassSize: constants.codes.minClassSize,
          trainingWeeks: constants.codes.trainingWeeks,
          nestingWeeks: constants.codes.nestingWeeks,
        },
      });
      t.input('workWeekHours', 'Work week', site.workWeekHours, 'hours/week', site.codes.workWeekHours);
      t.input('occupancyCeiling', 'Occupancy ceiling', site.occupancyCeiling, 'ratio', site.codes.occupancyCeiling);
      t.input('shrinkage', 'Shrinkage', site.shrinkage, 'ratio', site.codes.shrinkage);
      t.include('flow', flow.trace);
      t.link('flow.required', [required]);
      const prior = periods[w - 1];
      if (prior) {
        t.attach('flow.opening', [{ id: `${site.id}:${prior.weekLabel}`, label: `${prior.weekLabel} closing`, steps: prior.trace, focus: 'flow.closing' }]);
      }

      periods.push({
        siteId: site.id,
        week: week.index,
        weekLabel: week.label,
        volume: volume.value,
        aht: aht.value,
        workloadHours: workload.value,
        occupancyCeiling: site.occupancyCeiling,
        shrinkage: site.shrinkage,
        productiveFte: productive.value,
        requiredFte: required.value,
        flow,
        classStartLabel: flow.hiresToStart > 0 ? periodLabel(input.isoYear, flow.startPeriod) : null,
        units: unitPeriods,
        trace: t.steps,
      });
      opening = flow.closing;
    });

    return { site, periods };
  });

  return { weeks, sites };
}

/** Sums unit requirements into a trace. Shared by site rows and filtered slices. */
export function rollUpDemand(t: TraceBuilder, unitPeriods: readonly UnitPeriod[]) {
  const volume = sumStep(t, 'volume', 'Volume', 'contacts', unitPeriods, (u) => u.volume, (u) => String(u.volume));
  const handled = unitPeriods.reduce((s, u) => s + u.volume * u.aht, 0);
  const aht = t.calc(
    'aht',
    'AHT (volume weighted)',
    volume.value === 0 ? 0 : handled / volume.value,
    'seconds',
    'Σ(volume × AHT) ÷ Σ volume',
    volume.value === 0 ? '0' : `(${unitPeriods.map((u) => `${u.volume}*${u.aht}`).join('+')})/${group(volume.expr)}`,
    [volume],
  );
  t.attach('aht', unitParts(unitPeriods, 'aht'));
  const workload = sumStep(t, 'workload', 'Workload', 'hours', unitPeriods, (u) => u.requirement.workloadHours, (u) =>
    excelOf(u.requirement, 'workload'),
  );
  const productive = sumStep(t, 'productive', 'Productive FTE', 'FTE', unitPeriods, (u) => u.requirement.productiveFte, (u) =>
    excelOf(u.requirement, 'productive'),
  );
  const required = sumStep(t, 'required', 'Required FTE', 'FTE', unitPeriods, (u) => u.requirement.requiredFte, (u) =>
    excelOf(u.requirement, 'required'),
  );
  t.note('required', REQUIRED_FTE_NOTE);
  return { volume, aht, workload, productive, required };
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
  const ref = t.calc(key, `${label} (Σ ${units.length} units)`, total, unit, `Σ ${label} over planning units`, parts.length ? parts.join('+') : '0', []);
  t.attach(key, unitParts(units, key));
  return ref;
}

const CHANNEL_NAME: Readonly<Record<string, string>> = { voice: 'Voice', chat: 'Chat', deferred: 'Deferred' };

export function unitLabel(u: PlanningUnit): string {
  return `${u.lob} · ${u.language} · ${CHANNEL_NAME[u.channel] ?? u.channel}`;
}

function unitParts(units: readonly UnitPeriod[], focus: string): TracePart[] {
  return units.map((u) => ({ id: u.unit.id, label: unitLabel(u.unit), steps: u.requirement.trace, focus }));
}

function excelOf(r: RequirementResult, key: string): string {
  const step = r.trace.find((s) => s.key === key);
  if (!step?.excel) throw new Error(`Missing ${key} in requirement trace`);
  return step.excel.slice(1);
}

function expectLength(what: string, arr: readonly unknown[], n: number): void {
  if (arr.length !== n) throw new Error(`${what}: expected ${n} weeks, got ${arr.length}`);
}
