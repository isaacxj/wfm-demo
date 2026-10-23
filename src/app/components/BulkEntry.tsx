import { useEffect, useMemo, useState } from 'react';
import type { PlanInput } from '../../engine/index.ts';
import { BULK_LEVEL, type BulkMetric, type BulkOverride } from '../../scenario/scenario.ts';
import {
  allFilters,
  BULK_FILTERS,
  BULK_INPUT,
  BULK_TREE,
  bulkDrafts,
  bulkMetricLabel,
  bulkRows,
  editedValue,
  filterApplies,
  filterValues,
  invalidEdit,
  type BulkEdits,
  type BulkFilterKey,
  type BulkFilters,
  type BulkRow,
} from '../bulk.ts';
import { filterValueLabel } from '../model.ts';
import { Caret, Check, Close } from './icons.tsx';
import { Menu } from './Menu.tsx';

interface BulkEntryProps {
  /** The plan as the open scenario stands, or the baseline. */
  input: PlanInput;
  /** Week the current values are read at. */
  week: number;
  /** First week a change to volume or AHT applies from by default: the first planned week. */
  firstPlannedWeek: number;
  /** Open scenario, or null when applying forks one from the locked plan. */
  scenarioName: string | null;
  onApply: (drafts: Omit<BulkOverride, 'code'>[]) => void;
  onCancel: () => void;
}

const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const oneFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pad = (n: number) => String(n).padStart(2, '0');

function show(metric: BulkMetric, v: number | null): string {
  if (v === null) return '–';
  if (metric === 'volume' || metric === 'aht' || metric === 'cap') return intFmt.format(v);
  return oneFmt.format(v);
}

const UNIT_SUFFIX: Readonly<Record<BulkMetric, string>> = {
  volume: '',
  aht: 's',
  shrinkage: '%',
  occupancy: '%',
  workWeek: 'hrs',
  attrition: '%',
  cap: '',
};

