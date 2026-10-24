import { useState } from 'react';
import type { EventScope, EventType, PlanEvent, SiteInput } from '../../engine/index.ts';
import { describeEffect, describeEventScope } from '../../scenario/scenario.ts';
import { EVENT_TYPE_LABEL, type EventImpact } from '../events.ts';
import { PLAN } from '../plan.ts';
import { Menu } from './Menu.tsx';

export type EventDraft = Omit<PlanEvent, 'code'>;

interface EventsViewProps {
  /** The locked plan's events. */
  planEvents: readonly PlanEvent[];
  /** Events the open scenario registers. */
  added: readonly PlanEvent[];
  /** Plan events the open scenario switches off. */
  off: ReadonlySet<string>;
  /** What each event in effect does to the plan. Computed on demand. */
  impact: (code: string) => EventImpact | null;
  scenarioName: string | null;
  sites: readonly SiteInput[];
  outsourcers: readonly string[];
  businessUnits: readonly string[];
  horizon: number;
  onShow: (code: string) => void;
  onSwitch: (code: string, on: boolean) => void;
  onAdd: (draft: EventDraft) => void;
  onRemoveAdded: (code: string) => void;
}

const one = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const MINUS = '−';
const pad = (n: number) => String(n).padStart(2, '0');
const signed = (v: number, fmt: Intl.NumberFormat) => (Math.abs(v) < 0.05 ? fmt.format(0) : `${v > 0 ? '+' : MINUS}${fmt.format(Math.abs(v))}`);

