/**
 * Excel export. Plans, comparisons and the hiring plan as .xlsx, keeping the
 * grid's structure: merged column-group bands, group header rows, site rows,
 * subtotals and a grand total, with Excel outline levels so each group
 * collapses.
 *
 * Summed columns are live: subtotals and totals are SUBTOTAL(9, …) formulas
 * over site values written at display precision, so the workbook adds up
 * exactly as the screen does, and keeps adding up when a planner edits it.
 * Change columns are formulas too: scenario minus baseline.
 */
import type ExcelJS from 'exceljs';
import { deltaOf, type CompareModel, type HorizonSummary } from '../app/compare.ts';
import { displayRound } from '../app/format.ts';
import type { HiringPlan } from '../app/hiring.ts';
import { monthOf, varianceOf, varianceTone, type Band, type PeriodModel } from '../app/periods.ts';
import type { PlanWeek } from '../engine/index.ts';
import { COLUMNS, columnSpec, type ColumnKey, type GridRow, type NumericKey } from '../app/model.ts';
import type { AssumptionRecord } from '../data/dataset.ts';
import { describeChange, describeTarget, describeWhen, OVERRIDE_LABEL, type Scenario } from '../scenario/scenario.ts';

type Lib = { Workbook: new () => ExcelJS.Workbook };

// Direction A in Excel ----------------------------------------------------------

const ARGB = {
  accent: 'FF1F3864',
  bandDivider: 'FF2E4A7A',
  neg: 'FFA8201A',
  pos: 'FF1F6B32',
  warn: 'FF8A5D09',
  ink900: 'FF0F141C',
  ink600: 'FF47525F',
  ink400: 'FF7C8796',
  surface1: 'FFF7F9FC',
  surface2: 'FFEEF2F7',
  surface3: 'FFE3E8EF',
  accentSoft: 'FFE8EEF7',
  accentSoft2: 'FFDCE5F2',
  outsourcer: 'FFEDF1F7',
  line1: 'FFE7ECF2',
  line2: 'FFD4DBE4',
  white: 'FFFFFFFF',
};

const UI = 'Segoe UI';
const NUM = 'Consolas';

const FMT = {
  int: '#,##0',
  one: '#,##0.0',
  pct: '0.0%',
  signedOne: '+#,##0.0;-#,##0.0;0.0',
  signedInt: '+#,##0;-#,##0;0',
  date: 'ddd d mmm yyyy',
} as const;

const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const thin = (argb = ARGB.line1): Partial<ExcelJS.Border> => ({ style: 'thin', color: { argb } });
const ruled: Partial<ExcelJS.Borders> = { top: thin(), left: thin(), bottom: thin(), right: thin() };

type Tone = 'pos' | 'neg' | 'muted';

/** One cell to write: a value, or a formula with its cached result. */
interface CellSpec {
  v?: number | string | Date | null;
  f?: string;
  numFmt?: string;
  tone?: Tone;
  text?: boolean;
  /** Week band: actual and scenario cells are shaded as on screen. */
  band?: Band;
}

interface Col {
  header: string;
  band: string;
  /** Width in characters. */
  width: number;
  text?: boolean;
}

type RowKind = 'group' | 'site' | 'subtotal' | 'total';

interface Row {
  kind: RowKind;
  label: string;
  sub?: string;
  flag?: string;
  cells: (CellSpec | null)[];
}

export interface ExportContext {
  planName: string;
  scenarioName: string | null;
  /** e.g. "Week 2027-W12 (from Mon 22 Mar 2027) · grouped by outsourcer · all business units, languages, channels and staff types" */
  context: string;
  exportedOn: string;
}

function newWorkbook(lib: Lib, ctx: ExportContext): ExcelJS.Workbook {
  const wb = new lib.Workbook();
  wb.creator = 'Statixx Solutions';
  wb.lastModifiedBy = 'Statixx Solutions';
  wb.company = 'Statixx Solutions';
  wb.title = `${ctx.planName} · ${ctx.scenarioName ?? 'Baseline'}`;
  wb.created = new Date(`${ctx.exportedOn}T00:00:00Z`);
  wb.modified = wb.created;
  wb.calcProperties.fullCalcOnLoad = true;
  return wb;
}

