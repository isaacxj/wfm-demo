/**
 * Actuals: what was observed in the weeks already elapsed.
 *
 * Volume, AHT and headcount are data, read from the actuals feed, not
 * computed. The requirement they imply uses the plan's arithmetic, so an
 * actual week and a plan week compare like for like:
 *
 *   required FTE (actual) = requirement of actual volume and AHT, at the
 *                           site's work week, occupancy ceiling and shrinkage
 *   Over/Under (actual)   = actual headcount − actual required FTE
 *
 * A filtered slice allocates actual headcount by its share of actual required
 * FTE, the same rule the plan uses for supply.
 */
import { periodRequirement, REQUIRED_FTE_NOTE } from './requirement.ts';
import { rollUpDemand, type DemandCell, type PlanInput, type PlanningUnit, type UnitPeriod } from './plan.ts';
import { TraceBuilder, group, type TraceStep } from './trace.ts';

export interface ObservedHeadcount {
  /** Heads on the site's books at week end. */
  value: number;
  /** Actuals record that supplied it. */
  source: string;
}

export interface ActualInput {
  /** Last elapsed week. Weeks 1 to throughWeek carry actuals. */
  throughWeek: number;
  /** Observed volume and AHT per unit id, one cell per elapsed week. */
  demand: Readonly<Record<string, readonly DemandCell[]>>;
  /** Observed headcount per site id, one entry per elapsed week. */
  headcount: Readonly<Record<string, readonly ObservedHeadcount[]>>;
}

export interface ActualPeriod {
  siteId: string;
  week: number;
  weekLabel: string;
  volume: number;
  aht: number;
  workloadHours: number;
  occupancyCeiling: number;
  shrinkage: number;
  productiveFte: number;
  requiredFte: number;
  headcount: number;
  /** Actual headcount − actual required FTE. Positive is over, negative is under. */
  overUnder: number;
  units: UnitPeriod[];
  trace: TraceStep[];
}

export interface ActualResult {
  throughWeek: number;
  sites: { siteId: string; periods: ActualPeriod[] }[];
}

export function computeActuals(input: PlanInput, actuals: ActualInput): ActualResult {
  const n = actuals.throughWeek;
  if (n < 0 || n > input.weeks.length) throw new RangeError(`Actuals through week ${n} outside the horizon`);
  const sites = input.sites.map((site) => {
    const units = input.units.filter((u) => u.siteId === site.id);
    const heads = actuals.headcount[site.id];
    if (!heads || heads.length !== n) throw new Error(`${site.id} actual headcount: expected ${n} weeks`);
    const periods = input.weeks.slice(0, n).map((week, w): ActualPeriod => {
      const unitPeriods = units.map((unit): UnitPeriod => {
        const cell = actuals.demand[unit.id]?.[w];
        if (!cell) throw new Error(`No actuals for unit ${unit.id} in ${week.label}`);
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
      const d = rollUpDemand(t, unitPeriods);
      t.input('workWeekHours', 'Work week', site.workWeekHours, 'hours/week', site.codes.workWeekHours);
      t.input('occupancyCeiling', 'Occupancy ceiling', site.occupancyCeiling, 'ratio', site.codes.occupancyCeiling);
      t.input('shrinkage', 'Shrinkage', site.shrinkage, 'ratio', site.codes.shrinkage);
      const hc = heads[w]!;
      const headcount = t.input('headcount', 'Actual headcount (observed)', hc.value, 'heads', hc.source);
      const overUnder = t.calc(
        'overUnder',
        'Over/Under (actual)',
        headcount.value - d.required.value,
        'FTE',
        'actual headcount − required FTE',
        `${headcount.expr}-${group(d.required.expr)}`,
        [headcount, d.required],
      );
      return {
        siteId: site.id,
        week: week.index,
        weekLabel: week.label,
        volume: d.volume.value,
        aht: d.aht.value,
        workloadHours: d.workload.value,
        occupancyCeiling: site.occupancyCeiling,
        shrinkage: site.shrinkage,
        productiveFte: d.productive.value,
        requiredFte: d.required.value,
        headcount: hc.value,
        overUnder: overUnder.value,
        units: unitPeriods,
        trace: t.steps,
      };
    });
    return { siteId: site.id, periods };
  });
  return { throughWeek: n, sites };
}

/** An actual site-week narrowed to the planning units a filter keeps. */
export interface ActualSlice {
  siteId: string;
  week: number;
  allocated: boolean;
  share: number;
  volume: number;
  aht: number;
  workloadHours: number;
  occupancyCeiling: number;
  shrinkage: number;
  productiveFte: number;
  requiredFte: number;
  headcount: number;
  overUnder: number;
  trace: TraceStep[];
  /** The whole site-week's trace, for values a slice does not allocate. */
  siteTrace: TraceStep[];
}

export function sliceActualPeriod(p: ActualPeriod, include: (u: PlanningUnit) => boolean): ActualSlice | null {
  const units = p.units.filter((u) => include(u.unit));
  if (units.length === 0) return null;
  const base = { siteId: p.siteId, week: p.week, occupancyCeiling: p.occupancyCeiling, shrinkage: p.shrinkage, siteTrace: p.trace };
  if (units.length === p.units.length) {
    return {
      ...base,
      allocated: false,
      share: 1,
      volume: p.volume,
      aht: p.aht,
      workloadHours: p.workloadHours,
      productiveFte: p.productiveFte,
      requiredFte: p.requiredFte,
      headcount: p.headcount,
      overUnder: p.overUnder,
      trace: p.trace,
    };
  }

  const t = new TraceBuilder();
  const d = rollUpDemand(t, units);
  const siteRequired = t.input('siteRequired', 'Site required FTE, actual (all units)', p.requiredFte, 'FTE');
  t.note('siteRequired', REQUIRED_FTE_NOTE);
  t.attach('siteRequired', [{ id: p.siteId, label: `Site ${p.weekLabel} actual`, steps: p.trace, focus: 'required' }]);
  const share = t.calc(
    'share',
    'Share of site requirement',
    siteRequired.value === 0 ? 0 : d.required.value / siteRequired.value,
    'ratio',
    'slice required FTE ÷ site required FTE',
    siteRequired.value === 0 ? '0' : `${group(d.required.expr)}/${siteRequired.expr}`,
    [d.required, siteRequired],
  );
  const siteHc = t.input('site.headcount', 'Site actual headcount', p.headcount, 'heads');
  t.attach('site.headcount', [{ id: p.siteId, label: `Site ${p.weekLabel} actual`, steps: p.trace, focus: 'headcount' }]);
  const headcount = t.calc(
    'headcount',
    'Actual headcount (allocated)',
    p.headcount * share.value,
    'heads',
    'site actual headcount × share',
    `${siteHc.expr}*${group(share.expr)}`,
    [siteHc, share],
  );
  const overUnder = t.calc(
    'overUnder',
    'Over/Under (actual)',
    headcount.value - d.required.value,
    'FTE',
    'allocated actual headcount − slice required FTE',
    `${group(headcount.expr)}-${group(d.required.expr)}`,
    [headcount, d.required],
  );
  return {
    ...base,
    allocated: true,
    share: share.value,
    volume: d.volume.value,
    aht: d.aht.value,
    workloadHours: d.workload.value,
    productiveFte: d.productive.value,
    requiredFte: d.required.value,
    headcount: headcount.value,
    overUnder: overUnder.value,
    trace: t.steps,
  };
}
