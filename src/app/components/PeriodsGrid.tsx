import { createColumnHelper, flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useEffect, useMemo, useRef } from 'react';
import type { PlanWeek } from '../../engine/index.ts';
import { formatDelta, formatValue, shortDate } from '../format.ts';
import { columnSpec, GROUPINGS, type Grouping, type NumericKey } from '../model.ts';
import { monthOf, startsMonth, varianceOf, varianceTone, type Band, type PeriodModel, type PeriodRow } from '../periods.ts';
import type { CellRef } from './Grid.tsx';

export type Density = 'comfortable' | 'compact';

interface PeriodsGridProps {
  model: PeriodModel;
  weeks: readonly PlanWeek[];
  metric: NumericKey;
  grouping: Grouping;
  density: Density;
  /** Week the toolbar points at; its column is marked and kept in view. */
  focusWeek: number;
  /** Selected cell: the row and metric, at the focus week. */
  selected: CellRef | null;
  onSelect: (rowId: string, week: number) => void;
  /** A variance row under each row: actual − plan, or scenario − plan. */
  showVariance: boolean;
  /** Names for the phase header. */
  planName: string;
  scenarioName: string | null;
}

/** Row id of the variance row under a row. */
export const varianceRowId = (rowId: string) => `var:${rowId}`;

const oneFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Consecutive weeks in the same band, for the phase header. */
function phases(model: PeriodModel, weeks: readonly PlanWeek[]): { band: Band; from: PlanWeek; to: PlanWeek; span: number }[] {
  const out: { band: Band; from: PlanWeek; to: PlanWeek; span: number }[] = [];
  model.bands.forEach((band, i) => {
    const last = out.at(-1);
    if (last && last.band === band) {
      last.to = weeks[i]!;
      last.span++;
    } else out.push({ band, from: weeks[i]!, to: weeks[i]!, span: 1 });
  });
  return out;
}

const helper = createColumnHelper<PeriodRow>();