/** Printed under the title of every sheet that carries Required FTE. */
export const CONVENTIONS =
  'Required FTE includes shrinkage; Productive FTE excludes it. Over/Under = Planned FTE − Required FTE: positive is over, negative is under.';

function addSheet(
  wb: ExcelJS.Workbook,
  name: string,
  title: string,
  context: string,
  cols: readonly Col[],
  convention?: string,
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name, {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 5, showGridLines: false }],
    properties: { defaultRowHeight: 18.75, outlineProperties: { summaryBelow: true, summaryRight: true } },
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  cols.forEach((c, i) => (ws.getColumn(i + 1).width = c.width));
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { name: UI, size: 12, bold: true, color: { argb: ARGB.ink900 } };
  const c = ws.getCell(2, 1);
  c.value = context;
  c.font = { name: UI, size: 9, color: { argb: ARGB.ink600 } };
  if (convention) {
    const n = ws.getCell(3, 1);
    n.value = convention;
    n.font = { name: UI, size: 9, bold: true, color: { argb: ARGB.accent } };
  }
  writeHeader(ws, 4, cols);
  return ws;
}

/** Band row with merged column groups, then the header row. */
function writeHeader(ws: ExcelJS.Worksheet, at: number, cols: readonly Col[]): void {
  let start = 0;
  cols.forEach((col, i) => {
    const next = cols[i + 1];
    if (next && next.band === col.band) return;
    if (i > start) ws.mergeCells(at, start + 1, at, i + 1);
    const cell = ws.getCell(at, start + 1);
    cell.value = col.band.toUpperCase();
    for (let j = start; j <= i; j++) {
      const b = ws.getCell(at, j + 1);
      b.fill = fill(ARGB.accent);
      b.font = { name: UI, size: 8, bold: true, color: { argb: ARGB.white } };
      b.alignment = { vertical: 'middle', horizontal: 'left' };
      b.border = { right: thin(ARGB.bandDivider) };
    }
    start = i + 1;
  });
  ws.getRow(at).height = 15;
  cols.forEach((col, i) => {
    const h = ws.getCell(at + 1, i + 1);
    h.value = col.header.toUpperCase();
    h.fill = fill(ARGB.surface2);
    h.font = { name: UI, size: 8, bold: true, color: { argb: ARGB.ink600 } };
    h.alignment = { vertical: 'middle', horizontal: i === 0 || col.text ? 'left' : 'right', indent: 1 };
    h.border = { ...ruled, bottom: thin(ARGB.line2) };
  });
  ws.getRow(at + 1).height = 20;
}

const ROW_FILL: Readonly<Record<RowKind, string>> = {
  group: ARGB.outsourcer,
  site: ARGB.white,
  subtotal: ARGB.surface1,
  total: ARGB.surface2,
};

function writeRows(ws: ExcelJS.Worksheet, first: number, cols: readonly Col[], rows: readonly Row[], outline: boolean): void {
  rows.forEach((row, i) => {
    const r = ws.getRow(first + i);
    r.height = 18.75;
    if (outline && row.kind === 'site') r.outlineLevel = 1;
    const bold = row.kind === 'group' || row.kind === 'total';
    const semi = row.kind === 'subtotal';

    const id = r.getCell(1);
    const indent = outline && row.kind === 'site' ? '    ' : '';
    id.value = `${indent}${row.label}${row.sub ? `  ${row.sub}` : ''}${row.flag ? `  [${row.flag}]` : ''}`;
    id.font = { name: UI, size: 10, bold: bold || semi, color: { argb: ARGB.ink900 } };
    styleCell(id, row.kind, true);

    cols.slice(1).forEach((col, j) => {
      const cell = r.getCell(j + 2);
      const spec = row.cells[j];
      if (spec) {
        cell.value = spec.f !== undefined ? { formula: spec.f, result: (spec.v ?? undefined) as ExcelJS.CellFormulaValue['result'] } : (spec.v ?? null);
        if (spec.numFmt) cell.numFmt = spec.numFmt;
      }
      const isText = spec?.text ?? col.text ?? false;
      cell.font = {
        name: isText ? UI : NUM,
        size: 10,
        bold: bold || semi,
        color: { argb: spec?.band === 'actual' && !spec.tone ? ARGB.ink600 : toneColour(spec?.tone) },
      };
      cell.alignment = { vertical: 'middle', horizontal: isText ? 'left' : 'right', indent: 1 };
      styleCell(cell, row.kind, false);
      const shade = spec?.band && row.kind !== 'group' ? BAND_FILL[spec.band][row.kind] : undefined;
      if (shade) cell.fill = fill(shade);
    });
  });
}

