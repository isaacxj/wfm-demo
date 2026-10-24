/**
 * Hiring plan: the engine's recommended classes as a recruitment instruction.
 * How many to hire, at which site, starting which week, grouped by start week.
 *
 * A site's starters in one week are split into classes no larger than the
 * maximum class size. Starters the constraints moved earlier join the classes
 * of the week they start in, and each moved class says why it moved.
 *
 * Nothing here recalculates. Every number is read from the plan's site-week
 * results, so the instruction and the grid always agree.
 */
import { periodLabel, periodStart, toIsoDate, type MovedClass, type PlanConstants, type PlanResult, type SitePeriod } from '../engine/index.ts';

export interface HiringClass {
  id: string;
  siteId: string;
  siteName: string;
  outsourcer: string;
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
  /** 1-based position among the site's classes starting this week, and how many there are. */
  classIndex: number;
  classCount: number;
  /** Set when some of the starters were moved here from a later, constrained week. */
  moved: MovedClass[];
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
  outsourcer: string;
  kind: 'lead' | 'cap' | 'constraint' | 'moved';
  weeks: number[];
  /** FTE short at the peak; for a moved class, its starters. */
  peakFte: number;
  peakWeek: number;
  /** Why, in words: the constraint that moved a class or left a need unplaced. */
  reason?: string;
  /** Moved classes only. */
  move?: MovedClass;
}

export interface HiringPlan {
  classes: HiringClass[];
  byWeek: WeekGroup[];
  exceptions: Exception[];
  trainingWeeks: number;
  nestingWeeks: number;
  minClassSize: number;
  maxClassSize: number | null;
  maxClassesPerWeek: number | null;
  /** Blocked start weeks and why. */
  blockedWeeks: { week: number; label: string; name: string }[];
}

const one = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const short = (isoYear: number, index: number) => periodLabel(isoYear, index).slice(5);
const span = (isoYear: number, from: number, weeks: number) =>
  weeks <= 1 ? short(isoYear, from) : `${short(isoYear, from)}–${short(isoYear, from + weeks - 1)}`;

type ClassConstants = Pick<PlanConstants, 'trainingWeeks' | 'nestingWeeks' | 'minClassSize' | 'trainingAttrition'> &
  Partial<Pick<PlanConstants, 'maxClassSize' | 'maxClassesPerWeek' | 'blockedWeeks' | 'blockedWeekNames'>>;