export function PeriodsGrid(props: PeriodsGridProps) {
  const { model, weeks, metric, grouping, density, focusWeek, selected, onSelect, showVariance, planName, scenarioName } = props;
  const spec = columnSpec(metric);
  const bandLabel = GROUPINGS.find((g) => g.id === grouping)?.band ?? 'Site';
  const weekWidth = (density === 'compact' ? 52 : 62) + (metric === 'volume' ? 8 : 0);

  const columns = useMemo<ColumnDef<PeriodRow, unknown>[]>(() => {
    const months: { key: string; label: string; weeks: { week: PlanWeek; index: number }[] }[] = [];
    weeks.forEach((week, index) => {
      const m = monthOf(week);
      const last = months.at(-1);
      if (last && last.key === m.key) last.weeks.push({ week, index });
      else months.push({ key: m.key, label: m.label, weeks: [{ week, index }] });
    });
    return [
      helper.group({
        id: 'identity',
        header: bandLabel,
        columns: [helper.display({ id: 'site', header: 'Site', size: 204 })],
      }),
      ...months.map((m) =>
        helper.group({
          id: `m:${m.key}`,
          header: m.label,
          columns: m.weeks.map(({ week, index }) =>
            helper.display({ id: `w:${week.index}`, header: week.label, size: weekWidth, meta: { week, weekIndex: index } }),
          ),
        }),
      ),
    ];
  }, [weeks, bandLabel, weekWidth]);

  const table = useReactTable({ data: model.rows, columns, getRowId: (r) => r.id, getCoreRowModel: getCoreRowModel() });
  const leaves = table.getVisibleLeafColumns();
  const width = leaves.reduce((s, c) => s + c.getSize(), 0);
  const [bandRow, headRow] = table.getHeaderGroups();

  // Keep the focus week in view, clear of the frozen site column.
  const tableRef = useRef<HTMLTableElement>(null);
  useEffect(() => {
    const table = tableRef.current;
    const scroller = table?.closest('.grid-scroll');
    const cell = table?.querySelector<HTMLElement>(`th[data-week="${focusWeek}"]`);
    if (!table || !scroller || !cell) return;
    const frozen = 204;
    const left = cell.offsetLeft - frozen;
    const right = cell.offsetLeft + cell.offsetWidth;
    if (left < scroller.scrollLeft) scroller.scrollLeft = Math.max(0, left - weekWidth);
    else if (right > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = right - scroller.clientWidth + weekWidth;
  }, [focusWeek, weekWidth, metric]);

  const isNow = (index: number) => index > 0 && model.bands[index] !== model.bands[index - 1];
  /** Band fill and the vertical rules every cell in a week column carries. */
  const frameClass = (index: number | undefined) =>
    index === undefined
      ? undefined
      : [`band-${model.bands[index]}`, startsMonth(weeks, index) ? 'month-start' : '', isNow(index) ? 'now' : ''].filter(Boolean).join(' ');
  const hasVariance = model.bands.some((b) => b !== 'plan');

  if (model.rows.length === 0) {
    return <div className="grid-empty">No sites carry the selected business units, languages, channels and staff types.</div>;
  }

  return (
    <table ref={tableRef} className={`grid periods ${grouping === 'none' ? 'flat' : ''}`} style={{ width }}>
      <colgroup>
        {leaves.map((c) => (
          <col key={c.id} style={{ width: c.getSize() }} />
        ))}
      </colgroup>
      <thead>
        <tr className="phase">
          <th className="id" />
          {phases(model, weeks).map((ph) => (
            <th key={ph.from.index} colSpan={ph.span} className={`band-${ph.band} ${ph.from.index > 1 ? 'now' : ''}`}>
              <span className="phase-label">
                {ph.band === 'actual' ? 'Actual' : ph.band === 'scenario' ? (scenarioName ?? 'Scenario') : `Plan · ${planName}`}
                <span className="phase-range">
                  {ph.from.label.slice(5)}–{ph.to.label.slice(5)}
                </span>
              </span>
            </th>
          ))}
        </tr>
        <tr className="band">
          {bandRow?.headers.map((h) => (
            <th key={h.id} colSpan={h.colSpan} className={h.column.id === 'identity' ? 'id' : undefined}>
              {flexRender(h.column.columnDef.header, h.getContext())}
            </th>
          ))}
        </tr>
        <tr className="head">
          {headRow?.headers.map((h) => {
            if (h.column.id === 'site') {
              return (
                <th key={h.id} className="id" scope="col">
                  Site <span className="metric-tag">{spec.header}</span>
                </th>
              );
            }
            const { week, weekIndex: index } = h.column.columnDef.meta ?? {};
            const cls = [
              index !== undefined && startsMonth(weeks, index) ? 'month-start' : '',
              index !== undefined ? `band-${model.bands[index]}` : '',
              index !== undefined && isNow(index) ? 'now' : '',
              week?.index === focusWeek ? 'focus' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <th key={h.id} className={`week ${cls}`} scope="col" data-week={week?.index}>
                <span className="wk">{week?.label.slice(5)}</span>
                <span className="wd">{week ? shortDate(week.start) : ''}</span>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {table.getRowModel().rows.flatMap((r) => {
          const row = r.original;
          const focusRow = row.byWeek[focusWeek - 1];
          const main = (
            <tr key={r.id} className={row.kind}>
              {r.getVisibleCells().map((c) => {
                if (c.column.id === 'site') {
                  return (
                    <td key={c.id} className="id">
                      <div className="id-cell">
                        <span className="id-name">{row.label}</span>
                        {row.code && <span className="id-code">{row.code}</span>}
                        {focusRow?.atCap && (
                          <span className="flag-cap" title="Planned FTE at contracted cap in the focus week">
                            CAP
                          </span>
                        )}
                        {row.drift && (
                          <span
                            className={`flag-drift ${row.drift.share < 0 ? 'neg' : 'pos'}`}
                            title={`Over/Under ${oneFmt.format(Math.abs(row.drift.overUnder))} FTE ${row.drift.share < 0 ? 'below' : 'above'} plan a week on average, ${weeks[row.drift.fromWeek - 1]?.label.slice(5)}–${weeks[row.drift.toWeek - 1]?.label.slice(5)}: ${oneFmt.format(Math.abs(row.drift.share) * 100)}% of required FTE`}
                          >
                            OFF PLAN
                          </span>
                        )}
                      </div>
                    </td>
                  );
                }
                const { week, weekIndex: index } = c.column.columnDef.meta ?? {};
                if (row.kind === 'group' || !week || index === undefined) return <td key={c.id} className={frameClass(index)} />;
                const g = row.byWeek[index]!;
                const band = model.bands[index]!;
                const f = formatValue(g.cells[metric], spec.format ?? 'one');
                const isSel = selected?.rowId === row.id && selected.key === metric && week.index === focusWeek;
                const cls = [
                  band === 'actual' ? undefined : f.tone,
                  g.inputs.has(metric) ? 'input' : 'computed',
                  frameClass(index),
                  week.index === focusWeek ? 'focus' : undefined,
                  isSel ? 'selected' : undefined,
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <td key={c.id} className={cls} onClick={() => onSelect(row.id, week.index)}>
                    {f.text}
                  </td>
                );
              })}
            </tr>
          );
          if (!showVariance || row.kind === 'group' || !hasVariance) return [main];
          const varId = varianceRowId(row.id);
          const variance = (
            <tr key={varId} className={`variance of-${row.kind}`}>
              {leaves.map((col) => {
                if (col.id === 'site') {
                  return (
                    <td key={col.id} className="id">
                      <div className="id-cell">
                        <span className="id-name">Var. vs plan</span>
                      </div>
                    </td>
                  );
                }
                const { week, weekIndex: index } = col.columnDef.meta ?? {};
                if (!week || index === undefined) return <td key={col.id} />;
                const v = varianceOf(model, row, index, metric);
                if (v === null) return <td key={col.id} className={frameClass(index)} />;
                const f = formatDelta(v, spec.format ?? 'one', false);
                const isSel = selected?.rowId === varId && selected.key === metric && week.index === focusWeek;
                const cls = [varianceTone(metric, v) ?? f.tone, 'computed', frameClass(index), week.index === focusWeek ? 'focus' : undefined, isSel ? 'selected' : undefined]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <td key={col.id} className={cls} onClick={() => onSelect(varId, week.index)}>
                    {f.text}
                  </td>
                );
              })}
            </tr>
          );
          return [main, variance];
        })}
      </tbody>
    </table>
  );
}