const BAND_FILL: Readonly<Record<Band, Partial<Record<RowKind, string>>>> = {
  actual: { site: ARGB.surface1, subtotal: ARGB.surface2, total: ARGB.surface3 },
  scenario: { site: ARGB.accentSoft, subtotal: ARGB.accentSoft2, total: ARGB.accentSoft2 },
  plan: {},
};

function styleCell(cell: ExcelJS.Cell, kind: RowKind, identity: boolean): void {
  cell.fill = fill(ROW_FILL[kind]);
  cell.border = kind === 'total' ? { ...ruled, top: { style: 'medium', color: { argb: ARGB.ink900 } } } : ruled;
  if (identity) cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
}

function toneColour(tone: Tone | undefined): string {
  return tone === 'pos' ? ARGB.pos : tone === 'neg' ? ARGB.neg : tone === 'muted' ? ARGB.ink400 : ARGB.ink900;
}

function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Excel rows of the site rows each aggregate row sums, by position in `rows`. */
function aggregateRanges(rows: readonly { kind: RowKind }[], first: number): Map<number, [number, number]> {
  const out = new Map<number, [number, number]>();
  let blockStart = -1;
  let firstSite = -1;
  let lastSite = -1;
  rows.forEach((r, i) => {
    if (r.kind === 'site') {
      if (blockStart < 0) blockStart = i;
      if (firstSite < 0) firstSite = i;
      lastSite = i;
    } else if (r.kind === 'subtotal') {
      if (blockStart >= 0) out.set(i, [first + blockStart, first + i - 1]);
      blockStart = -1;
    } else if (r.kind === 'group') {
      blockStart = -1;
    } else if (r.kind === 'total' && firstSite >= 0) {
      // SUBTOTAL ignores the nested SUBTOTAL cells, so the whole span is safe.
      out.set(i, [first + firstSite, first + lastSite]);
    }
  });
  return out;
}

// Plan grid -------------------------------------------------------------------

const FORMAT_OF: Readonly<Record<string, string>> = { int: FMT.int, one: FMT.one, pct: FMT.pct, signed: FMT.signedOne };

function siteValue(row: GridRow, key: NumericKey): number | null {
  const v = row.cells[key];
  if (v === null || v === undefined) return null;
  const spec = columnSpec(key);
  // Summed metrics at display precision, so SUBTOTAL matches the screen.
  return spec.aggregate === 'sum' ? displayRound(v, spec.format ?? 'one') : v;
}

function overUnderTone(v: number | null): Tone | undefined {
  if (v === null) return undefined;
  const r = displayRound(v, 'signed');
  if (v === 0) return 'muted';
  return r > 0 ? 'pos' : r < 0 ? 'neg' : undefined;
}

function planCell(row: GridRow, key: ColumnKey, colIndex: number, range: [number, number] | undefined): CellSpec | null {
  if (row.kind === 'group') return null;
  if (key === 'classStart') return { v: row.kind === 'site' ? (row.classStart ?? '–') : '–', text: true, tone: row.classStart ? undefined : 'muted' };
  const k = key as NumericKey;
  const spec = columnSpec(k);
  const numFmt = FORMAT_OF[spec.format ?? 'one'];
  const value = row.kind === 'site' ? siteValue(row, k) : (row.cells[k] ?? null);
  if (value === null) return { v: '–', tone: 'muted' };
  const tone = k === 'overUnder' ? overUnderTone(value) : value === 0 ? 'muted' : undefined;
  if (row.kind !== 'site' && spec.aggregate === 'sum' && range) {
    const L = colLetter(colIndex);
    return { f: `SUBTOTAL(9,${L}${range[0]}:${L}${range[1]})`, v: value, numFmt, tone };
  }
  return { v: value, numFmt, tone };
}

