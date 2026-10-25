import { describe, expect, it } from 'vitest';
import { buildActuals } from '../data/actuals.ts';
import { buildBudget, monthKey } from '../data/budget.ts';
import { demoDataset } from '../data/dataset.ts';
import { engine } from '../engine/index.ts';
import { applyScenario } from '../scenario/scenario.ts';
import { applyBudgetEdits, budgetCsv, budgetMonths, buildBudgetRows, parseBudgetCsv } from './budget.ts';
import { buildHiringPlan, sumClasses } from './hiring.ts';
import { ALL_FILTERS } from './model.ts';
import { buildPeriodRows } from './periods.ts';
import { buildReport } from './report.ts';

const ds = demoDataset();
const plan = engine.computePlan(ds.plan);
const forecast = engine.computePlan({ ...ds.plan, events: [] });
const budget = buildBudget(forecast);
const actuals = engine.computeActuals(ds.plan, buildActuals(ds.plan, plan));
const months = budgetMonths(plan.weeks, actuals.throughWeek);
const rows = buildBudgetRows(plan, actuals, budget, months, 'outsourcer');
const FY = months.length;

describe('budget', () => {
  it('funds whole FTE per site and month, a little either side of the forecast before events', () => {
    for (const sp of forecast.sites) {
      const values = budget.bySite[sp.site.id]!;
      expect(values).toHaveLength(52);
      for (const m of months) {
        const inMonth = m.weeks.map((i) => values[i]!);
        expect(new Set(inMonth).size).toBe(1);
        expect(Number.isInteger(inMonth[0])).toBe(true);
        const required = m.weeks.reduce((s, i) => s + sp.periods[i]!.requiredFte, 0) / m.weeks.length;
        expect(inMonth[0]! / required).toBeGreaterThan(0.965);
        expect(inMonth[0]! / required).toBeLessThan(1.025);
      }
    }
  });

  it('has twelve months by the ISO rule, the elapsed ones marked', () => {
    expect(months).toHaveLength(12);
    expect(months.reduce((s, m) => s + m.weeks.length, 0)).toBe(52);
    expect(months.map((m) => m.elapsed).slice(0, 4)).toEqual([4, 4, 3, 0]);
    expect(monthKey(plan.weeks[4]!)).toBe('2027-02');
  });

  it('compares plan and actuals with the budget, and subtotals add the displayed sites', () => {
    const mnl1 = rows.find((r) => r.code === 'MNL1')!;
    const j = 5;
    expect(mnl1.lines.plannedVar[j]).toBeCloseTo(mnl1.lines.planned[j]! - mnl1.lines.budget[j]!, 9);
    expect(mnl1.lines.actual[j]).toBeNull();
    expect(mnl1.lines.actualVar[2]).not.toBeNull();
    const sp = plan.sites.find((s) => s.site.id === 'MNL1')!;
    expect(mnl1.lines.planned[FY]).toBeCloseTo(sp.periods.reduce((s, p) => s + p.flow.closing, 0) / 52, 9);
    const sub = rows.find((r) => r.id === 'subtotal:Teleperformance')!;
    const members = rows.filter((r) => r.kind === 'site' && ['MNL1', 'MNL2', 'CAI'].includes(r.code!));
    for (const line of ['budget', 'planned', 'plannedVar', 'actualVar'] as const) {
      const add = Math.round(members.reduce((s, r) => s + Math.round(r.lines[line][1]! * 10) / 10, 0) * 10) / 10;
      expect(sub.lines[line][1]).toBeCloseTo(add, 9);
    }
  });

  it('takes edits by month or by week', () => {
    const edited = applyBudgetEdits(budget, { 'CAI:2027-04': 600, 'CAI:W20': 610 }, plan.weeks);
    const april = months.find((m) => m.key === '2027-04')!;
    for (const i of april.weeks) expect(edited.bySite.CAI![i]).toBe(600);
    expect(edited.bySite.CAI![19]).toBe(610);
    expect(edited.bySite.MNL1).toEqual(budget.bySite.MNL1);
  });

  it('reads CSV lines by site id or name and month or week, and says what it skipped', () => {
    const r = parseBudgetCsv('site,month,budget_fte\nCAI,2027-09,620\nToronto,Oct 2027,300\nMNL2\t2027-W14\t810\nXXX,2027-01,5\nCAI,2028-01,5\nCAI,2027-02,lots\n', ds.plan.sites, plan.weeks);
    expect(r.edits).toEqual({ 'CAI:2027-09': 620, 'YYZ:2027-10': 300, 'MNL2:W14': 810 });
    expect(r.rows).toBe(3);
    expect(r.errors).toHaveLength(3);
    expect(r.errors[0]).toContain('no site "XXX"');
  });

  it('writes a CSV that reads back as the same budget', () => {
    const r = parseBudgetCsv(budgetCsv(budget, ds.plan.sites, months), ds.plan.sites, plan.weeks);
    expect(r.errors).toEqual([]);
    expect(r.rows).toBe(8 * 12);
    expect(applyBudgetEdits(budget, r.edits, plan.weeks)).toEqual(budget);
  });
});

