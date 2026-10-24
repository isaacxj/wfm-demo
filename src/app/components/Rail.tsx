import { PLAN } from '../plan.ts';
import { RailIcon } from './icons.tsx';

const PLANNING = [
  { id: 'plans', label: 'Plans', icon: 'plans', enabled: true },
  { id: 'scenarios', label: 'Scenarios', icon: 'scenarios', enabled: true },
  { id: 'hiring', label: 'Hiring plan', icon: 'hiring', enabled: true },
  { id: 'events', label: 'Events', icon: 'events', enabled: true },
];

const SETUP = [
  { id: 'sites', label: 'Outsourcers & sites', icon: 'sites', enabled: false },
  { id: 'assumptions', label: 'Assumptions', icon: 'assumptions', enabled: false },
  { id: 'imports', label: 'Imports', icon: 'imports', enabled: false },
  { id: 'audit', label: 'Audit', icon: 'audit', enabled: false },
];

export type View = 'plans' | 'scenarios' | 'hiring' | 'events';

interface RailProps {
  view: View;
  onView: (view: View) => void;
  locked: boolean;
  sites: number;
  units: number;
}

export function Rail({ view, onView, locked, sites, units }: RailProps) {
  const item = (i: (typeof PLANNING)[number]) => (
    <button
      key={i.id}
      className="rail-item"
      aria-current={i.id === view ? 'page' : undefined}
      aria-disabled={!i.enabled}
      onClick={i.enabled ? () => onView(i.id as View) : undefined}
      title={i.enabled ? undefined : 'Not available in this build'}
    >
      <RailIcon name={i.icon} />
      {i.label}
    </button>
  );
  return (
    <nav className="rail" aria-label="Sections">
      <div className="rail-section">
        <div className="rail-heading">Planning</div>
        {PLANNING.map(item)}
      </div>
      <div className="rail-section">
        <div className="rail-heading">Setup</div>
        {SETUP.map(item)}
      </div>
      <div className="rail-meta">
        <dl>
          <dt>Plan</dt>
          <dd>{PLAN.version}</dd>
          <dt>State</dt>
          <dd>{locked ? 'Locked' : 'Scenario draft'}</dd>
          <dt>Locked on</dt>
          <dd>{PLAN.lockedOn}</dd>
          <dt>Owner</dt>
          <dd>{PLAN.owner}</dd>
          <dt>Sites</dt>
          <dd>{sites}</dd>
          <dt>Units</dt>
          <dd>{units}</dd>
        </dl>
      </div>
    </nav>
  );
}
