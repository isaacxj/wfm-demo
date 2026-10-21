import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildCompare, COMPARE_METRICS, deltaOf, horizonSummary } from '../app/compare.ts';
import { buildHiringPlan, sumClasses } from '../app/hiring.ts';
import { ALL_FILTERS, buildRows } from '../app/model.ts';
import { demoDataset } from '../data/dataset.ts';
import { engine } from '../engine/index.ts';
import { applyScenario, type Scenario } from '../scenario/scenario.ts';
import { compareWorkbook, fileName, hiringWorkbook, planWorkbook, type ExportContext } from './xlsx.ts';

const ds = demoDataset();
const basePlan = engine.computePlan(ds.plan);
const opts = { week: 12, filters: ALL_FILTERS, grouping: 'outsourcer' as const };
const ctx: ExportContext = { planName: 'FY27 Production Plan v3', scenarioName: null, context: 'Week 2027-W12', exportedOn: '2026-10-16' };
const siteName = (id: string) => ds.plan.sites.find((s) => s.id === id)?.name ?? id;

async function roundTrip(wb: ExcelJS.Workbook): Promise<ExcelJS.Workbook> {
  const buf = await wb.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buf as ArrayBuffer);
  return back;
}

const num = (c: ExcelJS.Cell): number => {
  const v = c.value;
  if (typeof v === 'number') return v;
  // exceljs drops a cached result of 0 on write; Excel recalculates on open.
  if (v && typeof v === 'object' && 'formula' in v) return v.result === undefined ? 0 : Number(v.result);
  return NaN;
};

/** Each SUBTOTAL's cached result equals the sum of the plain values it covers. */
function expectSubtotalsAddUp(ws: ExcelJS.Worksheet): number {
  let checked = 0;
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      const v = cell.value;
      if (!v || typeof v !== 'object' || !('formula' in v)) return;
      const m = /^SUBTOTAL\(9,([A-Z]+)(\d+):\1(\d+)\)$/.exec(v.formula ?? "");
      if (!m) return;
      let sum = 0;
      for (let r = Number(m[2]); r <= Number(m[3]); r++) {
        const c = ws.getCell(`${m[1]!}${r}`);
        if (typeof c.value === 'number') sum += c.value;
      }
      expect(num(cell), `${cell.address}`).toBeCloseTo(sum, 6);
      checked++;
    });
  });
  return checked;
}

describe('plan export', async () => {
  const rows = buildRows(basePlan, opts);
  const hp = buildHiringPlan(basePlan, ds.plan.constants, ds.plan.isoYear);
  const wb = await roundTrip(planWorkbook(ExcelJS, rows, new Set(), ctx, 'Plan 2027-W12', { hiring: hp, assumptions: ds.assumptions }));
  const ws = wb.getWorksheet('Plan 2027-W12')!;

  it('has the plan, hiring plan and assumptions sheets, and carries no tool metadata', () => {
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Plan 2027-W12', 'Hiring plan', 'Assumptions']);
    expect(wb.creator).toBe('Statixx Solutions');
  });

  it('keeps the column-group bands as merged cells', () => {
    expect(ws.getCell('B4').value).toBe('DEMAND');
    expect(ws.getCell('B4').isMerged).toBe(true);
    expect(ws.getCell('D4').master.address).toBe('B4');
    expect(ws.getCell('E4').value).toBe('REQUIREMENT');
    expect(ws.getCell('A5').value).toBe('SITE');
  });

  it('states the Required FTE convention in the sheet header', () => {
    expect(String(ws.getCell('A3').value)).toContain('Required FTE includes shrinkage');
    expect(ws.getCell('G5').value).toBe('PRODUCTIVE FTE');
    expect(ws.getCell('H5').value).toBe('REQUIRED FTE');
  });

  it('freezes the site column and header rows', () => {
    expect(ws.views[0]).toMatchObject({ state: 'frozen', xSplit: 1, ySplit: 5 });
  });

  it('writes outsourcer groups as collapsible outline levels', () => {
    expect(ws.getCell('A6').value).toBe('Teleperformance');
    expect(ws.getRow(6).outlineLevel ?? 0).toBe(0);
    expect(ws.getRow(7).outlineLevel).toBe(1);
  });

  it('makes subtotals and totals live SUBTOTAL formulas that add up', () => {
    expect(expectSubtotalsAddUp(ws)).toBeGreaterThan(40);
    const totalRow = ws.getRow(6 + rows.length - 1);
    expect(totalRow.getCell(1).value).toBe('Grand total');
    expect(num(totalRow.getCell(2))).toBe(rows.at(-1)!.cells.volume);
  });

  it('matches the grid digit for digit', () => {
    const mnl1 = rows.find((r) => r.siteId === 'MNL1')!;
    const r = ws.getRow(6 + rows.indexOf(mnl1));
    expect(String(r.getCell(1).value)).toContain('Manila-1');
    expect(r.getCell(8).value).toBe(Math.round(mnl1.cells.required! * 10) / 10);
    expect(r.getCell(8).numFmt).toBe('#,##0.0');
    expect(r.getCell(5).numFmt).toBe('0.0%');
  });

  it('exports the hiring plan with live totals', () => {
    const h = wb.getWorksheet('Hiring plan')!;
    expectSubtotalsAddUp(h);
    let total: ExcelJS.Row | undefined;
    h.eachRow((row) => {
      if (row.getCell(1).value?.toString().startsWith('Total')) total = row;
    });
    expect(num(total!.getCell(3))).toBe(sumClasses(hp.classes).starters);
  });
});

