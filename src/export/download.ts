/**
 * Builds a workbook in the browser and saves it. The spreadsheet library is
 * loaded on first export, so it costs nothing until someone exports.
 */
import type ExcelJS from 'exceljs';

type Lib = { Workbook: new () => ExcelJS.Workbook };

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function downloadWorkbook(build: (lib: Lib) => ExcelJS.Workbook, name: string): Promise<void> {
  const mod = (await import('exceljs')) as unknown as Lib & { default?: Lib };
  const lib = mod.default ?? mod;
  const wb = build(lib);
  const buffer = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: XLSX_TYPE }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
