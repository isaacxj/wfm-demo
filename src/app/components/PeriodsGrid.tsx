import { createColumnHelper, flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useEffect, useMemo, useRef } from 'react';
import type { PlanWeek } from '../../engine/index.ts';
import { formatValue, shortDate } from '../format.ts';
import { columnSpec, GROUPINGS, type Grouping, type NumericKey } from '../model.ts';
import { monthOf, startsMonth, type PeriodModel, type PeriodRow } from '../periods.ts';
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
}

const helper = createColumnHelper<PeriodRow>();

export function PeriodsGrid({ model, weeks, metric, grouping, density, focusWeek, selected, onSelect }: PeriodsGridProps) {
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

  if (model.rows.length === 0) {
    return <div className="grid-empty">No sites carry the selected business units, languages and channels.</div>;
  }

  return (
    <table ref={tableRef} className={`grid periods ${grouping === 'none' ? 'flat' : ''}`} style={{ width }}>
      <colgroup>
        {leaves.map((c) => (
          <col key={c.id} style={{ width: c.getSize() }} />
        ))}
      </colgroup>
      <thead>
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
            const cls = [index !== undefined && startsMonth(weeks, index) ? 'month-start' : '', week?.index === focusWeek ? 'focus' : '']
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
        {table.getRowModel().rows.map((r) => {
          const row = r.original;
          const focusRow = row.byWeek[focusWeek - 1];
          return (
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
                      </div>
                    </td>
                  );
                }
                const { week, weekIndex: index } = c.column.columnDef.meta ?? {};
                if (row.kind === 'group' || !week || index === undefined) return <td key={c.id} className={index !== undefined && startsMonth(weeks, index) ? 'month-start' : undefined} />;
                const g = row.byWeek[index]!;
                const f = formatValue(g.cells[metric], spec.format ?? 'one');
                const isSel = selected?.rowId === row.id && selected.key === metric && week.index === focusWeek;
                const cls = [
                  f.tone,
                  g.inputs.has(metric) ? 'input' : 'computed',
                  startsMonth(weeks, index) ? 'month-start' : undefined,
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
        })}
      </tbody>
    </table>
  );
}
