import { useEffect, useMemo, useState } from 'react';
import type { TraceStep } from '../../engine/index.ts';
import { cellTrace, chainOf, membersOf } from '../cellTrace.ts';
import { copyText } from '../clipboard.ts';
import { formatStep } from '../format.ts';
import { columnSpec, type GridRow } from '../model.ts';
import type { CellRef } from './Grid.tsx';
import { cellText } from './Grid.tsx';
import { Caret, CollapseRight, ExpandLeft } from './icons.tsx';

interface InspectorProps {
  open: boolean;
  onToggle: () => void;
  rows: readonly GridRow[];
  selection: CellRef | null;
  weekLabel: string;
  /** Label for a week index, including weeks before the horizon. */
  labelOfWeek: (index: number) => string;
}

const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const oneFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function Inspector({ open, onToggle, rows, selection, weekLabel, labelOfWeek }: InspectorProps) {
  if (!open) {
    return (
      <aside className="inspector collapsed" aria-label="Inspector">
        <button className="insp-expand" onClick={onToggle} aria-label="Show inspector" title="Show inspector">
          <ExpandLeft />
        </button>
        <span className="insp-vertical">Inspector</span>
      </aside>
    );
  }
  const row = selection ? rows.find((r) => r.id === selection.rowId) : undefined;
  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="panel-head">
        <span>Inspector</span>
        <button className="panel-toggle" onClick={onToggle} aria-label="Hide inspector" title="Hide inspector">
          <CollapseRight />
        </button>
      </div>
      {selection && row ? (
        <CellDetail key={`${row.id}:${selection.key}:${weekLabel}`} rows={rows} row={row} selection={selection} weekLabel={weekLabel} labelOfWeek={labelOfWeek} />
      ) : (
        <div className="panel-body">
          <div className="panel-empty">
            Select a cell in the grid to see how it is calculated: every intermediate value, its formula and the assumption
            record that supplied each input.
          </div>
        </div>
      )}
    </aside>
  );
}

interface DetailProps {
  rows: readonly GridRow[];
  row: GridRow;
  selection: CellRef;
  weekLabel: string;
  labelOfWeek: (index: number) => string;
}