export function planWorkbook(
  lib: Lib,
  rows: readonly GridRow[],
  hidden: ReadonlySet<ColumnKey>,
  ctx: ExportContext,
  sheetName: string,
  extras: { hiring?: HiringPlan; assumptions?: readonly AssumptionRecord[]; scenario?: Scenario | null; siteName?: (id: string) => string },
): ExcelJS.Workbook {
  const wb = newWorkbook(lib, ctx);
  const visible = COLUMNS.filter((c) => c.key === 'site' || !hidden.has(c.key));
  const cols: Col[] = visible.map((c) => ({
    header: c.header,
    band: c.group === 'identity' ? 'Site' : (COLUMN_BAND[c.group] ?? c.group),
    width: c.key === 'site' ? 34 : Math.max(10, Math.round(c.width / 7)),
    text: c.key === 'classStart',
  }));
  const ws = addSheet(wb, sheetName, `${ctx.planName} · ${ctx.scenarioName ?? 'Baseline'}`, ctx.context, cols, CONVENTIONS);
  const first = 6;
  const ranges = aggregateRanges(rows, first);
  const out: Row[] = rows.map((row, i) => ({
    kind: row.kind,
    label: row.label,
    sub: row.code,
    flag: row.atCap ? 'CAP' : undefined,
    cells: visible.slice(1).map((c, j) => planCell(row, c.key, j + 2, ranges.get(i))),
  }));
  writeRows(ws, first, cols, out, rows.some((r) => r.kind === 'group'));
  if (extras.hiring) hiringSheet(wb, extras.hiring, ctx);
  if (extras.scenario) overridesSheet(wb, extras.scenario, null, ctx, extras.siteName ?? ((id) => id));
  if (extras.assumptions) assumptionsSheet(wb, extras.assumptions, ctx);
  return wb;
}

/**
 * Periods grid: one metric, one column per week, months as merged bands.
 * Elapsed weeks are actuals and the weeks after the plan or scenario, shaded as
 * on screen. With actuals or a scenario, two more sheets follow in the same
 * layout: the locked plan, and the variance as live formulas against it.
 */
