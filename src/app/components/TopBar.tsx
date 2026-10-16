import type { PlanWeek } from '../../engine/index.ts';
import { PLAN } from '../plan.ts';
import { Caret, Check, Download, Lock, Mark } from './icons.tsx';
import { Menu } from './Menu.tsx';

interface TopBarProps {
  weeks: readonly PlanWeek[];
}

export function TopBar({ weeks }: TopBarProps) {
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
                {PLAN.scenario}
                <span className="lock-badge">
                  <Lock /> LOCKED
                </span>
                <Caret />
              </span>
            </span>
          </button>
        )}
      >
        {(close) => (
          <>
            <div className="menu-heading">Scenarios</div>
            <button className="menu-item" role="menuitemradio" aria-checked onClick={close}>
              <span className="tick">
                <Check />
              </span>
              {PLAN.scenario}
              <span className="aside">Locked</span>
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

      <button className="tb-action" disabled title="Export to Excel">
        <Download /> Export
      </button>
    </header>
  );
}
