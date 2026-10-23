import { useState } from 'react';
import type { SiteInput } from '../../engine/index.ts';
import type { HorizonSummary } from '../compare.ts';
import {
  describeChange,
  describeScope,
  describeWhen,
  OVERRIDE_LABEL,
  type Override,
  type OverrideKind,
  type Scenario,
  type Scope,
} from '../../scenario/scenario.ts';
import { PLAN } from '../plan.ts';
import { Close } from './icons.tsx';
import { Menu } from './Menu.tsx';

/** An override as the form produces it; the scenario assigns its code. */
export type DraftOverride = Override extends infer O ? (O extends Override ? Omit<O, 'code'> : never) : never;

interface ScenarioBarProps {
  scenario: Scenario;
  sites: readonly SiteInput[];
  outsourcers: readonly string[];
  horizon: number;
  summary: HorizonSummary;
  calcMs: number;
  onAdd: (o: DraftOverride) => void;
  onRemove: (code: string) => void;
  onDiscard: () => void;
  /** While recalculation is paused: overrides added and removed since the last calculation. */
  staged?: { added: ReadonlySet<string>; removed: readonly Scenario['overrides'][number][] };
}

const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const one = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const MINUS = '−';

export function ScenarioBar(props: ScenarioBarProps) {
  const { scenario, sites, horizon, summary, calcMs, onRemove, onDiscard } = props;
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? id;
  return (
    <>
      <div className="scenario-bar">
        <div className="sc-title">
          <span className="sc-name">{scenario.name}</span>
          <span className="tag">Draft</span>
          <span className="sc-fork">
            forked from {PLAN.name} {PLAN.version}
          </span>
        </div>
        <div className="sc-overrides" aria-label="Overrides">
          {scenario.overrides.length === 0 && <span className="sc-empty">No overrides. The scenario matches the baseline.</span>}
          {scenario.overrides.map((o) => (
            <span key={o.code} className={`chip override ${props.staged?.added.has(o.code) ? 'staged' : ''}`} title={o.code}>
              <span className="chip-key">{OVERRIDE_LABEL[o.kind]}</span>
              <span className="num">{describeChange(o)}</span>
              <span className="chip-key">
                {describeScope(o.scope, siteName)} · {describeWhen(o, horizon)}
              </span>
              <span className="sc-code">{o.code}</span>
              {props.staged?.added.has(o.code) && <span className="staged-tag">STAGED</span>}
              <button aria-label={`Remove override ${o.code}`} onClick={() => onRemove(o.code)}>
                <Close />
              </button>
            </span>
          ))}
          {props.staged?.removed.map((o) => (
            <span key={o.code} className="chip override staged removed" title={`${o.code}: removal staged`}>
              <span className="chip-key">{OVERRIDE_LABEL[o.kind]}</span>
              <span className="num">{describeChange(o)}</span>
              <span className="sc-code">{o.code}</span>
              <span className="staged-tag">REMOVAL STAGED</span>
            </span>
          ))}
          <Menu
            trigger={(p) => (
              <button className="tl-button sc-add" {...p}>
                + Add override
              </button>
            )}
          >
            {(close) => <OverrideForm {...props} onDone={close} />}
          </Menu>
        </div>
        <button className="tl-button sc-discard" onClick={onDiscard}>
          Discard scenario
        </button>
      </div>
      <div className="summary-strip" aria-label="Horizon summary">
        <span className="ss-label">Horizon {horizon} wks</span>
        <SummaryItem label="Avg required FTE" pair={summary.avgRequired} decimals={1} />
        <SummaryItem label="Hires to start" pair={summary.starters} decimals={0} badIfUp />
        <SummaryItem label="Site-weeks over cap" pair={summary.capShortfallWeeks} decimals={0} badIfUp />
        <SummaryItem label="Lead-time shortfall FTE" pair={summary.leadShortfallFte} decimals={1} badIfUp />
        <span className="ss-spacer" />
        <span className="ss-calc">
          Scenario calculated in <span className="num">{calcMs.toFixed(0)}</span> ms
        </span>
      </div>
    </>
  );
}

