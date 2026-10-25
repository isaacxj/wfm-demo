import { useRef, useState } from 'react';
import type { SiteInput } from '../../engine/index.ts';
import type { Budget } from '../../data/budget.ts';
import { BUDGET_LINES, type BudgetEdits, type BudgetLine, type BudgetMonth, type BudgetRow } from '../budget.ts';
import { formatDelta, formatValue } from '../format.ts';
import { PLAN } from '../plan.ts';

interface BudgetViewProps {
  budget: Budget;
  rows: readonly BudgetRow[];
  months: readonly BudgetMonth[];
  edits: BudgetEdits;
  scenarioName: string | null;
  sites: readonly SiteInput[];
  onEdit: (key: string, value: number | null) => void;
  onImport: (text: string) => { rows: number; errors: string[] };
  onDownload: () => void;
  onReset: () => void;
}

/** Variance lines: over budget costs money, so it reads red. */
const VARIANCE: ReadonlySet<BudgetLine> = new Set(['plannedVar', 'actualVar']);
const SHOWN: readonly BudgetLine[] = ['budget', 'required', 'planned', 'actual', 'plannedVar', 'actualVar'];

export function BudgetView(props: BudgetViewProps) {
  const { budget, rows, months, edits, scenarioName, onEdit, onImport, onDownload, onReset } = props;
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; errors: string[] } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const total = rows.find((r) => r.kind === 'total');
  const fy = months.length;
  const editCount = Object.keys(edits).length;

  const importFile = async (f: File) => {
    const result = onImport(await f.text());
    setMessage({ text: `${result.rows} budget line${result.rows === 1 ? '' : 's'} imported from ${f.name}.`, errors: result.errors });
  };

  const cell = (row: BudgetRow, line: BudgetLine, j: number) => {
    const v = row.lines[line][j] ?? null;
    const month = months[j];
    const key = row.code && month ? `${row.code}:${month.key}` : null;
    const editable = line === 'budget' && row.kind === 'site' && key !== null;
    if (editable && editing === key) {
      return (
        <td key={j} className="bulk-input">
          <input
            autoFocus
            onFocus={(e) => e.target.select()}
            defaultValue={v === null ? '' : String(Math.round(v))}
            inputMode="decimal"
            aria-label={`${row.label} budget ${month!.label}`}
            onBlur={(e) => {
              const n = Number(e.target.value.replace(/,/g, ''));
              if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= 0) onEdit(key!, n);
              setEditing(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditing(null);
            }}
          />
        </td>
      );
    }
    const f = VARIANCE.has(line) ? formatDelta(v, 'one', false) : formatValue(v, 'one');
    const tone = VARIANCE.has(line) && v !== null && Math.abs(v) >= 0.05 ? (v > 0 ? 'neg' : 'pos') : f.tone;
    const partial = line === 'actual' || line === 'actualVar' ? month && month.elapsed > 0 && month.elapsed < month.weeks.length : false;
    const cls = [tone, editable ? 'input editable' : undefined, key && edits[key] !== undefined && line === 'budget' ? 'edited' : undefined, j === fy ? 'fy' : undefined]
      .filter(Boolean)
      .join(' ');
    return (
      <td
        key={j}
        className={cls || undefined}
        onClick={editable ? () => setEditing(key) : undefined}
        title={partial ? `${month!.elapsed} of ${month!.weeks.length} weeks elapsed` : editable ? 'Click to change the budget for this month' : undefined}
      >
        {f.text}
        {partial && v !== null ? <sup>*</sup> : null}
      </td>
    );
  };

  return (
    <>
      <div className="scenario-bar">
        <div className="sc-title">
          <span className="sc-name">Budget</span>
          <span className="tag">{budget.code}</span>
          <span className="sc-fork">
            {budget.name} against {PLAN.name} {PLAN.version} · {scenarioName ?? PLAN.scenario}
          </span>
        </div>
        <div className="sc-overrides">
          <span className="sc-empty">FTE a week, averaged by month. Click a budget figure to change it, or import lines from a CSV.</span>
        </div>
        <span className="budget-actions">
          <input
            ref={file}
            type="file"
            accept=".csv,.txt,text/csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = '';
            }}
          />
          <button className="tl-button" onClick={() => file.current?.click()}>
            Import CSV
          </button>
          <button className="tl-button" onClick={onDownload}>
            Download CSV
          </button>
          <button className="tl-button" onClick={onReset} disabled={editCount === 0}>
            Reset{editCount > 0 ? ` · ${editCount}` : ''}
          </button>
        </span>
      </div>
      {total && (
        <div className="summary-strip" aria-label="Budget summary">
          <span className="ss-label">FY27 average</span>
          <Stat label="Budget FTE" value={formatValue(total.lines.budget[fy] ?? null, 'one').text} />
          <Stat label="Planned FTE" value={formatValue(total.lines.planned[fy] ?? null, 'one').text} />
          <Stat label="Planned − budget" value={formatDelta(total.lines.plannedVar[fy] ?? null, 'one', false).text} tone={(total.lines.plannedVar[fy] ?? 0) > 0 ? 'neg' : 'pos'} />
          <Stat label="Actual − budget, to date" value={formatDelta(total.lines.actualVar[fy] ?? null, 'one', false).text} tone={(total.lines.actualVar[fy] ?? 0) > 0 ? 'neg' : 'pos'} />
          {editCount > 0 && <Stat label="Budget lines changed" value={String(editCount)} />}
        </div>
      )}
      {message && (
        <div className={`budget-message ${message.errors.length ? 'warn' : ''}`}>
          {message.text}
          {message.errors.length > 0 && (
            <>
              {' '}
              {message.errors.length} line{message.errors.length === 1 ? '' : 's'} skipped: {message.errors.slice(0, 3).join(' ')}
              {message.errors.length > 3 ? ' …' : ''}
            </>
          )}
          <button className="link-button" onClick={() => setMessage(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="grid-scroll">
        <table className="grid budget" style={{ width: 230 + months.length * 76 + 86 }}>
          <colgroup>
            <col style={{ width: 230 }} />
            {months.map((m) => (
              <col key={m.key} style={{ width: 76 }} />
            ))}
            <col style={{ width: 86 }} />
          </colgroup>
          <thead>
            <tr className="head">
              <th className="id">Site / line</th>
              {months.map((m) => (
                <th key={m.key} className={m.elapsed === m.weeks.length ? 'elapsed' : m.elapsed > 0 ? 'part' : undefined}>
                  {m.label.slice(0, 3)}
                </th>
              ))}
              <th className="fy">FY27</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) =>
              row.kind === 'group' ? (
                <tr key={row.id} className="group">
                  <td className="id" colSpan={months.length + 2}>
                    {row.label}
                  </td>
                </tr>
              ) : (
                SHOWN.map((line, li) => (
                  <tr key={`${row.id}:${line}`} className={`${row.kind} line-${line} ${li === 0 ? 'first' : ''}`}>
                    <td className="id">
                      <div className="id-cell">
                        {li === 0 ? (
                          <>
                            <span className="id-name">{row.label}</span>
                            {row.code && <span className="id-code">{row.code}</span>}
                          </>
                        ) : null}
                        <span className="budget-line">{BUDGET_LINES.find((l) => l.key === line)!.label}</span>
                      </div>
                    </td>
                    {row.lines[line].map((_, j) => cell(row, line, j))}
                  </tr>
                ))
              ),
            )}
          </tbody>
        </table>
        <p className="events-foot">
          Each figure is FTE a week, averaged over the month by the ISO rule (a week belongs to the month its Thursday is in). Actuals
          average the elapsed weeks only; <sup>*</sup> marks a month part-way elapsed. Variances are positive when over budget. Required FTE
          includes shrinkage.
        </p>
      </div>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <span className="ss-item">
      <span className="ss-key">{label}</span>
      <span className={`num ${tone ?? ''}`}>{value}</span>
    </span>
  );
}
