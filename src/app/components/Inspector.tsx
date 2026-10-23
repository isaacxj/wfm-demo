import { useEffect, useState } from 'react';
import { REQUIRED_FTE_NOTE, type TraceStep } from '../../engine/index.ts';
import { cellTrace, chainOf, membersOf, type CellTrace } from '../cellTrace.ts';
import { copyText } from '../clipboard.ts';
import { differenceTrace } from '../compare.ts';
import { formatDelta, formatStep, type Formatted } from '../format.ts';
import { columnSpec, type ColumnKey, type GridRow, type NumericKey } from '../model.ts';
import { varianceOf, varianceTone, type PeriodModel } from '../periods.ts';
import type { CellRef } from './Grid.tsx';
import { cellText } from './Grid.tsx';
import { Caret, CollapseRight, ExpandLeft } from './icons.tsx';

/** A resolved cell for the inspector: its row, its trace and what the grid shows. */
export interface InspectorTarget {
  /** Changes when the selection changes, resetting panel state. */
  id: string;
  row: GridRow;
  members: readonly GridRow[];
  key: ColumnKey;
  trace: CellTrace | null;
  shown: Formatted;
  /** Which side of a comparison, e.g. "Baseline", "Scenario 1", "Change". */
  side?: string;
  isInput: boolean;
  /** Week the cell belongs to, when it is not the grid's selected week. */
  weekLabel?: string;
  /** Notes the grid knows and the row does not, such as drift from plan. */
  extraNotes?: Note[];
}

/** Target for a cell of a single-plan grid. */
export function planTarget(rows: readonly GridRow[], ref: CellRef | null, side?: string): InspectorTarget | null {
  const row = ref ? rows.find((r) => r.id === ref.rowId) : undefined;
  if (!ref || !row) return null;
  const members = membersOf(rows, row);
  return {
    id: `${row.id}:${ref.key}:${side ?? ''}`,
    row,
    members,
    key: ref.key,
    trace: cellTrace(row, ref.key, members),
    shown: cellText(row, columnSpec(ref.key)),
    side,
    isInput: row.inputs.has(ref.key),
  };
}

/**
 * Target for a cell of the Periods grid: the row as that week shows it (actual,
 * plan or scenario), or its variance against the locked plan.
 */
export function periodTarget(
  model: PeriodModel,
  ref: CellRef,
  week: number,
  names: { scenario: string | null; weekLabel: string },
  variancePrefix: string,
): InspectorTarget | null {
  const i = week - 1;
  const band = model.bands[i];
  const isVariance = ref.rowId.startsWith(variancePrefix);
  const rowId = isVariance ? ref.rowId.slice(variancePrefix.length) : ref.rowId;
  const prow = model.rows.find((r) => r.id === rowId);
  const shownRows = model.rowsByWeek[i];
  const planRows = model.planByWeek[i];
  if (!band || !prow || !shownRows || !planRows || ref.key === 'site' || ref.key === 'classStart') return null;
  const sideName = band === 'actual' ? 'Actual' : band === 'scenario' ? (names.scenario ?? 'Scenario') : undefined;
  const extraNotes: Note[] = [];
  if (prow.drift) {
    const d = prow.drift;
    extraNotes.push({
      tag: 'DRIFT',
      tone: 'warn',
      text: `${prow.label} has run ${oneFmt.format(Math.abs(d.overUnder))} FTE ${d.share < 0 ? 'further under' : 'further over'} than plan a week, ${weekShort(d.fromWeek)}–${weekShort(d.toWeek)}: ${oneFmt.format(Math.abs(d.share) * 100)}% of required FTE.`,
    });
  }
  if (band === 'actual') {
    extraNotes.push({
      tag: 'ACTUAL',
      tone: 'info',
      text: 'Elapsed week. Volume, AHT and headcount are observed; Required FTE is what the observed volume and AHT imply at the plan’s occupancy and shrinkage.',
    });
  }
  if (!isVariance) {
    const t = planTarget(shownRows, { rowId, key: ref.key }, sideName);
    return t ? { ...t, id: `${t.id}:${band}`, weekLabel: names.weekLabel, extraNotes } : null;
  }
  if (band === 'plan') return null;
  const key = ref.key as NumericKey;
  const spec = columnSpec(key);
  const shownRow = prow.byWeek[i]!;
  const planRow = prow.planByWeek[i]!;
  const value = varianceOf(model, prow, i, key);
  const base = planTarget(shownRows, { rowId, key }, 'Variance');
  if (!base || value === null) return null;
  const f = formatDelta(value, spec.format ?? 'one', false);
  return {
    ...base,
    id: `${ref.rowId}:${key}:${band}`,
    trace: differenceTrace(
      { row: planRow, rows: planRows, label: 'Plan' },
      { row: shownRow, rows: shownRows, label: sideName ?? 'Shown' },
      key,
      { label: `${spec.header} variance`, formula: band === 'actual' ? 'actual − plan' : 'scenario − plan' },
    ),
    shown: { text: f.text, tone: varianceTone(key, value) ?? f.tone },
    isInput: false,
    weekLabel: names.weekLabel,
    extraNotes,
  };
}

