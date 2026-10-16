import { PLAN } from '../plan.ts';
import { RailIcon } from './icons.tsx';

const PLANNING = [
  { id: 'plans', label: 'Plans', icon: 'plans', enabled: true },
  { id: 'scenarios', label: 'Scenarios', icon: 'scenarios', enabled: false },
  { id: 'hiring', label: 'Hiring plan', icon: 'hiring', enabled: false },
];

const SETUP = [
  { id: 'sites', label: 'Vendors & sites', icon: 'sites', enabled: false },
  { id: 'assumptions', label: 'Assumptions', icon: 'assumptions', enabled: false },
  { id: 'imports', label: 'Imports', icon: 'imports', enabled: false },
  { id: 'audit', label: 'Audit', icon: 'audit', enabled: false },
];

interface RailProps {
  sites: number;
  units: number;
}

export function Rail({ sites, units }: RailProps) {
  const item = (i: (typeof PLANNING)[number]) => (
    <button
      key={i.id}
      className="rail-item"
      aria-current={i.id === 'plans' ? 'page' : undefined}
      aria-disabled={!i.enabled}
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
          <dd>Locked</dd>
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
