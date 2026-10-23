import { describe, expect, it } from 'vitest';
import { ACTUALS_THROUGH_WEEK, buildActuals, DRIFT_SITE } from '../data/actuals.ts';
import { demoDataset } from '../data/dataset.ts';
import { engine } from '../engine/index.ts';
import { applyScenario } from '../scenario/scenario.ts';
import { evaluateExcel } from '../testing/excel.ts';
import { buildCompare, deltaOf } from './compare.ts';
import { periodTarget } from './components/Inspector.tsx';
import { formatValue, parseFormatted } from './format.ts';
import { ALL_FILTERS, buildActualRows, columnSpec, unitPredicate } from './model.ts';
import { buildPeriodRows, PERIOD_METRICS, varianceOf, varianceTone } from './periods.ts';
import { PLAN } from './plan.ts';

const ds = demoDataset();
const plan = engine.computePlan(ds.plan);
const input = buildActuals(ds.plan, plan);
const actuals = engine.computeActuals(ds.plan, input);
const shown = (v: number | null | undefined, key: (typeof PERIOD_METRICS)[number]) =>
  parseFormatted(formatValue(v, columnSpec(key).format ?? 'one').text);
const elapsed = Array.from({ length: ACTUALS_THROUGH_WEEK }, (_, i) => i);

describe('actuals data', () => {
  it('covers every unit and site for the weeks before the landing week', () => {
    expect(PLAN.landingWeek).toBe(ACTUALS_THROUGH_WEEK + 1);
    for (const u of ds.plan.units) expect(input.demand[u.id]).toHaveLength(ACTUALS_THROUGH_WEEK);
    for (const s of ds.plan.sites) expect(input.headcount[s.id]).toHaveLength(ACTUALS_THROUGH_WEEK);
    expect(input.demand['MNL1-MOB-EN-VO']![4]!.source).toBe('ACT27.MNL1-MOB-EN-VO.W05');
    expect(input.headcount.MNL1![4]!.source).toBe('ACT27.MNL1.HC.W05');
  });

  it('is deterministic', () => {
    expect(buildActuals(ds.plan, plan)).toEqual(input);
  });

  it('differs from plan by a few percent either way, except the drifted site', () => {
    for (const a of actuals.sites) {
      const sp = plan.sites.find((s) => s.site.id === a.siteId)!;
      const ratios = a.periods.map((p, w) => p.requiredFte / sp.periods[w]!.requiredFte - 1);
      const heads = a.periods.map((p, w) => p.headcount / sp.periods[w]!.flow.closing - 1);
      if (a.siteId === DRIFT_SITE) {
        for (const r of ratios.slice(6)) expect(r).toBeGreaterThan(0.05);
        expect(Math.min(...heads.slice(6))).toBeLessThan(-0.01);
        continue;
      }
      for (const r of ratios) expect(Math.abs(r), a.siteId).toBeLessThan(0.05);
      expect(ratios.some((r) => r > 0) && ratios.some((r) => r < 0), a.siteId).toBe(true);
      for (const h of heads) expect(Math.abs(h), a.siteId).toBeLessThan(0.02);
    }
  });

  it('never puts more heads on a site than its contract allows', () => {
    for (const s of ds.plan.sites) {
      if (s.cap === null) continue;
      for (const h of input.headcount[s.id]!) expect(h.value).toBeLessThanOrEqual(s.cap);
    }
  });
});

