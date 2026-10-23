import { describe, expect, it } from 'vitest';
import { demoDataset } from '../data/dataset.ts';
import { engine } from '../engine/index.ts';
import { formatValue, parseFormatted } from './format.ts';
import { ALL_FILTERS, buildRows, columnSpec } from './model.ts';
import { buildPeriodRows, monthOf, PERIOD_METRICS, startsMonth } from './periods.ts';

const plan = engine.computePlan(demoDataset().plan);
const shown = (v: number | null | undefined, key: (typeof PERIOD_METRICS)[number]) =>
  parseFormatted(formatValue(v, columnSpec(key).format ?? 'one').text);

describe('periods model', () => {
  const m = buildPeriodRows(plan, ALL_FILTERS, 'outsourcer');

  it('has one row per hierarchy row and one column per horizon week', () => {
    expect(m.rows.map((r) => r.kind)).toEqual(buildRows(plan, { week: 1, filters: ALL_FILTERS, grouping: 'outsourcer' }).map((r) => r.kind));
    for (const r of m.rows) expect(r.byWeek).toHaveLength(52);
  });

  it('shows Over/Under for every site in every week', () => {
    for (const r of m.rows.filter((x) => x.kind === 'site')) {
      for (const cell of r.byWeek) expect(typeof cell.cells.overUnder).toBe('number');
    }
  });

  it('reads the same numbers as the Metrics grid for that week', () => {
    for (const week of [1, 12, 32, 52]) {
      const metrics = buildRows(plan, { week, filters: ALL_FILTERS, grouping: 'outsourcer' });
      m.rows.forEach((r, i) => expect(r.byWeek[week - 1]!.cells).toEqual(metrics[i]!.cells));
    }
  });

  it('reconciles every week column: site digits add to the subtotal and the total', () => {
    for (const key of PERIOD_METRICS.filter((k) => columnSpec(k).aggregate === 'sum')) {
      for (let w = 0; w < 52; w++) {
        const sites = m.rows.filter((r) => r.kind === 'site');
        const total = m.rows.find((r) => r.kind === 'total')!;
        const add = Math.round(sites.reduce((s, r) => s + (shown(r.byWeek[w]!.cells[key], key) ?? 0), 0) * 10) / 10;
        expect(shown(total.byWeek[w]!.cells[key], key), `${key} W${w + 1}`).toBe(add);
      }
    }
  });

  it('keeps filters: a Tagalog-only view has only the Manila sites', () => {
    const tl = buildPeriodRows(plan, { ...ALL_FILTERS, language: ['TL'] }, 'outsourcer');
    expect(tl.rows.filter((r) => r.kind === 'site').map((r) => r.code)).toEqual(['MNL1', 'MNL2']);
  });
});

describe('months', () => {
  it('assigns weeks to months by their Thursday and marks each month start', () => {
    expect(monthOf(plan.weeks[0]!).label).toBe('Jan 2027');
    const starts = plan.weeks.map((_, i) => i).filter((i) => startsMonth(plan.weeks, i));
    expect(starts).toHaveLength(11);
    // 2027-W05 runs Mon 1 Feb to Sun 7 Feb.
    expect(startsMonth(plan.weeks, 4)).toBe(true);
    expect(monthOf(plan.weeks[4]!).label).toBe('Feb 2027');
  });
});
