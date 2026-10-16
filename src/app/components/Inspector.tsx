import { COLUMNS, type GridRow } from '../model.ts';
import type { CellRef } from './Grid.tsx';
import { cellText } from './Grid.tsx';

interface InspectorProps {
  selection: CellRef | null;
  row: GridRow | undefined;
  weekLabel: string;
}

export function Inspector({ selection, row, weekLabel }: InspectorProps) {
  const spec = selection ? COLUMNS.find((c) => c.key === selection.key) : undefined;
  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="panel-head">Inspector</div>
      <div className="panel-body">
        {selection && row && spec ? (
          <table className="kv">
            <tbody>
              <tr>
                <th scope="row">Row</th>
                <td>{row.label}</td>
              </tr>
              <tr>
                <th scope="row">Metric</th>
                <td>{spec.header}</td>
              </tr>
              <tr>
                <th scope="row">Week</th>
                <td className="num">{weekLabel}</td>
              </tr>
              <tr>
                <th scope="row">Cell type</th>
                <td>{row.inputs.has(spec.key) ? 'Input' : 'Computed'}</td>
              </tr>
              <tr className="result">
                <th scope="row">Value</th>
                <td className="num">{cellText(row, spec).text}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <div className="panel-empty">Select a cell to see its calculation.</div>
        )}
      </div>
    </aside>
  );
}