export function periodsWorkbook(
  lib: Lib,
  model: PeriodModel,
  weeks: readonly PlanWeek[],
  metric: NumericKey,
  ctx: ExportContext,
  sheetName: string,
  extras: { hiring?: HiringPlan; assumptions?: readonly AssumptionRecord[]; scenario?: Scenario | null; siteName?: (id: string) => string },
): ExcelJS.Workbook {
  const wb = newWorkbook(lib, ctx);
  const spec = columnSpec(metric);
  const header = spec.header;
  const cols: Col[] = [
    { header: `Site · ${header}`, band: 'Site', width: 34 },
    ...weeks.map((w) => ({ header: w.label.slice(5), band: monthOf(w).label, width: metric === 'volume' ? 11 : 9 })),
  ];
  const first = 6;
  const ranges = aggregateRanges(model.rows, first);
  const outline = model.rows.some((r) => r.kind === 'group');
  const bandText = describeBands(model, weeks, ctx.scenarioName);
  const sheet = (name: string, title: string, byWeek: (row: PeriodModel['rows'][number]) => readonly GridRow[], shade: boolean) => {
    const ws = addSheet(wb, name, title, `${ctx.context}${bandText && shade ? ` · ${bandText}` : ''}`, cols, CONVENTIONS);
    const out: Row[] = model.rows.map((row, i) => ({
      kind: row.kind,
      label: row.label,
      sub: row.code,
      flag: row.drift && shade ? 'OFF PLAN' : undefined,
      cells: byWeek(row).map((g, w) => {
        const cell = planCell(g, metric, w + 2, ranges.get(i));
        return cell && shade ? { ...cell, band: model.bands[w], tone: model.bands[w] === 'actual' ? undefined : cell.tone } : cell;
      }),
    }));
    writeRows(ws, first, cols, out, outline);
    return ws;
  };

  sheet(sheetName, `${ctx.planName} · ${ctx.scenarioName ?? 'Baseline'} · ${header} by week`, (r) => r.byWeek, true);

  if (model.bands.some((b) => b !== 'plan')) {
    const planName = 'Plan by week';
    sheet(planName, `${ctx.planName} · locked plan · ${header} by week`, (r) => r.planByWeek, false);
    const vs = addSheet(
      wb,
      'Variance by week',
      `${ctx.planName} · ${header} variance against the locked plan`,
      `${bandText}. Variance = ${sheetName} − ${planName}, at display precision.`,
      cols,
      CONVENTIONS,
    );
    const dp = spec.format === 'int' ? 0 : spec.format === 'pct' ? 3 : 1;
    const numFmt = spec.format === 'int' ? FMT.signedInt : spec.format === 'pct' ? '+0.0%;-0.0%;0.0%' : FMT.signedOne;
    const out: Row[] = model.rows.map((row, i) => ({
      kind: row.kind,
      label: row.label,
      sub: row.code,
      cells: weeks.map((_, w) => {
        if (row.kind === 'group' || model.bands[w] === 'plan') return null;
        const v = varianceOf(model, row, w, metric);
        if (v === null) return { v: '–', tone: 'muted' as const, band: model.bands[w] };
        const ref = `${colLetter(w + 2)}${first + i}`;
        return {
          f: `ROUND('${sheetName}'!${ref}-'${planName}'!${ref},${dp})`,
          v: Math.round(v * 10 ** dp) / 10 ** dp,
          numFmt,
          tone: varianceTone(metric, v) ?? undefined,
          band: model.bands[w],
        };
      }),
    }));
    writeRows(vs, first, cols, out, outline);
  }

  if (extras.hiring) hiringSheet(wb, extras.hiring, ctx);
  if (extras.scenario) overridesSheet(wb, extras.scenario, null, ctx, extras.siteName ?? ((id) => id));
  if (extras.assumptions) assumptionsSheet(wb, extras.assumptions, ctx);
  return wb;
}

/** "W01–W11 actuals (shaded); W12–W52 Scenario 1 (tinted)" */
function describeBands(model: PeriodModel, weeks: readonly PlanWeek[], scenarioName: string | null): string {
  const parts: string[] = [];
  model.bands.forEach((band, i) => {
    if (i > 0 && model.bands[i - 1] === band) return;
    let j = i;
    while (model.bands[j + 1] === band) j++;
    const range = `${weeks[i]!.label.slice(5)}–${weeks[j]!.label.slice(5)}`;
    parts.push(band === 'actual' ? `${range} actuals (shaded)` : band === 'scenario' ? `${range} ${scenarioName ?? 'scenario'} (tinted)` : `${range} locked plan`);
  });
  return parts.length > 1 || model.bands[0] !== 'plan' ? parts.join('; ') : '';
}

const COLUMN_BAND: Readonly<Record<string, string>> = {
  demand: 'Demand',
  requirement: 'Requirement',
  supply: 'Supply',
  hiring: 'Over/under & hiring',
};

// Comparison ------------------------------------------------------------------

