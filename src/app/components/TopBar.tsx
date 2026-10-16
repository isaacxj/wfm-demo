import type { PlanWeek } from '../../engine/index.ts';
import type { Scenario } from '../../scenario/scenario.ts';
import { PLAN } from '../plan.ts';
import { Caret, Check, Download, Lock, Mark } from './icons.tsx';
import { Menu } from './Menu.tsx';

interface TopBarProps {
  weeks: readonly PlanWeek[];
  scenarios: readonly Scenario[];
  /** Open scenario, or null for the locked baseline. */
  activeId: string | null;
  onActivate: (id: string | null) => void;
  onFork: () => void;
  /** Exports the current view; absent when there is nothing to export. */
  onExport?: () => void;
  exporting: boolean;
}

export function TopBar({ weeks, scenarios, activeId, onActivate, onFork, onExport, exporting }: TopBarProps) {
  const active = scenarios.find((s) => s.id === activeId) ?? null;
  const first = weeks[0]?.label ?? '';
  const last = weeks.at(-1)?.label ?? '';
  return (
    <header className="topbar">
      <div className="mark">
        <div className="mark-glyph">
          <Mark />
        </div>
        <div>
          <div className="mark-name">Capacity Planner</div>
          <div className="mark-sub">Statixx</div>
        </div>
      </div>

      <Menu
        trigger={(p) => (
          <button className="tb-button" {...p}>
            <span className="tb-field">
              <span className="tb-label">Plan</span>
              <span className="tb-value">
                {PLAN.name} <span className="num">{PLAN.version}</span> <Caret />
              </span>
            </span>
          </button>
        )}
      >
        {(close) => (
          <>
            <div className="menu-heading">Plans</div>
            <button className="menu-item" role="menuitemradio" aria-checked onClick={close}>
              <span className="tick">
                <Check />
              </span>
              {PLAN.name}
              <span className="aside">{PLAN.version}</span>
            </button>
          </>
        )}
      </Menu>

      <Menu
        trigger={(p) => (
          <button className="tb-button" {...p}>
            <span className="tb-field">
              <span className="tb-label">Scenario</span>
              <span className="tb-value">
                {active ? active.name : PLAN.scenario}
                {active ? (
                  <span className="lock-badge draft">DRAFT</span>
                ) : (
                  <span className="lock-badge">
                    <Lock /> LOCKED
                  </span>
                )}
                <Caret />
              </span>
            </span>
          </button>
        )}
      >
        {(close) => (
          <>
            <div className="menu-heading">Scenarios</div>
            <button
              className="menu-item"
              role="menuitemradio"
              aria-checked={active === null}
              onClick={() => {
                onActivate(null);
                close();
              }}
            >
              <span className="tick">{active === null && <Check />}</span>
              {PLAN.scenario}
              <span className="aside">Locked</span>
            </button>
            {scenarios.map((sc) => (
              <button
                key={sc.id}
                className="menu-item"
                role="menuitemradio"
                aria-checked={sc.id === activeId}
                onClick={() => {
                  onActivate(sc.id);
                  close();
                }}
              >
                <span className="tick">{sc.id === activeId && <Check />}</span>
                {sc.name}
                <span className="aside">
                  {sc.overrides.length} override{sc.overrides.length === 1 ? '' : 's'}
                </span>
              </button>
            ))}
            <div className="menu-sep" />
            <button
              className="menu-item"
              onClick={() => {
                onFork();
                close();
              }}
            >
              <span className="tick" />
              Fork scenario from {PLAN.version}
            </button>
          </>
        )}
      </Menu>

      <Menu
        trigger={(p) => (
          <button className="tb-button" {...p}>
            <span className="tb-field">
              <span className="tb-label">Grain</span>
              <span className="tb-value">
                Weekly <Caret />
              </span>
            </span>
          </button>
        )}
      >
        {(close) => (
          <>
            <button className="menu-item" role="menuitemradio" aria-checked onClick={close}>
              <span className="tick">
                <Check />
              </span>
              Weekly
            </button>
            <button className="menu-item" role="menuitemradio" aria-checked={false} disabled>
              <span className="tick" />
              Monthly
              <span className="aside">Not in this plan</span>
            </button>
          </>
        )}
      </Menu>

      <div className="tb-seg">
        <span className="tb-field">
          <span className="tb-label">Period</span>
          <span className="tb-value">
            <span className="num">
              {first} – {last}
            </span>
          </span>
        </span>
      </div>

      <div className="tb-spacer" />

      <button className="tb-action" disabled={!onExport || exporting} onClick={onExport} title="Export this view to Excel (.xlsx)">
        <Download /> {exporting ? 'Exporting…' : 'Export'}
      </button>
    </header>
  );
}