function CellDetail({ rows, row, selection, weekLabel, labelOfWeek }: DetailProps) {
  const spec = columnSpec(selection.key);
  const members = useMemo(() => membersOf(rows, row), [rows, row]);
  const trace = useMemo(() => cellTrace(row, selection.key, members), [row, selection.key, members]);
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');

  useEffect(() => {
    if (copied === 'idle') return;
    const id = window.setTimeout(() => setCopied('idle'), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);

  const focusStep = trace?.steps.find((s) => s.key === trace.focus);
  const steps = trace ? (full ? trace.steps : chainOf(trace.steps, trace.focus)) : [];
  const shown = cellText(row, spec);
  const isInput = row.inputs.has(spec.key);
  const notes = flagsFor(row, members, labelOfWeek);

  return (
    <>
      <div className="insp-context">
        <div className="insp-where">
          {row.label} · <span className="num">{weekLabel}</span>
        </div>
        <div className="insp-metric">
          <span>{spec.header}</span>
          <span className={`insp-value ${shown.tone ?? ''}`}>{shown.text}</span>
        </div>
        <div className="insp-tags">
          <span className="tag">{isInput ? 'Input' : row.kind === 'site' ? 'Computed' : 'Sum of sites'}</span>
          {row.slice?.allocated && <span className="tag">Allocated</span>}
        </div>
      </div>

      {notes.map((n, i) => (
        <div key={i} className={`insp-note ${n.tone}`}>
          <span className="note-tag">{n.tag}</span>
          <span>{n.text}</span>
        </div>
      ))}

      <div className="insp-section">
        <span>Calculation</span>
        {trace && (
          <span className="seg" role="group" aria-label="Trace scope">
            <button aria-pressed={!full} onClick={() => setFull(false)}>
              Chain
            </button>
            <button aria-pressed={full} onClick={() => setFull(true)}>
              Full row
            </button>
          </span>
        )}
      </div>

      <div className="panel-body">
        {trace ? (
          <StepList steps={steps} focus={trace.focus} depth={0} labelOfWeek={labelOfWeek} />
        ) : (
          <div className="panel-empty">
            {spec.key === 'occ'
              ? 'Occupancy ceiling is a site input. It does not add across sites.'
              : spec.key === 'classStart'
                ? 'Class start weeks are set per site. Select a site row.'
                : 'Nothing to calculate in this cell.'}
          </div>
        )}
      </div>

      {focusStep?.excel && (
        <div className="insp-foot">
          <button
            className="copy-button"
            onClick={async () => setCopied((await copyText(focusStep.excel!)) ? 'done' : 'failed')}
          >
            {copied === 'done' ? 'Copied to clipboard' : copied === 'failed' ? 'Copy failed' : 'Copy as Excel formula'}
          </button>
          <div className="foot-note">
            Reproduces <span className="num">{shown.text}</span> from literal
            inputs · <span className="num">{intFmt.format(focusStep.excel.length)}</span> characters
            {focusStep.unit === 'week' ? ' · returns the week index' : ''}
          </div>
        </div>
      )}
    </>
  );
}

interface StepListProps {
  steps: readonly TraceStep[];
  focus: string;
  depth: number;
  labelOfWeek: (index: number) => string;
}

function StepList({ steps, focus, depth, labelOfWeek }: StepListProps) {
  return (
    <ol className={`steps depth-${Math.min(depth, 3)}`}>
      {steps.map((s) => (
        <StepItem key={s.key} step={s} isFocus={s.key === focus} depth={depth} labelOfWeek={labelOfWeek} />
      ))}
    </ol>
  );
}

function StepItem({ step, isFocus, depth, labelOfWeek }: { step: TraceStep; isFocus: boolean; depth: number; labelOfWeek: (i: number) => string }) {
  const [open, setOpen] = useState(false);
  const v = formatStep(step.value, step.unit, labelOfWeek);
  const isInput = step.formula === undefined;
  const parts = step.parts ?? [];
  return (
    <li className={`step ${isInput ? 'input' : ''} ${isFocus ? 'focus' : ''}`}>
      <div className="step-line">
        <span className="step-label">{step.label}</span>
        <span className="step-value">
          {v.text}
          {v.unit && <span className="step-unit">{v.unit}</span>}
        </span>
      </div>
      {(step.formula || step.assumption) && (
        <div className="step-sub">
          <span className="step-formula">{step.formula ?? 'input'}</span>
          {step.assumption && <span className="step-code">{step.assumption}</span>}
        </div>
      )}
      {parts.length > 0 && (
        <>
          <button className="parts-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <span className={`caret ${open ? 'open' : ''}`}>
              <Caret />
            </span>
            {parts.length === 1 ? `From ${parts[0]!.label}` : `${parts.length} ${parts[0]!.id.startsWith('site:') ? 'sites' : 'planning units'}`}
          </button>
          {open &&
            (parts.length === 1 ? (
              <div className="parts">
                <StepList steps={chainOf(parts[0]!.steps, parts[0]!.focus)} focus={parts[0]!.focus} depth={depth + 1} labelOfWeek={labelOfWeek} />
              </div>
            ) : (
              <PartList parts={parts} depth={depth + 1} labelOfWeek={labelOfWeek} />
            ))}
        </>
      )}
    </li>
  );
}

function PartList({ parts, depth, labelOfWeek }: { parts: NonNullable<TraceStep['parts']>; depth: number; labelOfWeek: (i: number) => string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <ul className="parts">
      {parts.map((p) => {
        const f = p.steps.find((s) => s.key === p.focus);
        const v = f ? formatStep(f.value, f.unit, labelOfWeek) : null;
        const isOpen = openId === p.id;
        return (
          <li key={p.id}>
            <button className="part-line" aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? null : p.id)}>
              <span className={`caret ${isOpen ? 'open' : ''}`}>
                <Caret />
              </span>
              <span className="part-label">{p.label}</span>
              {v && <span className="part-value">{v.text}</span>}
            </button>
            {isOpen && <StepList steps={chainOf(p.steps, p.focus)} focus={p.focus} depth={depth} labelOfWeek={labelOfWeek} />}
          </li>
        );
      })}
    </ul>
  );
}

interface Note {
  tag: string;
  text: string;
  tone: 'warn' | 'info';
}

function flagsFor(row: GridRow, members: readonly GridRow[], labelOfWeek: (i: number) => string): Note[] {
  const notes: Note[] = [];
  const sites = row.kind === 'site' ? [row] : members;
  for (const m of sites) {
    const s = m.slice;
    if (!s) continue;
    const cap = s.siteTrace.find((x) => x.key === 'flow.cap')?.value;
    const name = row.kind === 'site' ? '' : `${m.label}: `;
    const lead = (text: string) => (name ? `${name}${text}` : text.charAt(0).toUpperCase() + text.slice(1));
    if (s.capShortfall > 0.05 && cap !== undefined) {
      notes.push({
        tag: 'CAP',
        tone: 'warn',
        text: lead(
          s.allocated
            ? `requirement exceeds the contracted cap of ${intFmt.format(cap)}. This slice's share of the shortfall is ${oneFmt.format(s.capShortfall)} FTE.`
            : `requirement exceeds the contracted cap of ${intFmt.format(cap)}. ${oneFmt.format(s.capShortfall)} FTE cannot be hired at this site.`,
        ),
      });
    } else if (row.kind === 'site' && s.atCap && cap !== undefined) {
      notes.push({ tag: 'CAP', tone: 'warn', text: `Closing headcount held at the contracted cap of ${intFmt.format(cap)}.` });
    }
    if (s.leadTimeShortfall > 0.05) {
      const weeks = s.siteTrace.find((x) => x.key === 'flow.leadWeeks')?.value ?? 6;
      notes.push({
        tag: 'LEAD',
        tone: 'warn',
        text: lead(`${oneFmt.format(s.leadTimeShortfall)} FTE short. No new class can land before ${labelOfWeek(1 + weeks)}.`),
      });
    }
  }
  if (row.kind === 'site' && row.slice?.allocated) {
    notes.push({
      tag: 'SPLIT',
      tone: 'info',
      text: `Supply allocated by this slice's ${oneFmt.format(row.slice.share * 100)}% share of site rostered FTE.`,
    });
  }
  return notes;
}