export function compareWorkbook(
  lib: Lib,
  model: CompareModel,
  metrics: readonly NumericKey[],
  ctx: ExportContext,
  sheetName: string,
  extras: { scenario: Scenario; summary: HorizonSummary; assumptions?: readonly AssumptionRecord[]; siteName: (id: string) => string },
): ExcelJS.Workbook {
  const wb = newWorkbook(lib, ctx);
  const cols: Col[] = [{ header: 'Site', band: 'Site', width: 34 }];
  for (const m of metrics) {
    const band = columnSpec(m).header;
    const w = m === 'volume' || m === 'workload' ? 13 : 11;
    cols.push({ header: 'Base', band, width: w }, { header: 'Scen.', band, width: w }, { header: 'Δ', band, width: w - 1 });
  }
  cols.push({ header: 'Changed', band: 'Status', width: 10, text: true });

  const ws = addSheet(wb, sheetName, `${ctx.planName} · Baseline against ${extras.scenario.name}`, ctx.context, cols, CONVENTIONS);
  const first = 6;
  const ranges = aggregateRanges(model.rows, first);
  const out: Row[] = model.rows.map((row, i) => {
    const cells: (CellSpec | null)[] = [];
    metrics.forEach((m, mi) => {
      const baseCol = 2 + mi * 3;
      const spec = columnSpec(m);
      if (row.kind === 'group') {
        cells.push(null, null, null);
        return;
      }
      const b = planCell(row.base, m, baseCol, ranges.get(i));
      const s = planCell(row.scen, m, baseCol + 1, ranges.get(i));
      const d = deltaOf(row, m);
      // Rounded to what the grid shows, so float dust never reads as +0 or -0.
      const dp = spec.format === 'int' ? 0 : spec.format === 'pct' ? 3 : 1;
      const delta: CellSpec =
        d === null
          ? { v: '–', tone: 'muted' }
          : {
              f: `ROUND(${colLetter(baseCol + 1)}${first + i}-${colLetter(baseCol)}${first + i},${dp})`,
              v: Math.round(d * 10 ** dp) / 10 ** dp,
              numFmt: spec.format === 'int' ? FMT.signedInt : spec.format === 'pct' ? '+0.0%;-0.0%;0.0%' : FMT.signedOne,
              tone: d === 0 ? 'muted' : m === 'overUnder' ? (d > 0 ? 'pos' : 'neg') : undefined,
            };
      cells.push(b, s, delta);
    });
    cells.push(row.kind === 'site' ? { v: row.changed ? 'Yes' : '', text: true } : null);
    return {
      kind: row.kind,
      label: row.base.label,
      sub: row.base.code,
      flag: row.scen.atCap ? 'CAP' : undefined,
      cells,
    };
  });
  writeRows(ws, first, cols, out, model.rows.some((r) => r.kind === 'group'));
  overridesSheet(wb, extras.scenario, extras.summary, ctx, extras.siteName);
  if (extras.assumptions) assumptionsSheet(wb, extras.assumptions, ctx);
  return wb;
}

function overridesSheet(
  wb: ExcelJS.Workbook,
  scenario: Scenario,
  summary: HorizonSummary | null,
  ctx: ExportContext,
  siteName: (id: string) => string,
): void {
  const cols: Col[] = [
    { header: 'Code', band: 'Override', width: 14 },
    { header: 'Variable', band: 'Override', width: 14, text: true },
    { header: 'Change', band: 'Override', width: 16, text: true },
    { header: 'Applies to', band: 'Scope', width: 24, text: true },
    { header: 'Weeks', band: 'Scope', width: 16, text: true },
  ];
  const ws = addSheet(wb, 'Overrides', `${ctx.planName} · ${scenario.name} · overrides`, `Forked from ${scenario.forkedFrom}`, cols);
  const rows: Row[] = scenario.overrides.map((o) => ({
    kind: 'site',
    label: o.code,
    cells: [
      { v: OVERRIDE_LABEL[o.kind], text: true },
      { v: describeChange(o), text: true },
      { v: describeTarget(o, siteName), text: true },
      { v: describeWhen(o, 52), text: true },
    ],
  }));
  if (rows.length === 0) rows.push({ kind: 'site', label: 'None', cells: [null, null, null, null] });
  writeRows(ws, 6, cols, rows, false);

  if (!summary) return;
  const at = 6 + rows.length + 2;
  const scols: Col[] = [
    { header: 'Measure', band: 'Horizon', width: 14 },
    { header: 'Baseline', band: 'Horizon', width: 14 },
    { header: scenario.name, band: 'Horizon', width: 16 },
    { header: 'Δ', band: 'Horizon', width: 24 },
  ];
  writeHeader(ws, at, scols);
  const lines: [string, [number, number], string][] = [
    ['Avg required FTE', summary.avgRequired, FMT.one],
    ['Hires to start', summary.starters, FMT.int],
    ['Site-weeks over cap', summary.capShortfallWeeks, FMT.int],
    ['Lead-time shortfall FTE', summary.leadShortfallFte, FMT.one],
  ];
  const srows: Row[] = lines.map(([label, pair, fmt], i) => ({
    kind: 'site',
    label,
    cells: [
      { v: pair[0], numFmt: fmt },
      { v: pair[1], numFmt: fmt },
      { f: `C${at + 2 + i}-B${at + 2 + i}`, v: pair[1] - pair[0], numFmt: fmt === FMT.int ? FMT.signedInt : FMT.signedOne },
    ],
  }));
  writeRows(ws, at + 2, scols, srows, false);
}