describe('actual requirement', () => {
  it('uses the plan arithmetic on observed volume and AHT, and its trace reproduces Over/Under', () => {
    for (const a of actuals.sites) {
      for (const p of a.periods) {
        expect(p.requiredFte).toBeCloseTo(p.units.reduce((s, u) => s + u.requirement.requiredFte, 0), 9);
        const step = p.trace.find((s) => s.key === 'overUnder')!;
        expect(step.value).toBeCloseTo(p.headcount - p.requiredFte, 9);
        expect(evaluateExcel(step.excel!)).toBeCloseTo(step.value, 6);
        expect(p.trace.find((s) => s.key === 'required')?.note).toBe('Required FTE includes shrinkage.');
      }
    }
  });

  it('a filter allocates actual headcount by share, and complementary slices add back to the site', () => {
    const p = actuals.sites[0]!.periods[4]!;
    const chat = engine.sliceActualPeriod(p, unitPredicate({ ...ALL_FILTERS, channel: ['chat'] }))!;
    const rest = engine.sliceActualPeriod(p, unitPredicate({ ...ALL_FILTERS, channel: ['voice', 'deferred'] }))!;
    expect(chat.allocated).toBe(true);
    expect(chat.headcount + rest.headcount).toBeCloseTo(p.headcount, 9);
    expect(chat.overUnder + rest.overUnder).toBeCloseTo(p.overUnder, 9);
    expect(evaluateExcel(chat.trace.find((s) => s.key === 'overUnder')!.excel!)).toBeCloseTo(chat.overUnder, 6);
  });
});

describe('periods bands', () => {
  const m = buildPeriodRows(plan, ALL_FILTERS, 'outsourcer', { actuals });

  it('shows elapsed weeks as actuals and the rest as the locked plan', () => {
    expect(m.bands.slice(0, 11).every((b) => b === 'actual')).toBe(true);
    expect(m.bands.slice(11).every((b) => b === 'plan')).toBe(true);
    const mnl1 = m.rows.find((r) => r.code === 'MNL1')!;
    expect(mnl1.byWeek[4]!.actual).toBeDefined();
    expect(mnl1.byWeek[4]!.cells.planned).toBe(input.headcount.MNL1![4]!.value);
    expect(mnl1.byWeek[11]!.actual).toBeUndefined();
    expect(mnl1.byWeek[4]!.cells.hireNeed).toBeNull();
  });

  it('reconciles every actual week column', () => {
    for (const key of PERIOD_METRICS.filter((k) => columnSpec(k).aggregate === 'sum' && k !== 'hireNeed')) {
      for (const w of elapsed) {
        const sites = m.rows.filter((r) => r.kind === 'site');
        const total = m.rows.find((r) => r.kind === 'total')!;
        const add = Math.round(sites.reduce((s, r) => s + (shown(r.byWeek[w]!.cells[key], key) ?? 0), 0) * 10) / 10;
        expect(shown(total.byWeek[w]!.cells[key], key), `${key} W${w + 1}`).toBe(add);
      }
    }
  });

  it('measures variance as actual − plan, and site variances add to the subtotal', () => {
    for (const key of ['volume', 'required', 'planned', 'overUnder'] as const) {
      for (const w of elapsed) {
        const block = m.rows.slice(1, 5);
        const [a, b, c, sub] = block;
        expect(sub!.kind).toBe('subtotal');
        const add = Math.round([a, b, c].reduce((s, r) => s + varianceOf(m, r!, w, key)!, 0) * 10) / 10;
        expect(varianceOf(m, sub!, w, key)).toBeCloseTo(add, 9);
      }
      expect(varianceOf(m, m.rows[1]!, 20, key)).toBeNull();
    }
  });

  it('flags the drifted site and no other', () => {
    const flagged = m.rows.filter((r) => r.drift).map((r) => r.code);
    expect(flagged).toEqual([DRIFT_SITE]);
    const drift = m.rows.find((r) => r.code === DRIFT_SITE)!.drift!;
    expect(drift.overUnder).toBeLessThan(0);
    expect([drift.fromWeek, drift.toWeek]).toEqual([8, 11]);
  });

  it('colours variance by what it does to Over/Under', () => {
    expect(varianceTone('volume', 120)).toBe('neg');
    expect(varianceTone('planned', 5)).toBe('pos');
    expect(varianceTone('overUnder', -3.2)).toBe('neg');
    expect(varianceTone('hireNeed', 4)).toBeUndefined();
  });

  it('with a scenario open, the weeks after the actuals show the scenario and its change from plan', () => {
    const scen = engine.computePlan(
      applyScenario(ds.plan, {
        id: 's',
        code: 'SC1',
        name: 'Scenario 1',
        forkedFrom: 'v3',
        overrides: [{ code: 'SC1.OV1', kind: 'volume', scope: { type: 'all' }, mode: 'add', value: 10_000, fromWeek: 1, toWeek: 52 }],
      }),
    );
    const sm = buildPeriodRows(plan, ALL_FILTERS, 'outsourcer', { actuals, scenario: scen });
    expect(sm.bands.slice(0, 11).every((b) => b === 'actual')).toBe(true);
    expect(sm.bands.slice(11).every((b) => b === 'scenario')).toBe(true);
    // Elapsed weeks are observed: a scenario cannot change them.
    expect(sm.rows.map((r) => r.byWeek[4]!.cells)).toEqual(m.rows.map((r) => r.byWeek[4]!.cells));
    const total = sm.rows.find((r) => r.kind === 'total')!;
    expect(varianceOf(sm, total, 11, 'volume')).toBe(10_000);
    const cmp = buildCompare(plan, scen, { week: 12, filters: ALL_FILTERS, grouping: 'outsourcer' }, false);
    sm.rows.forEach((r, i) => {
      if (r.kind !== 'group') expect(varianceOf(sm, r, 11, 'overUnder')).toBe(deltaOf(cmp.rows[i]!, 'overUnder'));
    });
  });

  it('filters reach the actuals too', () => {
    const chat = buildPeriodRows(plan, { ...ALL_FILTERS, channel: ['chat'] }, 'outsourcer', { actuals });
    const mnl1 = chat.rows.find((r) => r.code === 'MNL1')!;
    expect(mnl1.byWeek[4]!.actual?.allocated).toBe(true);
  });
});