export function BulkEntry({ input, week, firstPlannedWeek, scenarioName, onApply, onCancel }: BulkEntryProps) {
  const horizon = input.weeks.length;
  const [metric, setMetric] = useState<BulkMetric>('aht');
  const [filters, setFilters] = useState<BulkFilters>(() => allFilters(input));
  const [edits, setEdits] = useState<BulkEdits>({});
  const [weeks, setWeeks] = useState<Partial<Record<BulkMetric, [number, number]>>>({});
  const [bulkValue, setBulkValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const values = useMemo(() => filterValues(input), [input]);
  const rows = useMemo(() => bulkRows(input, metric, filters, week), [input, metric, filters, week]);
  const metricEdits = edits[metric] ?? {};
  const range = weeks[metric] ?? [firstPlannedWeek, horizon];
  const isUnit = BULK_LEVEL[metric] === 'unit';
  const spec = BULK_INPUT[metric];
  const editCount = Object.values(edits).reduce((s, e) => s + Object.keys(e ?? {}).length, 0);
  const metricCount = Object.values(edits).filter((e) => e && Object.keys(e).length > 0).length;

  // Escape cancels only while nothing has been typed, so a stray key never loses edits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && editCount === 0) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editCount, onCancel]);

  const setRow = (key: string, value: number | null) =>
    setEdits((all) => {
      const next = { ...(all[metric] ?? {}) };
      if (value === null) delete next[key];
      else next[key] = value;
      return { ...all, [metric]: next };
    });

  const applyToListed = () => {
    const n = Number(bulkValue.replace(/,/g, ''));
    const why = bulkValue.trim() === '' ? 'Enter a number.' : invalidEdit(metric, n);
    if (why) return setError(why);
    setError(null);
    setEdits((all) => ({ ...all, [metric]: { ...(all[metric] ?? {}), ...Object.fromEntries(rows.map((r) => [r.key, n])) } }));
  };

  const clearListed = () =>
    setEdits((all) => {
      const next = { ...(all[metric] ?? {}) };
      for (const r of rows) delete next[r.key];
      return { ...all, [metric]: next };
    });

  // A range left as shown is the default: the planned weeks, not the whole horizon.
  const apply = () => onApply(bulkDrafts(edits, weeks, [firstPlannedWeek, horizon]));

  return (
    <div className="bulk-backdrop" role="presentation">
      <div className="bulk" role="dialog" aria-modal="true" aria-label="Bulk entry">
        <div className="bulk-head">
          <span className="bulk-title">Bulk entry</span>
          <span className="bulk-target">{scenarioName ? `Edits ${scenarioName}` : 'Applying forks a scenario from the locked plan'}</span>
          <span className="tl-spacer" />
          <button className="panel-toggle" aria-label="Cancel bulk entry" title="Cancel" onClick={onCancel}>
            <Close />
          </button>
        </div>

        <div className="bulk-body">
          <nav className="bulk-tree" aria-label="Metric">
            {BULK_TREE.map((g) => (
              <div key={g.group}>
                <div className="menu-heading">{g.group}</div>
                {g.metrics.map((m) => {
                  const n = Object.keys(edits[m] ?? {}).length;
                  return (
                    <button
                      key={m}
                      className="bulk-metric"
                      aria-current={m === metric}
                      onClick={() => {
                        setMetric(m);
                        setBulkValue('');
                        setError(null);
                      }}
                    >
                      <span>{bulkMetricLabel(m)}</span>
                      <span className="bulk-level">{BULK_LEVEL[m] === 'unit' ? 'by unit' : BULK_LEVEL[m] === 'site' ? 'by site' : 'by staff type'}</span>
                      {n > 0 && <span className="tl-count">{n}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="bulk-main">
            <div className="toolbar bulk-filters" role="toolbar" aria-label="Bulk entry filters">
              {BULK_FILTERS.map((f) => (
                <FilterMenu
                  key={f.key}
                  label={f.label}
                  filterKey={f.key}
                  values={values[f.key]}
                  selected={filters[f.key]}
                  disabled={!filterApplies(metric, f.key)}
                  name={(v) => (f.key === 'site' ? (input.sites.find((s) => s.id === v)?.name ?? v) : f.key === 'outsourcer' ? v : filterValueLabel(f.key, v))}
                  onChange={(next) => setFilters({ ...filters, [f.key]: next })}
                />
              ))}
              <span className="tl-spacer" />
              {isUnit ? (
                <span className="bulk-weeks">
                  <span className="tl-key">Weeks</span>
                  <select value={range[0]} aria-label="From week" onChange={(e) => setWeeks({ ...weeks, [metric]: [Number(e.target.value), range[1]] })}>
                    {input.weeks.map((w) => (
                      <option key={w.index} value={w.index} disabled={w.index > range[1]}>
                        W{pad(w.index)}
                      </option>
                    ))}
                  </select>
                  <span>to</span>
                  <select value={range[1]} aria-label="To week" onChange={(e) => setWeeks({ ...weeks, [metric]: [range[0], Number(e.target.value)] })}>
                    {input.weeks.map((w) => (
                      <option key={w.index} value={w.index} disabled={w.index < range[0]}>
                        W{pad(w.index)}
                      </option>
                    ))}
                  </select>
                </span>
              ) : (
                <span className="tl-note">Applies to every week</span>
              )}
            </div>

            <div className="bulk-bar">
              <span>
                <span className="tl-num">{rows.length}</span> row{rows.length === 1 ? '' : 's'} listed
              </span>
              <span className="tl-key">{isUnit ? 'Change every listed row by' : 'Set every listed row to'}</span>
              <span className="ov-input">
                <input
                  value={bulkValue}
                  onChange={(e) => setBulkValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && applyToListed()}
                  inputMode="decimal"
                  aria-label={isUnit ? 'Change every listed row by' : 'Set every listed row to'}
                />
                <span className="ov-unit">{spec.unit}</span>
              </span>
              <button className="tl-button" onClick={applyToListed} disabled={rows.length === 0}>
                Fill
              </button>
              <button className="tl-button" onClick={clearListed} disabled={!rows.some((r) => metricEdits[r.key] !== undefined)}>
                Clear listed
              </button>
              {error && <span className="ov-error">{error}</span>}
            </div>

            <div className="bulk-scroll">
              {rows.length === 0 ? (
                <div className="grid-empty">No rows match the filters.</div>
              ) : (
                <table className="grid bulk-grid">
                  <colgroup>
                    <col style={{ width: isUnit ? 360 : 200 }} />
                    <col style={{ width: 170 }} />
                    <col style={{ width: 110 }} />
                    <col style={{ width: 130 }} />
                    <col style={{ width: 110 }} />
                  </colgroup>
                  <thead>
                    <tr className="head">
                      <th className="id">{isUnit ? 'Planning unit' : BULK_LEVEL[metric] === 'staffType' ? 'Staff type' : 'Site'}</th>
                      <th className="text">{isUnit || BULK_LEVEL[metric] === 'staffType' ? 'Site' : 'Outsourcer'}</th>
                      <th>{isUnit ? `Now, W${pad(week)}` : 'Now'}</th>
                      <th>
                        {spec.label} {spec.unit}
                      </th>
                      <th>{isUnit ? `New, W${pad(week)}` : 'New'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <EditRow key={r.key} row={r} metric={metric} edit={metricEdits[r.key]} onEdit={(v) => setRow(r.key, v)} />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        <div className="bulk-foot">
          <span>
            {editCount === 0 ? (
              'No edits yet.'
            ) : (
              <>
                <span className="tl-num">{editCount}</span> row{editCount === 1 ? '' : 's'} edited across <span className="tl-num">{metricCount}</span>{' '}
                metric{metricCount === 1 ? '' : 's'}. One recalculation when this closes.
              </>
            )}
          </span>
          <span className="tl-spacer" />
          <button className="tl-button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary-button" onClick={apply} disabled={editCount === 0}>
            Apply and recalculate
          </button>
        </div>
      </div>
    </div>
  );
}

function EditRow({ row, metric, edit, onEdit }: { row: BulkRow; metric: BulkMetric; edit: number | undefined; onEdit: (v: number | null) => void }) {
  const [text, setText] = useState(edit === undefined ? '' : String(edit));
  const [bad, setBad] = useState<string | null>(null);
  useEffect(() => setText(edit === undefined ? '' : String(edit)), [edit]);
  const commit = () => {
    if (text.trim() === '') {
      setBad(null);
      return onEdit(null);
    }
    const n = Number(text.replace(/,/g, ''));
    const why = invalidEdit(metric, n);
    setBad(why);
    if (!why) onEdit(n);
  };
  const next = edit === undefined ? null : editedValue(metric, row, edit);
  const isUnit = BULK_LEVEL[metric] === 'unit';
  return (
    <tr className={`site ${edit !== undefined ? 'edited' : ''}`}>
      <td className="id">
        <div className="id-cell">
          <span className="id-name">{row.label}</span>
          {row.unit && <span className="id-code">{row.unit.id}</span>}
        </div>
      </td>
      <td className="text">{isUnit || BULK_LEVEL[metric] === 'staffType' ? row.site.name : row.site.outsourcer}</td>
      <td className="muted">
        {show(metric, row.current)}
        {row.current !== null && UNIT_SUFFIX[metric] ? ` ${UNIT_SUFFIX[metric]}` : ''}
      </td>
      <td className={`bulk-input ${bad ? 'bad' : ''}`} title={bad ?? undefined}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          inputMode="decimal"
          aria-label={`${row.label} ${row.site.name}`}
        />
      </td>
      <td className={next === null ? 'muted' : undefined}>
        {next === null ? '–' : show(metric, next)}
        {next !== null && UNIT_SUFFIX[metric] ? ` ${UNIT_SUFFIX[metric]}` : ''}
      </td>
    </tr>
  );
}

function FilterMenu(props: {
  label: string;
  filterKey: BulkFilterKey;
  values: readonly string[];
  selected: readonly string[];
  disabled: boolean;
  name: (v: string) => string;
  onChange: (next: readonly string[]) => void;
}) {
  const { label, values, selected, disabled, name, onChange } = props;
  const all = selected.length === values.length;
  return (
    <div className="tl-seg">
      <Menu
        trigger={(p) => (
          <button className="tl-button" {...p} disabled={disabled} title={disabled ? `${label} does not narrow these rows` : undefined}>
            <span className="tl-key">{label}</span> {all ? 'All' : selected.length === 1 ? name(selected[0]!) : `${selected.length} of ${values.length}`} <Caret />
          </button>
        )}
      >
        {() => (
          <div className="menu-scroll">
            {values.map((v) => {
              const on = selected.includes(v);
              return (
                <button
                  key={v}
                  className="menu-item"
                  role="menuitemcheckbox"
                  aria-checked={on}
                  onClick={() => {
                    const next = values.filter((x) => (x === v ? !on : selected.includes(x)));
                    if (next.length > 0) onChange(next);
                  }}
                >
                  <span className={`check ${on ? 'on' : ''}`}>{on && <Check />}</span>
                  {name(v)}
                </button>
              );
            })}
            <div className="menu-foot">
              <button onClick={() => onChange(values)} disabled={all}>
                All
              </button>
            </div>
          </div>
        )}
      </Menu>
    </div>
  );
}