describe('monthly brief', () => {
  const periods = buildPeriodRows(plan, ALL_FILTERS, 'outsourcer', { actuals });
  const hiring = buildHiringPlan(plan, ds.plan.constants, ds.plan.isoYear);
  const report = buildReport({
    planName: 'FY27 Production Plan v3',
    base: plan,
    scenario: null,
    scenarioName: null,
    actuals,
    periods,
    budgetRows: rows,
    budgetMonths: months,
    hiring,
    events: ds.plan.events ?? [],
  });
  const total = (w: number) => plan.sites.reduce((s, sp) => s + sp.periods[w - 1]!.flow.overUnder, 0);

  it('is the brief for the landing month', () => {
    expect(report.title).toBe('Monthly brief · March 2027');
    expect(report.asOf).toBe('Week 2027-W12, actuals through W11');
  });

  it('draws actuals for elapsed weeks, then the plan', () => {
    const [s] = report.curve;
    expect(report.curve).toHaveLength(1);
    expect(s!.values[4]).toBeCloseTo(actuals.sites.reduce((a, x) => a + x.periods[4]!.overUnder, 0), 9);
    expect(s!.values[31]).toBeCloseTo(total(32), 9);
    expect(report.tiles[0]!.value).toBeCloseTo(total(12), 9);
  });

  it('gives the hiring instruction for the next thirteen weeks, adding to the headline', () => {
    const inWindow = hiring.classes.filter((c) => c.startWeek >= 12 && c.startWeek <= 24);
    expect(report.hiring.reduce((s, l) => s + l.starters, 0) + 0).toBe(sumClasses(inWindow).starters);
    expect(report.tiles.find((t) => t.label === 'Starters, W12–W24')!.value).toBe(sumClasses(inWindow).starters);
  });

  it('leads the variances with the drifted site, then the largest budget gaps', () => {
    expect(report.variances[0]).toMatchObject({ kind: 'Actual vs plan', where: 'Mexico City', bad: true });
    const rest = report.variances.slice(1).map((v) => Math.abs(v.fte));
    expect(rest).toEqual([...rest].sort((a, b) => b - a));
    expect(report.tiles.at(-1)!.label).toBe('Planned − budget, FY27');
  });

  it('with a scenario open, compares it with the baseline', () => {
    const scen = engine.computePlan(
      applyScenario(ds.plan, {
        id: 's',
        code: 'SC1',
        name: 'Scenario 1',
        forkedFrom: 'v3',
        overrides: [{ code: 'SC1.OV1', kind: 'aht', scope: { type: 'all' }, pct: 0.05, fromWeek: 1, toWeek: 52 }],
      }),
    );
    const r = buildReport({
      planName: 'FY27 Production Plan v3',
      base: plan,
      scenario: scen,
      scenarioName: 'Scenario 1',
      actuals,
      periods,
      budgetRows: rows,
      budgetMonths: months,
      hiring: buildHiringPlan(scen, ds.plan.constants, ds.plan.isoYear),
      events: ds.plan.events ?? [],
    });
    expect(r.curve.map((c) => c.name)).toEqual(['Baseline', 'Scenario 1']);
    expect(r.curve[0]!.values.slice(0, 11)).toEqual(r.curve[1]!.values.slice(0, 11));
    const req = r.tiles.find((t) => t.label.startsWith('Required FTE'))!;
    expect(req.scenario! - req.value).toBeGreaterThan(200);
  });
});
