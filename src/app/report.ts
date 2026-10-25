/**
 * The monthly brief: one screen summarising a plan, or a scenario against it.
 *
 * Every figure is read from results already computed for the other views: the
 * plan, the actuals, the budget and the hiring plan. Nothing here recalculates.
 */
import type { ActualResult, PlanEvent, PlanResult, PlanWeek } from '../engine/index.ts';
import type { BudgetMonth, BudgetRow } from './budget.ts';
import type { HiringPlan } from './hiring.ts';
import { monthOf, type PeriodModel } from './periods.ts';

export interface Tile {
  label: string;
  /** Baseline, or the plan when no scenario is open. */
  value: number;
  /** Scenario value, when one is open. */
  scenario?: number;
  format: 'int' | 'one' | 'signed';
  /** Which way is better: up, down, or neither. */
  better: 'up' | 'down' | null;
  note: string;
}

export interface CurveSeries {
  name: string;
  /** Grand total Over/Under per week: actual for elapsed weeks, then planned. */
  values: number[];
}

/** One start week of the hiring instruction: every class starting that week. */
export interface ClassLine {
  startWeek: number;
  startLabel: string;
  starters: number;
  classes: number;
  /** Starters by site, largest first. */
  sites: { siteId: string; siteName: string; starters: number; moved: boolean }[];
  productiveLabel: string;
  /** Events named by the classes' drivers. */
  events: string[];
}

export interface Variance {
  kind: 'Actual vs plan' | 'Plan vs budget' | 'Actual vs budget';
  where: string;
  when: string;
  fte: number;
  /** Over budget, or further under than planned: bad. */
  bad: boolean;
}

export interface Report {
  title: string;
  monthLabel: string;
  asOf: string;
  throughWeek: number;
  scenarioName: string | null;
  tiles: Tile[];
  weeks: readonly PlanWeek[];
  curve: CurveSeries[];
  events: readonly PlanEvent[];
  hiring: ClassLine[];
  hiringMore: number;
  hiringWindow: [number, number];
  variances: Variance[];
}

export interface ReportInput {
  planName: string;
  /** The locked plan. */
  base: PlanResult;
  /** The open scenario, if any. */
  scenario: PlanResult | null;
  scenarioName: string | null;
  actuals: ActualResult;
  /** Periods model for the locked plan, all units: drift by site. */
  periods: PeriodModel;
  budgetRows: readonly BudgetRow[];
  budgetMonths: readonly BudgetMonth[];
  /** Hiring plan of the shown plan: the scenario's when one is open. */
  hiring: HiringPlan;
  events: readonly PlanEvent[];
  /** Weeks ahead the brief looks for its headline and hiring figures. */
  window?: number;
}

const total = (p: PlanResult, w: number, f: (x: PlanResult['sites'][number]['periods'][number]) => number) =>
  p.sites.reduce((s, sp) => s + f(sp.periods[w - 1]!), 0);
const starters = (p: PlanResult, from: number, to: number) =>
  p.sites.reduce(
    (s, sp) =>
      s +
      sp.periods.reduce((a, x) => a + (x.flow.hiresToStart > 0 && x.flow.startPeriod >= from && x.flow.startPeriod <= to ? x.flow.hiresToStart : 0), 0) +
      sp.moved.reduce((a, m) => a + (m.startWeek >= from && m.startWeek <= to ? m.starters : 0), 0),
    0,
  );
const pad = (n: number) => String(n).padStart(2, '0');