const longDay = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// Hiring plan -------------------------------------------------------------------

export function hiringWorkbook(lib: Lib, hp: HiringPlan, ctx: ExportContext, assumptions?: readonly AssumptionRecord[]): ExcelJS.Workbook {
  const wb = newWorkbook(lib, ctx);
  hiringSheet(wb, hp, ctx);
  if (assumptions) assumptionsSheet(wb, assumptions, ctx);
  return wb;
}

function hiringSheet(wb: ExcelJS.Workbook, hp: HiringPlan, ctx: ExportContext): void {
  const cols: Col[] = [
    { header: 'Site', band: 'Start week / site', width: 30 },
    { header: 'Outsourcer', band: 'Class', width: 20, text: true },
    { header: 'Starters', band: 'Class', width: 10 },
    { header: 'Graduates', band: 'Class', width: 11 },
    { header: 'Start', band: 'Schedule', width: 17 },
    { header: 'Training', band: 'Schedule', width: 12, text: true },
    { header: 'Nesting', band: 'Schedule', width: 12, text: true },
    { header: 'Productive', band: 'Schedule', width: 12, text: true },
    { header: 'Need FTE', band: 'Need', width: 11 },
    { header: 'Driver', band: 'Need', width: 60, text: true },
  ];
  const limits = [
    `Classes of ${hp.minClassSize}${hp.maxClassSize !== null ? `–${hp.maxClassSize}` : ' or more'}`,
    hp.maxClassesPerWeek !== null ? `at most ${hp.maxClassesPerWeek} a site a week` : null,
    hp.blockedWeeks.length > 0 ? `no starts in ${hp.blockedWeeks.map((b) => `${b.label}${b.name ? ` (${b.name})` : ''}`).join(', ')}` : null,
  ].filter(Boolean);
  const context = `${limits.join(' · ')} · training ${hp.trainingWeeks} wks · nesting ${hp.nestingWeeks} wks · each class is productive in the week its site needs the heads, or earlier where a constraint moved it`;
  const ws = addSheet(wb, 'Hiring plan', `Hiring plan · ${ctx.planName} · ${ctx.scenarioName ?? 'Baseline'}`, context, cols);

  const rows: Row[] = [];
  for (const g of hp.byWeek) {
    rows.push({ kind: 'group', label: g.label, sub: `classes start ${longDay.format(new Date(`${g.date}T00:00:00Z`))}`, cells: [] });
    for (const c of g.classes) {
      rows.push({
        kind: 'site',
        label: c.siteName,
        sub: c.classCount > 1 ? `${c.siteId} ${c.classIndex}/${c.classCount}` : c.siteId,
        flag: [c.capLimited ? 'CAP' : '', c.moved.length > 0 ? 'MOVED' : ''].filter(Boolean).join('] [') || undefined,
        cells: [
          { v: c.outsourcer, text: true },
          { v: c.starters, numFmt: FMT.int },
          { v: displayRound(c.graduates, 'one'), numFmt: FMT.one },
          { v: new Date(`${c.startDate}T00:00:00Z`), numFmt: FMT.date },
          { v: c.trainingLabel, text: true },
          { v: c.nestingLabel, text: true },
          { v: c.productiveLabel.slice(5), text: true },
          { v: displayRound(c.deficit, 'one'), numFmt: FMT.one },
          { v: c.driver, text: true },
        ],
      });
    }
    rows.push({ kind: 'subtotal', label: `${g.label.slice(5)} total`, sub: `${g.classes.length} class${g.classes.length === 1 ? '' : 'es'}`, cells: [] });
  }
  if (rows.length > 0) rows.push({ kind: 'total', label: 'Total', sub: `${hp.classes.length} classes`, cells: [] });
  const first = 6;
  const ranges = aggregateRanges(rows, first);
  rows.forEach((r, i) => {
    const range = ranges.get(i);
    if (!range || (r.kind !== 'subtotal' && r.kind !== 'total')) return;
    const block = rows.slice(range[0] - first, range[1] - first + 1).filter((x) => x.kind === 'site');
    const sum = (j: number) => block.reduce((s, x) => s + (Number(x.cells[j]?.v) || 0), 0);
    const f = (L: string) => `SUBTOTAL(9,${L}${range[0]}:${L}${range[1]})`;
    r.cells = [
      null,
      { f: f('C'), v: sum(1), numFmt: FMT.int },
      { f: f('D'), v: displayRound(sum(2), 'one'), numFmt: FMT.one },
      null,
      null,
      null,
      null,
      { f: f('I'), v: displayRound(sum(7), 'one'), numFmt: FMT.one },
      null,
    ];
  });
  writeRows(ws, first, cols, rows, true);

  if (hp.exceptions.length === 0) return;
  const at = first + rows.length + 2;
  const band = 'Exceptions';
  const ecols: Col[] = [
    { header: 'Site', band, width: 30 },
    { header: 'Outsourcer', band, width: 20, text: true },
    { header: 'Exception', band, width: 10, text: true },
    { header: 'FTE / starters', band, width: 11 },
    { header: 'Weeks', band, width: 17, text: true },
    { header: 'Reason', band, width: 12, text: true },
  ];
  writeHeader(ws, at, ecols);
  const w = (n: number) => `W${String(n).padStart(2, '0')}`;
  const LABEL = { lead: 'Lead time', cap: 'Cap', constraint: 'No week', moved: 'Moved' } as const;
  const erows: Row[] = hp.exceptions.map((e) => ({
    kind: 'site',
    label: e.siteName,
    sub: e.siteId,
    flag: e.kind === 'cap' ? 'CAP' : undefined,
    cells: [
      { v: e.outsourcer, text: true },
      { v: LABEL[e.kind], text: true },
      e.kind === 'moved' ? { v: e.peakFte, numFmt: FMT.int } : { v: displayRound(e.peakFte, 'one'), numFmt: FMT.one },
      {
        v: e.move ? `starts ${w(e.move.startWeek)}, for ${w(e.move.forWeek)}` : `${w(e.peakWeek)} · ${e.weeks.length} wks`,
        text: true,
      },
      { v: e.reason ?? '', text: true },
    ],
  }));
  writeRows(ws, at + 2, ecols, erows, false);
}