function SummaryItem({ label, pair, decimals, badIfUp }: { label: string; pair: [number, number]; decimals: 0 | 1; badIfUp?: boolean }) {
  const fmt = decimals === 0 ? int : one;
  const d = pair[1] - pair[0];
  const zero = Math.abs(d) < (decimals === 0 ? 0.5 : 0.05);
  const tone = zero || !badIfUp ? '' : d > 0 ? 'neg' : 'pos';
  return (
    <span className="ss-item">
      <span className="ss-key">{label}</span>
      <span className="num">{fmt.format(pair[0])}</span>
      <span className="ss-arrow">→</span>
      <span className="num">{fmt.format(pair[1])}</span>
      <span className={`num ss-delta ${zero ? 'muted' : tone}`}>
        {zero ? (decimals === 0 ? '0' : '0.0') : `${d > 0 ? '+' : MINUS}${fmt.format(Math.abs(d))}`}
      </span>
    </span>
  );
}

// Override form ---------------------------------------------------------------

const KINDS: readonly OverrideKind[] = ['volume', 'aht', 'shrinkage', 'attrition', 'cap'];

function OverrideForm({ sites, outsourcers, horizon, onAdd, onDone }: ScenarioBarProps & { onDone: () => void }) {
  const [kind, setKind] = useState<OverrideKind>('volume');
  const [scopeKey, setScopeKey] = useState('all');
  const [volumeMode, setVolumeMode] = useState<'add' | 'pct'>('add');
  const [value, setValue] = useState('10000');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(horizon);
  const [error, setError] = useState<string | null>(null);

  const siteOnly = kind === 'cap';
  const scopeOf = (key: string): Scope =>
    key === 'all' ? { type: 'all' } : key.startsWith('v:') ? { type: 'outsourcer', outsourcer: key.slice(2) } : { type: 'site', siteId: key.slice(2) };

  const choose = (k: OverrideKind) => {
    setKind(k);
    setError(null);
    const firstSite = sites[0]!;
    const site = scopeKey.startsWith('s:') ? (sites.find((s) => `s:${s.id}` === scopeKey) ?? firstSite) : firstSite;
    if (k === 'volume') setValue(volumeMode === 'add' ? '10000' : '5');
    if (k === 'aht') setValue('5');
    if (k === 'shrinkage') setValue(one.format(site.shrinkage * 100));
    if (k === 'attrition') setValue(one.format(site.monthlyAttrition * 100));
    if (k === 'cap') {
      const capSite = sites.find((s) => s.cap !== null) ?? firstSite;
      setScopeKey(`s:${capSite.id}`);
      setValue(String(Math.round((capSite.cap ?? capSite.openingHeadcount) * 0.92)));
    }
  };

  const unitText =
    kind === 'volume' ? (volumeMode === 'add' ? 'contacts / week' : '% change') : kind === 'aht' ? '% change' : kind === 'cap' ? 'heads' : '%';
  const label =
    kind === 'shrinkage' ? 'Set shrinkage to' : kind === 'attrition' ? 'Set monthly attrition to' : kind === 'cap' ? 'Set cap to' : 'Change by';

  const submit = () => {
    const n = Number(value.replace(/,/g, ''));
    if (value.trim() === '' || !Number.isFinite(n)) return setError('Enter a number.');
    const scope = scopeOf(scopeKey);
    if (siteOnly && scope.type !== 'site') return setError('A cap applies to one site.');
    if (from > to) return setError('The first week must not follow the last.');
    let draft: DraftOverride;
    switch (kind) {
      case 'volume':
        if (volumeMode === 'pct' && n <= -100) return setError('Volume cannot fall by 100% or more.');
        draft = { kind, scope, mode: volumeMode, value: volumeMode === 'add' ? Math.round(n) : n / 100, fromWeek: from, toWeek: to };
        break;
      case 'aht':
        if (n <= -100) return setError('AHT cannot fall by 100% or more.');
        draft = { kind, scope, pct: n / 100, fromWeek: from, toWeek: to };
        break;
      case 'shrinkage':
        if (n < 0 || n >= 95) return setError('Shrinkage must be between 0% and 95%.');
        draft = { kind, scope, value: n / 100 };
        break;
      case 'attrition':
        if (n < 0 || n >= 50) return setError('Monthly attrition must be between 0% and 50%.');
        draft = { kind, scope, value: n / 100 };
        break;
      case 'cap':
        if (n < 0) return setError('A cap cannot be negative.');
        draft = { kind, scope: scope as { type: 'site'; siteId: string }, value: Math.round(n) };
        break;
    }
    onAdd(draft);
    onDone();
  };

  const weekOptions = Array.from({ length: horizon }, (_, i) => i + 1);
  return (
    <form
      className="ov-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="menu-heading">Override</div>
      <div className="ov-kinds" role="radiogroup" aria-label="Variable">
        {KINDS.map((k) => (
          <button type="button" key={k} role="radio" aria-checked={kind === k} onClick={() => choose(k)}>
            {OVERRIDE_LABEL[k]}
          </button>
        ))}
      </div>

      <label className="ov-field">
        <span>Applies to</span>
        <select value={scopeKey} onChange={(e) => setScopeKey(e.target.value)}>
          {!siteOnly && <option value="all">All sites</option>}
          {!siteOnly && (
            <optgroup label="Outsourcer">
              {outsourcers.map((v) => (
                <option key={v} value={`v:${v}`}>
                  {v}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Site">
            {sites.map((s) => (
              <option key={s.id} value={`s:${s.id}`}>
                {s.name} ({s.id}){s.cap !== null ? ` · cap ${int.format(s.cap)}` : ''}
              </option>
            ))}
          </optgroup>
        </select>
      </label>

      {kind === 'volume' && (
        <div className="ov-field">
          <span>Change as</span>
          <span className="ov-seg">
            {(['add', 'pct'] as const).map((m) => (
              <button
                type="button"
                key={m}
                aria-pressed={volumeMode === m}
                onClick={() => {
                  setVolumeMode(m);
                  setValue(m === 'add' ? '10000' : '5');
                }}
              >
                {m === 'add' ? 'Contacts / week' : 'Percent'}
              </button>
            ))}
          </span>
        </div>
      )}

      <label className="ov-field">
        <span>{label}</span>
        <span className="ov-input">
          <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" aria-label={label} autoFocus />
          <span className="ov-unit">{unitText}</span>
        </span>
      </label>

      {(kind === 'volume' || kind === 'aht') && (
        <div className="ov-field">
          <span>Weeks</span>
          <span className="ov-weeks">
            <select value={from} onChange={(e) => setFrom(Number(e.target.value))} aria-label="From week">
              {weekOptions.map((w) => (
                <option key={w} value={w}>
                  W{String(w).padStart(2, '0')}
                </option>
              ))}
            </select>
            <span>to</span>
            <select value={to} onChange={(e) => setTo(Number(e.target.value))} aria-label="To week">
              {weekOptions.map((w) => (
                <option key={w} value={w}>
                  W{String(w).padStart(2, '0')}
                </option>
              ))}
            </select>
          </span>
        </div>
      )}
      {(kind === 'shrinkage' || kind === 'attrition' || kind === 'cap') && <div className="ov-hint">Applies to every week of the plan.</div>}
      {kind === 'volume' && volumeMode === 'add' && (
        <div className="ov-hint">Split across the planning units in scope by their share of each week's volume.</div>
      )}

      {error && <div className="ov-error">{error}</div>}
      <div className="menu-foot">
        <button type="button" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="primary">
          Apply
        </button>
      </div>
    </form>
  );
}
