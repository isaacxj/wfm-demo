import type { PlanWeek } from '../../engine/index.ts';
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import { formatValue, NOT_APPLICABLE, type Formatted } from '../format.ts';
import { COLUMN_GROUPS, COLUMNS, type ColumnKey, type ColumnSpec, type GridRow, type Grouping, GROUPINGS, type NumericKey } from '../model.ts';

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData, TValue> {
    spec?: ColumnSpec;
    /** Comparison grid: the metric and side a leaf column shows. */
    metric?: NumericKey;
    side?: 'base' | 'scen' | 'delta';
    /** Periods grid: the week a leaf column shows, and its position in the horizon. */
    week?: PlanWeek;
    weekIndex?: number;
  }
}

export interface CellRef {
  rowId: string;
  key: ColumnKey;
}

interface GridProps {
  rows: GridRow[];
  grouping: Grouping;
  allocated: boolean;
  hidden: ReadonlySet<ColumnKey>;
  selected: CellRef | null;
  onSelect: (ref: CellRef | null) => void;
}

const helper = createColumnHelper<GridRow>();

export function cellText(row: GridRow, spec: ColumnSpec): Formatted {
  if (row.kind === 'group') return { text: '', tone: undefined };
  if (spec.key === 'classStart') return row.classStart ? { text: row.classStart, tone: undefined } : NOT_APPLICABLE;
  if (spec.key === 'site') return { text: row.label, tone: undefined };
  return formatValue(row.cells[spec.key], spec.format ?? 'one');
}

/** Header text is uppercase; a trailing unit such as "s" keeps its case. */
function headerLabel(text: string) {
  const m = /^(.*) (s)$/.exec(text);
  return m ? (
    <>
      {m[1]} <span className="unit">{m[2]}</span>
    </>
  ) : (
    text
  );
}

export function Grid({ rows, grouping, allocated, hidden, selected, onSelect }: GridProps) {
  const bandLabel = GROUPINGS.find((g) => g.id === grouping)?.band ?? 'Site';

  const columns = useMemo<ColumnDef<GridRow, unknown>[]>(
    () =>
      COLUMN_GROUPS.map((g) =>
        helper.group({
          id: g.id,
          header: g.id === 'identity' ? bandLabel : g.id === 'supply' && allocated ? 'Supply · allocated' : g.label,
          columns: COLUMNS.filter((c) => c.group === g.id).map((spec) =>
            helper.display({ id: spec.key, header: spec.header, size: spec.width, meta: { spec } }),
          ),
        }),
      ),
    [bandLabel, allocated],
  );

  const columnVisibility = useMemo(() => Object.fromEntries([...hidden].map((k) => [k, false])), [hidden]);

  const table = useReactTable({
    data: rows,
    columns,
    getRowId: (r) => r.id,
    getCoreRowModel: getCoreRowModel(),
    state: { columnVisibility },
  });

  const leaves = table.getVisibleLeafColumns();
  const width = leaves.reduce((s, c) => s + c.getSize(), 0);
  const [bandRow, headRow] = table.getHeaderGroups();

  if (rows.length === 0) {
    return <div className="grid-empty">No sites carry the selected business units, languages and channels.</div>;
  }

  return (
    <table className={`grid ${grouping === 'none' ? 'flat' : ''}`} style={{ width }}>
      <colgroup>
        {leaves.map((c) => (
          <col key={c.id} style={{ width: c.getSize() }} />
        ))}
      </colgroup>
      <thead>
        <tr className="band">
          {bandRow?.headers.map((h) => (
            <th key={h.id} colSpan={h.colSpan} className={h.column.id === 'identity' ? 'id' : undefined}>
              {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
            </th>
          ))}
        </tr>
        <tr className="head">
          {headRow?.headers.map((h) => (
            <th key={h.id} className={h.column.id === 'site' ? 'id' : undefined} scope="col">
              {headerLabel(String(h.column.columnDef.header ?? ''))}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.getRowModel().rows.map((r) => {
          const row = r.original;
          return (
            <tr key={r.id} className={row.kind}>
              {r.getVisibleCells().map((cell) => {
                const spec = cell.column.columnDef.meta?.spec;
                if (!spec) return null;
                if (spec.key === 'site') {
                  return (
                    <td key={cell.id} className="id">
                      <div className="id-cell">
                        <span className="id-name">{row.label}</span>
                        {row.code && <span className="id-code">{row.code}</span>}
                        {row.atCap && (
                          <span className="flag-cap" title="Closing headcount at contracted cap">
                            CAP
                          </span>
                        )}
                      </div>
                    </td>
                  );
                }
                const f = cellText(row, spec);
                const selectable = row.kind !== 'group';
                const isSel = selected?.rowId === row.id && selected.key === spec.key;
                const cls = [
                  f.tone,
                  row.inputs.has(spec.key) ? 'input' : selectable ? 'computed' : undefined,
                  isSel ? 'selected' : undefined,
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <td
                    key={cell.id}
                    className={cls || undefined}
                    onClick={selectable ? () => onSelect(isSel ? null : { rowId: row.id, key: spec.key }) : undefined}
                  >
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