export function buildHiringPlan(plan: PlanResult, constants: ClassConstants, isoYear: number, outsourcers?: ReadonlySet<string>): HiringPlan {
  const { trainingWeeks, nestingWeeks } = constants;
  const lead = trainingWeeks + nestingWeeks;
  const maxSize = constants.maxClassSize ?? Infinity;
  const blocked = new Set(constants.blockedWeeks ?? []);
  const classes: HiringClass[] = [];
  const exceptions: Exception[] = [];

  for (const sp of plan.sites) {
    const site = sp.site;
    if (outsourcers && !outsourcers.has(site.outsourcer)) continue;

    // Everything starting in one week at this site: the week's own class, and starters moved in from later weeks.
    const starts = new Map<number, { own: SitePeriod | null; prior: SitePeriod | undefined; moved: MovedClass[] }>();
    sp.periods.forEach((p, i) => {
      if (p.flow.hiresToStart <= 0) return;
      starts.set(p.flow.startPeriod, { own: p, prior: sp.periods[i - 1], moved: [] });
    });
    for (const m of sp.moved) {
      const entry = starts.get(m.startWeek) ?? { own: null, prior: undefined, moved: [] };
      entry.moved.push(m);
      starts.set(m.startWeek, entry);
    }

    for (const [start, { own, prior, moved }] of starts) {
      const landing = sp.periods.find((p) => p.week === start + lead)!;
      // Early graduates the cap let land, shared by every class moved to this week.
      const plannedEarly = landing.trace.find((x) => x.key === 'flow.earlyPlanned')?.value ?? 0;
      const landedShare = plannedEarly > 0 ? landing.flow.earlyGraduates / plannedEarly : 0;
      const ownStarters = own?.flow.hiresToStart ?? 0;
      const movedStarters = moved.reduce((s, m) => s + m.starters, 0);
      const starters = ownStarters + movedStarters;
      const graduates = (own?.flow.classGraduates ?? 0) + moved.reduce((s, m) => s + m.starters * (1 - constants.trainingAttrition) * landedShare, 0);
      const deficit = (own?.flow.hireableDeficit ?? 0) + moved.reduce((s, m) => s + m.starters * (1 - constants.trainingAttrition) * landedShare, 0);
      const needed = own ? (stepValue(own, 'flow.startersNeeded') ?? ownStarters) : 0;
      const driver = [
        own ? driverOf(own, prior) : null,
        ...moved.map((m) => `For ${short(isoYear, m.forWeek)}: ${m.reason}`),
      ]
        .filter(Boolean)
        .join(' · ');
      // Split into classes no larger than the maximum, as evenly as heads allow.
      const count = Number.isFinite(maxSize) ? Math.max(1, Math.ceil(starters / maxSize)) : 1;
      for (let k = 0; k < count; k++) {
        const size = Math.floor(starters / count) + (k < starters % count ? 1 : 0);
        const share = size / starters;
        classes.push({
          id: `${site.id}:${start}${count > 1 ? `:${k + 1}` : ''}`,
          siteId: site.id,
          siteName: site.name,
          outsourcer: site.outsourcer,
          country: site.country,
          startWeek: start,
          startLabel: periodLabel(isoYear, start),
          startDate: toIsoDate(periodStart(isoYear, start)),
          trainingLabel: span(isoYear, start, trainingWeeks),
          nestingLabel: span(isoYear, start + trainingWeeks, nestingWeeks),
          productiveWeek: landing.week,
          productiveLabel: landing.weekLabel,
          starters: size,
          graduates: graduates * share,
          deficit: deficit * share,
          capLimited: own !== null && (own.flow.capShortfall > 0.05 || needed > ownStarters + (own.flow.unplacedStarters ?? 0)),
          driver,
          classIndex: k + 1,
          classCount: count,
          moved,
        });
      }
      for (const m of moved) {
        exceptions.push({
          siteId: site.id,
          siteName: site.name,
          outsourcer: site.outsourcer,
          kind: 'moved',
          weeks: [m.startWeek],
          peakFte: m.starters,
          peakWeek: m.forWeek,
          reason: m.reason,
          move: m,
        });
      }
    }

    for (const kind of ['lead', 'cap', 'constraint'] as const) {
      const amount = (p: SitePeriod) =>
        kind === 'lead' ? p.flow.leadTimeShortfall : kind === 'cap' ? p.flow.capShortfall : p.flow.unplacedStarters * (1 - constants.trainingAttrition);
      const hits = sp.periods.filter((p) => amount(p) > 0.05);
      if (hits.length === 0) continue;
      const peak = hits.reduce((a, b) => (amount(b) > amount(a) ? b : a));
      exceptions.push({
        siteId: site.id,
        siteName: site.name,
        outsourcer: site.outsourcer,
        kind,
        weeks: hits.map((p) => p.week),
        peakFte: amount(peak),
        peakWeek: peak.week,
        reason:
          kind === 'constraint'
            ? `${short(isoYear, peak.flow.startPeriod)} ${blocked.has(peak.flow.startPeriod) ? `blocked${constants.blockedWeekNames?.[peak.flow.startPeriod] ? ` (${constants.blockedWeekNames[peak.flow.startPeriod]})` : ''}` : 'full'}, and no earlier week has room`
            : undefined,
      });
    }
  }

  classes.sort(
    (a, b) =>
      a.startWeek - b.startWeek || a.outsourcer.localeCompare(b.outsourcer) || a.siteName.localeCompare(b.siteName) || a.classIndex - b.classIndex,
  );
  const byWeek: WeekGroup[] = [];
  for (const c of classes) {
    let g = byWeek.at(-1);
    if (!g || g.week !== c.startWeek) {
      g = { week: c.startWeek, label: c.startLabel, date: c.startDate, classes: [] };
      byWeek.push(g);
    }
    g.classes.push(c);
  }
  return {
    classes,
    byWeek,
    exceptions,
    trainingWeeks,
    nestingWeeks,
    minClassSize: constants.minClassSize,
    maxClassSize: constants.maxClassSize ?? null,
    maxClassesPerWeek: constants.maxClassesPerWeek ?? null,
    blockedWeeks: [...blocked].sort((a, b) => a - b).map((week) => ({ week, label: short(isoYear, week), name: constants.blockedWeekNames?.[week] ?? '' })),
  };
}

function stepValue(p: SitePeriod, key: string): number | undefined {
  return p.trace.find((s) => s.key === key)?.value;
}

/** Why the class is needed: demand rising faster than attrition, or attrition backfill. */
function driverOf(p: SitePeriod, prior: SitePeriod | undefined): string {
  const growth = prior ? p.requiredFte - prior.requiredFte : 0;
  const events = p.events.length ? ` · ${p.events.join(', ')}` : '';
  if (p.flow.capShortfall > 0.05) return `Backfill to cap${events}`;
  if (growth > p.flow.attrition) return `Demand +${one.format(growth)} FTE${events}`;
  return `Attrition backfill${events}`;
}

/** Totals over a set of classes. */
export function sumClasses(classes: readonly HiringClass[]): { starters: number; graduates: number; deficit: number } {
  return {
    starters: classes.reduce((s, c) => s + c.starters, 0),
    graduates: classes.reduce((s, c) => s + c.graduates, 0),
    deficit: classes.reduce((s, c) => s + c.deficit, 0),
  };
}