export function EventsView(props: EventsViewProps) {
  const { planEvents, added, off, impact, scenarioName, sites, horizon, onShow, onSwitch, onRemoveAdded } = props;
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? id;
  const rows = [...planEvents.map((e) => ({ e, source: 'plan' as const })), ...added.map((e) => ({ e, source: 'scenario' as const }))];

  return (
    <>
      <div className="scenario-bar">
        <div className="sc-title">
          <span className="sc-name">Event register</span>
          <span className="tag">{scenarioName ? 'Draft' : 'Locked'}</span>
          <span className="sc-fork">
            {PLAN.name} {PLAN.version} · {scenarioName ?? PLAN.scenario}
          </span>
        </div>
        <div className="sc-overrides">
          <span className="sc-empty">
            Known drivers the forecast does not hold. Each moves volume or AHT in its weeks, for the units in scope, and feeds the plan.
          </span>
          <Menu
            trigger={(p) => (
              <button className="tl-button sc-add" {...p}>
                + Register event
              </button>
            )}
          >
            {(close) => <EventForm {...props} onDone={close} />}
          </Menu>
        </div>
      </div>
      {!scenarioName && <div className="tl-note events-note">Registering an event or switching one off forks a scenario from the locked plan.</div>}

      <div className="grid-scroll">
        <table className="grid events" style={{ width: 1390 }}>
          <colgroup>
            <col style={{ width: 300 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 170 }} />
            <col style={{ width: 92 }} />
            <col style={{ width: 200 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 92 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 186 }} />
          </colgroup>
          <thead>
            <tr className="band">
              <th className="id">Event</th>
              <th colSpan={4}>Register</th>
              <th colSpan={2}>Effect on the plan</th>
              <th colSpan={2}>Status</th>
            </tr>
            <tr className="head">
              <th className="id">Name</th>
              <th className="text">Type</th>
              <th className="text">Applies to</th>
              <th className="text">Weeks</th>
              <th className="text">Effect</th>
              <th>Peak req. FTE</th>
              <th>Starters</th>
              <th className="text">State</th>
              <th className="text" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ e, source }) => {
              const isOff = source === 'plan' && off.has(e.code);
              const im = isOff ? null : impact(e.code);
              return (
                <tr key={e.code} className={`site ${isOff ? 'off' : ''}`}>
                  <td className="id">
                    <div className="id-cell">
                      <span className="id-name">{e.name}</span>
                      <span className="id-code">{e.code}</span>
                    </div>
                  </td>
                  <td className="text">{EVENT_TYPE_LABEL[e.type]}</td>
                  <td className="text">{describeEventScope(e.scope, siteName)}</td>
                  <td className="text">
                    W{pad(e.fromWeek)}–W{pad(e.toWeek)}
                  </td>
                  <td className="text">{describeEffect(e)}</td>
                  <td className={im && im.peakRequired > 0.05 ? 'neg' : 'muted'} title={im ? `Largest in W${pad(im.peakWeek)}` : undefined}>
                    {im ? `${signed(im.peakRequired, one)} W${pad(im.peakWeek)}` : '–'}
                  </td>
                  <td className={im && im.starters !== 0 ? undefined : 'muted'}>{im ? signed(im.starters, int) : '–'}</td>
                  <td className="text">{source === 'scenario' ? `Added in ${scenarioName}` : isOff ? `Off in ${scenarioName}` : 'In the plan'}</td>
                  <td className="text">
                    <span className="event-actions">
                    {!isOff && (
                      <button className="link-button" onClick={() => onShow(e.code)}>
                        Show in plan
                      </button>
                    )}
                    {source === 'plan' ? (
                      <button className="link-button" onClick={() => onSwitch(e.code, isOff)}>
                        {isOff ? 'Switch on' : 'Switch off'}
                      </button>
                    ) : (
                      <button className="link-button" onClick={() => onRemoveAdded(e.code)}>
                        Remove
                      </button>
                    )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="events-foot">
          Peak req. FTE is the most the event adds to total Required FTE in one of its weeks. Starters is the hiring it causes across the{' '}
          {horizon}-week horizon. Both compare the plan with and without the event.
        </p>
      </div>
    </>
  );
}

const TYPES: readonly EventType[] = ['campaign', 'training', 'system', 'other'];

function EventForm({ sites, outsourcers, businessUnits, horizon, onAdd, onDone }: EventsViewProps & { onDone: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<EventType>('campaign');
  const [scopeKey, setScopeKey] = useState('all');
  const [from, setFrom] = useState(20);
  const [to, setTo] = useState(22);
  const [volume, setVolume] = useState('5');
  const [aht, setAht] = useState('');
  const [error, setError] = useState<string | null>(null);

  const scopeOf = (key: string): EventScope =>
    key === 'all'
      ? { type: 'all' }
      : key.startsWith('o:')
        ? { type: 'outsourcer', outsourcer: key.slice(2) }
        : key.startsWith('s:')
          ? { type: 'site', siteId: key.slice(2) }
          : { type: 'businessUnit', lob: key.slice(2) };

  const pct = (v: string) => (v.trim() === '' ? undefined : Number(v) / 100);
  const submit = () => {
    if (name.trim() === '') return setError('Name the event.');
    const v = pct(volume);
    const a = pct(aht);
    if ((v !== undefined && !Number.isFinite(v)) || (a !== undefined && !Number.isFinite(a))) return setError('Effects are percentages.');
    if (v === undefined && a === undefined) return setError('Give an effect on volume, AHT or both.');
    if ((v ?? 0) <= -1 || (a ?? 0) <= -1) return setError('An effect cannot remove 100% or more.');
    if (from > to) return setError('The first week must not follow the last.');
    onAdd({ name: name.trim(), type, scope: scopeOf(scopeKey), fromWeek: from, toWeek: to, volumePct: v, ahtPct: a });
    onDone();
  };

  const weeks = Array.from({ length: horizon }, (_, i) => i + 1);
  return (
    <form
      className="ov-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="menu-heading">Register event</div>
      <label className="ov-field">
        <span>Name</span>
        <input className="ov-text" value={name} onChange={(e) => setName(e.target.value)} aria-label="Event name" autoFocus />
      </label>
      <label className="ov-field">
        <span>Type</span>
        <select value={type} onChange={(e) => setType(e.target.value as EventType)}>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {EVENT_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="ov-field">
        <span>Applies to</span>
        <select value={scopeKey} onChange={(e) => setScopeKey(e.target.value)}>
          <option value="all">All sites</option>
          <optgroup label="Outsourcer">
            {outsourcers.map((o) => (
              <option key={o} value={`o:${o}`}>
                {o}
              </option>
            ))}
          </optgroup>
          <optgroup label="Site">
            {sites.map((s) => (
              <option key={s.id} value={`s:${s.id}`}>
                {s.name} ({s.id})
              </option>
            ))}
          </optgroup>
          <optgroup label="Business Unit">
            {businessUnits.map((b) => (
              <option key={b} value={`b:${b}`}>
                {b}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <div className="ov-field">
        <span>Weeks</span>
        <span className="ov-weeks">
          <select value={from} onChange={(e) => setFrom(Number(e.target.value))} aria-label="From week">
            {weeks.map((w) => (
              <option key={w} value={w}>
                W{pad(w)}
              </option>
            ))}
          </select>
          <span>to</span>
          <select value={to} onChange={(e) => setTo(Number(e.target.value))} aria-label="To week">
            {weeks.map((w) => (
              <option key={w} value={w}>
                W{pad(w)}
              </option>
            ))}
          </select>
        </span>
      </div>
      <label className="ov-field">
        <span>Volume</span>
        <span className="ov-input">
          <input value={volume} onChange={(e) => setVolume(e.target.value)} inputMode="decimal" aria-label="Effect on volume" />
          <span className="ov-unit">% change</span>
        </span>
      </label>
      <label className="ov-field">
        <span>AHT</span>
        <span className="ov-input">
          <input value={aht} onChange={(e) => setAht(e.target.value)} inputMode="decimal" aria-label="Effect on AHT" />
          <span className="ov-unit">% change</span>
        </span>
      </label>
      <div className="ov-hint">Moves the forecast of every planning unit in scope, in those weeks. Leave an effect blank for none.</div>
      {error && <div className="ov-error">{error}</div>}
      <div className="menu-foot">
        <button type="button" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="primary">
          Register
        </button>
      </div>
    </form>
  );
}