export function buildReport(input: ReportInput): Report {
  const { base, scenario, actuals, periods, budgetRows, budgetMonths, hiring, events } = input;
  const weeks = base.weeks;
  const through = actuals.throughWeek;
  const first = through + 1;
  const horizon = weeks.length;
  const window = input.window ?? 13;
  const last = Math.min(horizon, first + window - 1);
  const landing = weeks[first - 1]!;
  const monthLabel = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${monthOf(landing).key}-15T00:00:00Z`));

  const actualTotal = (w: number) => actuals.sites.reduce((s, a) => s + a.periods[w - 1]!.overUnder, 0);
  const curveOf = (name: string, p: PlanResult): CurveSeries => ({
    name,
    values: weeks.map((w) => (w.index <= through ? actualTotal(w.index) : total(p, w.index, (x) => x.flow.overUnder))),
  });

  const plans: [string, PlanResult][] = scenario ? [['Baseline', base], [input.scenarioName ?? 'Scenario', scenario]] : [[input.planName, base]];
  const tile = (label: string, f: (p: PlanResult) => number, format: Tile['format'], better: Tile['better'], note: string): Tile => ({
    label,
    value: f(base),
    scenario: scenario ? f(scenario) : undefined,
    format,
    better,
    note,
  });
  const range = `W${pad(first)}–W${pad(last)}`;
  const weeksUnder = (p: PlanResult) => weeks.filter((w) => w.index >= first && total(p, w.index, (x) => x.flow.overUnder) < -0.05).length;
  const worst = (p: PlanResult) =>
    weeks.filter((w) => w.index >= first).reduce((a, w) => (total(p, w.index, (x) => x.flow.overUnder) < total(p, a.index, (x) => x.flow.overUnder) ? w : a), landing);
  const fy = budgetMonths.length;
  const budgetTotal = budgetRows.find((r) => r.kind === 'total');

  const tiles: Tile[] = [
    tile(`Over/Under, ${landing.label.slice(5)}`, (p) => total(p, first, (x) => x.flow.overUnder), 'signed', 'up', 'Planned FTE − Required FTE, all sites'),
    tile(`Weeks under, ${`W${pad(first)}–W${pad(horizon)}`}`, weeksUnder, 'int', 'down', `Worst ${worst(scenario ?? base).label.slice(5)}`),
    tile(`Required FTE, ${range}`, (p) => avg(first, last, (w) => total(p, w, (x) => x.requiredFte)), 'one', null, 'Average a week; includes shrinkage'),
    tile(`Starters, ${range}`, (p) => starters(p, first, last), 'int', null, `Classes starting in the next ${window} weeks`),
    tile('Starters, FY27', (p) => starters(p, 1, horizon), 'int', null, 'Every class in the year'),
  ];
  if (budgetTotal && !scenario) {
    tiles.push({
      label: 'Planned − budget, FY27',
      value: budgetTotal.lines.plannedVar[fy] ?? 0,
      format: 'signed',
      better: 'down',
      note: `Budget ${fmtOne(budgetTotal.lines.budget[fy] ?? 0)} FTE a week`,
    });
  }

  // Hiring: the classes starting in the window, one line per start week.
  const lines = new Map<number, ClassLine>();
  for (const c of hiring.classes) {
    if (c.startWeek < first || c.startWeek > last) continue;
    let line = lines.get(c.startWeek);
    if (!line) {
      line = { startWeek: c.startWeek, startLabel: c.startLabel, starters: 0, classes: 0, sites: [], productiveLabel: c.productiveLabel, events: [] };
      lines.set(c.startWeek, line);
    }
    line.starters += c.starters;
    line.classes++;
    const site = line.sites.find((s) => s.siteId === c.siteId);
    if (site) {
      site.starters += c.starters;
      site.moved ||= c.moved.length > 0;
    } else line.sites.push({ siteId: c.siteId, siteName: c.siteName, starters: c.starters, moved: c.moved.length > 0 });
    for (const e of events) if (c.driver.includes(e.code) && !line.events.includes(e.code)) line.events.push(e.code);
  }
  for (const line of lines.values()) line.sites.sort((a, b) => b.starters - a.starters);
  const allLines = [...lines.values()].sort((a, b) => a.startWeek - b.startWeek);
  const shown = window;

  // Variances: drift against plan, and budget gaps, largest first.
  const variances: Variance[] = [];
  for (const row of periods.rows) {
    if (row.kind !== 'site' || !row.drift) continue;
    variances.push({
      kind: 'Actual vs plan',
      where: row.label,
      when: `W${pad(row.drift.fromWeek)}–W${pad(row.drift.toWeek)}`,
      fte: row.drift.overUnder,
      bad: row.drift.overUnder < 0,
    });
  }
  for (const row of budgetRows) {
    if (row.kind !== 'site') continue;
    budgetMonths.forEach((m, j) => {
      const future = m.elapsed < m.weeks.length;
      const plan = row.lines.plannedVar[j] ?? null;
      if (future && plan !== null) variances.push({ kind: 'Plan vs budget', where: row.label, when: m.label, fte: plan, bad: plan > 0 });
      const act = row.lines.actualVar[j] ?? null;
      if (m.elapsed > 0 && act !== null) variances.push({ kind: 'Actual vs budget', where: row.label, when: m.label, fte: act, bad: act > 0 });
    });
  }
  variances.sort((a, b) => Math.abs(b.fte) - Math.abs(a.fte));
  // Drift leads: it is what the month's actuals say about the plan.
  const top = [...variances.filter((v) => v.kind === 'Actual vs plan'), ...variances.filter((v) => v.kind !== 'Actual vs plan')].slice(0, 6);

  return {
    title: `Monthly brief · ${monthLabel}`,
    monthLabel,
    asOf: `Week ${landing.label}, actuals through W${pad(through)}`,
    throughWeek: through,
    scenarioName: input.scenarioName,
    tiles,
    weeks,
    curve: plans.map(([name, p]) => curveOf(name, p)),
    events,
    hiring: allLines.slice(0, shown),
    hiringMore: Math.max(0, allLines.length - shown),
    hiringWindow: [first, last],
    variances: top,
  };

  function avg(from: number, to: number, f: (w: number) => number): number {
    let s = 0;
    for (let w = from; w <= to; w++) s += f(w);
    return s / (to - from + 1);
  }
}

const oneFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtOne = (v: number) => oneFmt.format(v);