describe('comparison export', async () => {
  const scenario: Scenario = {
    id: 's1',
    code: 'SC1',
    name: 'Scenario 1',
    forkedFrom: 'FY27 Production Plan v3',
    overrides: [{ code: 'SC1.OV1', kind: 'volume', scope: { type: 'all' }, mode: 'add', value: 10_000, fromWeek: 1, toWeek: 52 }],
  };
  const scenPlan = engine.computePlan(applyScenario(ds.plan, scenario));
  const model = buildCompare(basePlan, scenPlan, opts, false);
  const metrics = COMPARE_METRICS.filter((k) => ['volume', 'required', 'closing', 'overUnder'].includes(k));
  const wb = await roundTrip(
    compareWorkbook(ExcelJS, model, metrics, { ...ctx, scenarioName: 'Scenario 1' }, 'Compare 2027-W12', {
      scenario,
      summary: horizonSummary(basePlan, scenPlan),
      siteName,
    }),
  );
  const ws = wb.getWorksheet('Compare 2027-W12')!;

  it('bands each metric over baseline, scenario and change', () => {
    expect(ws.getCell('B4').value).toBe('VOLUME');
    expect(ws.getCell('D4').master.address).toBe('B4');
    expect([ws.getCell('B5').value, ws.getCell('C5').value, ws.getCell('D5').value]).toEqual(['BASE', 'SCEN.', 'Δ']);
  });

  it('writes change as a formula, and the grand total volume change is exactly 10,000', () => {
    const last = 6 + model.rows.length - 1;
    const d = ws.getCell(`D${last}`).value as ExcelJS.CellFormulaValue;
    expect(d.formula).toBe(`ROUND(C${last}-B${last},0)`);
    expect(d.result).toBe(10_000);
    expectSubtotalsAddUp(ws);
    for (const [i, row] of model.rows.entries()) {
      if (row.kind === 'group') continue;
      expect(num(ws.getCell(`G${6 + i}`))).toBeCloseTo(deltaOf(row, 'required')!, 9);
    }
  });

  it('lists the overrides and the horizon summary', () => {
    const o = wb.getWorksheet('Overrides')!;
    expect(o.getCell('A6').value).toBe('SC1.OV1');
    expect(o.getCell('C6').value).toBe('+10,000/wk');
  });
});

describe('hiring export', async () => {
  const hp = buildHiringPlan(basePlan, ds.plan.constants, ds.plan.isoYear);
  const wb = await roundTrip(hiringWorkbook(ExcelJS, hp, ctx));
  it('writes start dates as real dates', () => {
    const ws = wb.getWorksheet('Hiring plan')!;
    const cell = ws.getCell('E7');
    expect(cell.value).toBeInstanceOf(Date);
    expect((cell.value as Date).toISOString().slice(0, 10)).toBe(hp.classes[0]!.startDate);
  });
});

describe('file names', () => {
  it('are safe and readable', () => {
    expect(fileName(['FY27 Production Plan v3', 'Scenario 1', 'compare', '2027-W12'])).toBe('FY27-Production-Plan-v3_Scenario-1_compare_2027-W12.xlsx');
  });
});