describe('inspector on the Periods grid', () => {
  const m = buildPeriodRows(plan, ALL_FILTERS, 'outsourcer', { actuals });
  const names = { scenario: null, weekLabel: '2027-W09' };

  it('names an actual cell as actual and explains the drift', () => {
    const t = periodTarget(m, { rowId: `site:${DRIFT_SITE}`, key: 'overUnder' }, 9, names, 'var:')!;
    expect(t.side).toBe('Actual');
    expect(t.extraNotes?.map((n) => n.tag)).toEqual(['DRIFT', 'ACTUAL']);
    const focus = t.trace!.steps.find((s) => s.key === t.trace!.focus)!;
    expect(focus.value).toBeCloseTo(m.rows.find((r) => r.code === DRIFT_SITE)!.byWeek[8]!.cells.overUnder!, 9);
  });

  it('a variance cell traces actual − plan, opening into both chains', () => {
    for (const row of m.rows.filter((r) => r.kind !== 'group')) {
      const t = periodTarget(m, { rowId: `var:${row.id}`, key: 'overUnder' }, 9, names, 'var:')!;
      const focus = t.trace!.steps.find((s) => s.key === t.trace!.focus)!;
      expect(focus.value).toBeCloseTo(varianceOf(m, row, 8, 'overUnder')!, 9);
      expect(evaluateExcel(focus.excel!)).toBeCloseTo(focus.value, 6);
      expect(t.trace!.steps.filter((s) => s.parts).map((s) => s.label)).toEqual(['Plan (as displayed)', 'Actual (as displayed)']);
    }
  });

  it('a plan-week variance cell is empty', () => {
    expect(periodTarget(m, { rowId: 'var:site:MNL1', key: 'overUnder' }, 20, names, 'var:')).toBeNull();
  });

  it('every actual number traces to its inputs', () => {
    const rows = buildActualRows(actuals, plan, { week: 5, filters: ALL_FILTERS, grouping: 'outsourcer' });
    for (const row of rows.filter((r) => r.kind !== 'group')) {
      for (const key of ['volume', 'aht', 'workload', 'shrink', 'productive', 'required', 'planned', 'overUnder'] as const) {
        const t = periodTarget(
          { ...m, rowsByWeek: m.rowsByWeek.map((wk, i) => (i === 4 ? rows : wk)) },
          { rowId: row.id, key },
          5,
          names,
          'var:',
        )!;
        const focus = t.trace!.steps.find((s) => s.key === t.trace!.focus)!;
        expect(focus.value, `${row.label} ${key}`).toBeCloseTo(row.cells[key]!, 6);
        expect(evaluateExcel(focus.excel!), `${row.label} ${key}`).toBeCloseTo(row.cells[key]!, 6);
      }
    }
  });
});