const weekShort = (week: number) => `W${String(week).padStart(2, '0')}`;

interface InspectorProps {
  open: boolean;
  onToggle: () => void;
  target: InspectorTarget | null;
  weekLabel: string;
  /** Label for a week index, including weeks before the horizon. */
  labelOfWeek: (index: number) => string;
}

const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const oneFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function Inspector({ open, onToggle, target, weekLabel, labelOfWeek }: InspectorProps) {
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
  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="panel-head">
        <span>Inspector</span>
        <button className="panel-toggle" onClick={onToggle} aria-label="Hide inspector" title="Hide inspector">
          <CollapseRight />
        </button>
      </div>
      {target ? (
        <CellDetail
          key={`${target.id}:${target.weekLabel ?? weekLabel}`}
          target={target}
          weekLabel={target.weekLabel ?? weekLabel}
          labelOfWeek={labelOfWeek}
        />
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
  target: InspectorTarget;
  weekLabel: string;
  labelOfWeek: (index: number) => string;
}

function CellDetail({ target, weekLabel, labelOfWeek }: DetailProps) {
  const { row, members, trace, shown, isInput, side } = target;
  const spec = columnSpec(target.key);
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');

  useEffect(() => {
    if (copied === 'idle') return;
    const id = window.setTimeout(() => setCopied('idle'), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);

  const focusStep = trace?.steps.find((s) => s.key === trace.focus);
  const steps = trace ? (full ? trace.steps : chainOf(trace.steps, trace.focus)) : [];
  const notes = [...(target.extraNotes ?? []), ...flagsFor(row, members, labelOfWeek)];

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
        {spec.key === 'required' && <div className="insp-convention">{REQUIRED_FTE_NOTE}</div>}
        <div className="insp-tags">
          {side && <span className="tag side">{side}</span>}
          <span className="tag">
            {isInput
              ? 'Input'
              : row.kind !== 'site'
                ? 'Sum of sites'
                : row.actual && side !== 'Variance' && (target.key === 'volume' || target.key === 'aht' || target.key === 'planned')
                  ? 'Observed'
                  : 'Computed'}
          </span>
          {(row.slice?.allocated || row.actual?.allocated) && <span className="tag">Allocated</span>}
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
            Reproduces <span className="num">{formatStep(focusStep.value, focusStep.unit, labelOfWeek).text}</span> from literal
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
      {step.note && <div className="step-note">{step.note}</div>}
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

export interface Note {
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
  if (row.kind === 'site' && row.actual?.allocated) {
    notes.push({
      tag: 'SPLIT',
      tone: 'info',
      text: `Actual headcount allocated by this slice's ${oneFmt.format(row.actual.share * 100)}% share of site required FTE.`,
    });
  }
  if (row.kind === 'site' && row.slice?.allocated) {
    notes.push({
      tag: 'SPLIT',
      tone: 'info',
      text: `Supply allocated by this slice's ${oneFmt.format(row.slice.share * 100)}% share of site required FTE.`,
    });
  }
  return notes;
}