// Assumptions -----------------------------------------------------------------

function assumptionsSheet(wb: ExcelJS.Workbook, records: readonly AssumptionRecord[], ctx: ExportContext): void {
  const cols: Col[] = [
    { header: 'Code', band: 'Assumption record', width: 14 },
    { header: 'Label', band: 'Assumption record', width: 36, text: true },
    { header: 'Value', band: 'Assumption record', width: 12 },
    { header: 'Unit', band: 'Assumption record', width: 10, text: true },
    { header: 'Scope', band: 'Assumption record', width: 34, text: true },
  ];
  const ws = addSheet(wb, 'Assumptions', `Assumptions · ${ctx.planName}`, 'Codes match the assumption codes shown in the calculation inspector', cols);
  const rows: Row[] = records.map((a) => ({
    kind: 'site',
    label: a.code,
    cells: [
      { v: a.label, text: true },
      a.value === null ? { v: '–', tone: 'muted' } : { v: a.value, numFmt: a.unit === 'ratio' ? '0.0%' : '#,##0.##' },
      { v: a.unit === 'ratio' ? '%' : a.unit, text: true },
      { v: a.scope, text: true },
    ],
  }));
  writeRows(ws, 6, cols, rows, false);
}

// File names ------------------------------------------------------------------

export function fileName(parts: readonly string[]): string {
  return `${parts.map((p) => p.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-|-$/g, '')).join('_')}.xlsx`;
}
