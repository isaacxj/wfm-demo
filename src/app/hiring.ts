/**
 * Hiring plan: the engine's recommended classes as a recruitment instruction.
 * How many to hire, at which site, starting which week, grouped by start week.
 *
 * Nothing here recalculates. Every number is read from the plan's site-week
 * results, so the instruction and the grid always agree.
 */
import { periodLabel, periodStart, toIsoDate, type PlanResult, type SitePeriod } from '../engine/index.ts';

export interface HiringClass {
  id: string;
  siteId: string;
  siteName: string;
  vendor: string;
  country: string;
  /** Week the class starts training. */
  startWeek: number;
  startLabel: string;
  /** Monday of the start week, yyyy-mm-dd. */
  startDate: string;
  trainingLabel: string;
  nestingLabel: string;
  /** Week the graduates are productive: the week the heads are needed. */
  productiveWeek: number;
  productiveLabel: string;
  starters: number;
  /** Graduates landing in production after training attrition and any cap. */
  graduates: number;
  /** Deficit the class closes, FTE. */
  deficit: number;
  /** Starters were held below the need, or the need sits above the cap. */
  capLimited: boolean;
  driver: string;
}

export interface WeekGroup {
  week: number;
  label: string;
  date: string;
  classes: HiringClass[];
}

export interface Exception {
  siteId: string;
  siteName: string;
  vendor: string;
  kind: 'lead' | 'cap';
  weeks: number[];
  peakFte: number;
  peakWeek: number;
}

export interface HiringPlan {
  classes: HiringClass[];
  byWeek: WeekGroup[];
  exceptions: Exception[];
  trainingWeeks: number;
  nestingWeeks: number;
  minClassSize: number;
}

const one = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const short = (isoYear: number, index: number) => periodLabel(isoYear, index).slice(5);
const span = (isoYear: number, from: number, weeks: number) =>
  weeks <= 1 ? short(isoYear, from) : `${short(isoYear, from)}–${short(isoYear, from + weeks - 1)}`;

export function buildHiringPlan(
  plan: PlanResult,
  constants: { trainingWeeks: number; nestingWeeks: number; minClassSize: number },
  isoYear: number,
  vendors?: ReadonlySet<string>,
): HiringPlan {
  const { trainingWeeks, nestingWeeks } = constants;
  const classes: HiringClass[] = [];
  const exceptions: Exception[] = [];

  for (const sp of plan.sites) {
    const site = sp.site;
    if (vendors && !vendors.has(site.vendor)) continue;
    sp.periods.forEach((p, i) => {
      const f = p.flow;
      if (f.hiresToStart <= 0) return;
      const start = f.startPeriod;
      const needed = stepValue(p, 'flow.startersNeeded') ?? f.hiresToStart;
      classes.push({
        id: `${site.id}:${start}`,
        siteId: site.id,
        siteName: site.name,
        vendor: site.vendor,
        country: site.country,
        startWeek: start,
        startLabel: periodLabel(isoYear, start),
        startDate: toIsoDate(periodStart(isoYear, start)),
        trainingLabel: span(isoYear, start, trainingWeeks),
        nestingLabel: span(isoYear, start + trainingWeeks, nestingWeeks),
        productiveWeek: p.week,
        productiveLabel: p.weekLabel,
        starters: f.hiresToStart,
        graduates: f.classGraduates,
        deficit: f.hireableDeficit,
        capLimited: f.capShortfall > 0.05 || needed > f.hiresToStart,
        driver: driverOf(p, sp.periods[i - 1]),
      });
    });

    for (const kind of ['lead', 'cap'] as const) {
      const hits = sp.periods.filter((p) => (kind === 'lead' ? p.flow.leadTimeShortfall : p.flow.capShortfall) > 0.05);
      if (hits.length === 0) continue;
      const peak = hits.reduce((a, b) =>
        (kind === 'lead' ? b.flow.leadTimeShortfall : b.flow.capShortfall) > (kind === 'lead' ? a.flow.leadTimeShortfall : a.flow.capShortfall) ? b : a,
      );
      exceptions.push({
        siteId: site.id,
        siteName: site.name,
        vendor: site.vendor,
        kind,
        weeks: hits.map((p) => p.week),
        peakFte: kind === 'lead' ? peak.flow.leadTimeShortfall : peak.flow.capShortfall,
        peakWeek: peak.week,
      });
    }
  }

  classes.sort((a, b) => a.startWeek - b.startWeek || a.vendor.localeCompare(b.vendor) || a.siteName.localeCompare(b.siteName));
  const byWeek: WeekGroup[] = [];
  for (const c of classes) {
    let g = byWeek.at(-1);
    if (!g || g.week !== c.startWeek) {
      g = { week: c.startWeek, label: c.startLabel, date: c.startDate, classes: [] };
      byWeek.push(g);
    }
    g.classes.push(c);
  }
  return { classes, byWeek, exceptions, trainingWeeks, nestingWeeks, minClassSize: constants.minClassSize };
}

function stepValue(p: SitePeriod, key: string): number | undefined {
  return p.trace.find((s) => s.key === key)?.value;
}

/** Why the class is needed: demand rising faster than attrition, or attrition backfill. */
function driverOf(p: SitePeriod, prior: SitePeriod | undefined): string {
  const growth = prior ? p.rosteredFte - prior.rosteredFte : 0;
  if (p.flow.capShortfall > 0.05) return 'Backfill to cap';
  if (growth > p.flow.attrition) return `Demand +${one.format(growth)} FTE`;
  return `Attrition backfill`;
}

/** Totals over a set of classes. */
export function sumClasses(classes: readonly HiringClass[]): { starters: number; graduates: number; deficit: number } {
  return {
    starters: classes.reduce((s, c) => s + c.starters, 0),
    graduates: classes.reduce((s, c) => s + c.graduates, 0),
    deficit: classes.reduce((s, c) => s + c.deficit, 0),
  };
}
