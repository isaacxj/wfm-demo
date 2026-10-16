interface StatusBarProps {
  engineName: string;
  calcMs: number;
  siteWeeks: number;
  sitesShown: number;
  units: number;
  weekLabel: string;
  /** Name of the open scenario, or null on the locked baseline. */
  scenario: string | null;
}

const int = new Intl.NumberFormat('en-US');

export function StatusBar({ engineName, calcMs, siteWeeks, sitesShown, units, weekLabel, scenario }: StatusBarProps) {
  return (
    <footer className="statusbar">
      <div className="sb-item">
        <span className="dot" aria-hidden />
        <strong>Calculated</strong>
      </div>
      <div className="sb-item">{engineName}</div>
      <div className="sb-item">
        <span className="num">{int.format(siteWeeks)}</span> site-weeks in <span className="num">{calcMs.toFixed(0)}</span> ms
      </div>
      <div className="sb-spacer" />
      <div className="sb-item end">
        <span className="num">{sitesShown}</span> sites · <span className="num">{units}</span> planning units
      </div>
      <div className="sb-item end">
        Week <span className="num">{weekLabel}</span>
      </div>
      <div className="sb-item end">{scenario ? `${scenario} · editable` : 'Baseline · read only'}</div>
    </footer>
  );
}
