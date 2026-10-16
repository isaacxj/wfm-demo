import { createColumnHelper, flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import { deltaOf, type CompareRow, type Side } from '../compare.ts';
import { formatDelta, formatValue } from '../format.ts';
import { columnSpec, GROUPINGS, type ColumnKey, type Grouping, type NumericKey } from '../model.ts';

export interface CompareRef {
  rowId: string;
  key: ColumnKey;
  side: Side;
}

interface CompareGridProps {
  rows: CompareRow[];
  metrics: readonly NumericKey[];
  grouping: Grouping;
  scenarioName: string;
  selected: CompareRef | null;
  onSelect: (ref: CompareRef | null) => void;
}

const WIDTHS: Readonly<Partial<Record<NumericKey, [number, number]>>> = {
  volume: [80, 74],
  aht: [54, 50],
  workload: [84, 74],
  shrink: [58, 54],
  required: [72, 64],
  rostered: [74, 66],
  opening: [64, 56],
  attrition: [60, 54],
  hires: [60, 54],
  closing: [64, 58],
  gap: [66, 62],
  hireNeed: [58, 54],
};

const helper = createColumnHelper<CompareRow>();
const SIDE_HEADER: Readonly<Record<Side, string>> = { base: 'Base', scen: 'Scen.', delta: 'Δ' };

export function CompareGrid({ rows, metrics, grouping, scenarioName, selected, onSelect }: CompareGridProps) {
  const bandLabel = GROUPINGS.find((g) => g.id === grouping)?.band ?? 'Site';

  const columns = useMemo<ColumnDef<CompareRow, unknown>[]>(
    () => [
      helper.group({
        id: 'identity',
        header: bandLabel,
        columns: [helper.display({ id: 'site', header: 'Site', size: 204, meta: {} })],
      }),
      ...metrics.map((m) => {
        const [w, dw] = WIDTHS[m] ?? [70, 62];
        return helper.group({
          id: `g:${m}`,
          header: columnSpec(m).header,
          columns: (['base', 'scen', 'delta'] as const).map((side) =>
            helper.display({
              id: `${m}:${side}`,
              header: SIDE_HEADER[side],
              size: side === 'delta' ? dw : w,
              meta: { metric: m, side },
            }),
          ),
        });
      }),
    ],
    [bandLabel, metrics],
  );

  const table = useReactTable({ data: rows, columns, getRowId: (r) => r.id, getCoreRowModel: getCoreRowModel() });
  const leaves = table.getVisibleLeafColumns();
  const width = leaves.reduce((s, c) => s + c.getSize(), 0);
  const [bandRow, headRow] = table.getHeaderGroups();

  return (
    <table className={`grid compare ${grouping === 'none' ? 'flat' : ''}`} style={{ width }} aria-label={`Baseline against ${scenarioName}`}>
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
            const meta = h.column.columnDef.meta;
            return (
              <th key={h.id} className={h.column.id === 'site' ? 'id' : meta?.side === 'delta' ? 'delta' : undefined} scope="col">
                {meta?.side === 'scen' ? <span title={scenarioName}>Scen.</span> : flexRender(h.column.columnDef.header, h.getContext())}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {table.getRowModel().rows.map((r) => {
          const row = r.original;
          return (
            <tr key={r.id} className={row.kind}>
              {r.getVisibleCells().map((cell) => {
                const meta = cell.column.columnDef.meta;
                if (!meta?.metric || !meta.side) {
                  return (
                    <td key={cell.id} className="id">
                      <div className="id-cell">
                        <span className="id-name">{row.base.label}</span>
                        {row.base.code && <span className="id-code">{row.base.code}</span>}
                        {row.scen.atCap && (
                          <span className="flag-cap" title="Scenario closing headcount at contracted cap">
                            CAP
                          </span>
                        )}
                      </div>
                    </td>
                  );
                }
                if (row.kind === 'group') return <td key={cell.id} />;
                const { metric, side } = meta;
                const spec = columnSpec(metric);
                const format = spec.format ?? 'one';
                const f =
                  side === 'delta'
                    ? formatDelta(deltaOf(row, metric), format, metric === 'gap')
                    : formatValue((side === 'base' ? row.base : row.scen).cells[metric], format);
                const isSel = selected?.rowId === row.id && selected.key === metric && selected.side === side;
                const cls = [
                  side,
                  f.tone,
                  side === 'scen' && row.scen.inputs.has(metric) ? 'input' : 'computed',
                  side === 'delta' && f.tone !== 'muted' && f.text !== '0' && f.text !== '0.0' ? 'moved' : undefined,
                  isSel ? 'selected' : undefined,
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <td key={cell.id} className={cls} onClick={() => onSelect(isSel ? null : { rowId: row.id, key: metric, side })}>
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
