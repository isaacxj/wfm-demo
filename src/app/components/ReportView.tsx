import { formatDelta, formatValue } from '../format.ts';
import { PLAN } from '../plan.ts';
import type { Report, Tile } from '../report.ts';
import { OverUnderChart } from './OverUnderChart.tsx';

interface ReportViewProps {
  report: Report;
  /** Opens the Periods grid on Over/Under: the curve as a table. */
  onTable: () => void;
  printedOn: string;
}

const MINUS = '−';
const pad = (n: number) => String(n).padStart(2, '0');

function show(v: number, format: Tile['format']): string {
  return formatValue(v, format === 'signed' ? 'signed' : format).text;
}

/** Green when the change goes the way that is better, red when it goes the other way. */
function deltaTone(d: number, better: Tile['better']): string {
  if (Math.abs(d) < 0.05 || !better) return '';
  return (d > 0) === (better === 'up') ? 'pos' : 'neg';
}

export function ReportView({ report, onTable, printedOn }: ReportViewProps) {
  const r = report;
  return (
    <div className="report-scroll">
      <article className="report" aria-label={r.title}>
        <header className="report-head">
          <div>
            <h1>{r.title}</h1>
            <div className="report-sub">
              {PLAN.name} {PLAN.version} · {r.scenarioName ? `${r.scenarioName} against the locked baseline` : `${PLAN.scenario}, locked`} · {r.asOf}
            </div>
          </div>
          <div className="report-actions">
            <span className="report-printed">Prepared {printedOn}</span>
            <button className="primary-button" onClick={() => window.print()}>
              Print
            </button>
          </div>
        </header>

        <section className="report-tiles" aria-label="Headline numbers">
          {r.tiles.map((t) => {
            const d = t.scenario === undefined ? null : t.scenario - t.value;
            return (
              <div key={t.label} className="report-tile">
                <div className="rt-label">{t.label}</div>
                {t.scenario === undefined ? (
                  <div className={`rt-value ${t.format === 'signed' ? deltaTone(t.value, t.better) : ''}`}>{show(t.value, t.format)}</div>
                ) : (
                  <div className="rt-pair">
                    <span className="rt-base">{show(t.value, t.format)}</span>
                    <span className="rt-arrow">→</span>
                    <span className="rt-value">{show(t.scenario, t.format)}</span>
                    <span className={`rt-delta ${deltaTone(d!, t.better)}`}>{formatDelta(d, t.format === 'int' ? 'int' : 'one', false).text}</span>
                  </div>
                )}
                <div className="rt-note">{t.note}</div>
              </div>
            );
          })}
        </section>

        <section className="report-section" aria-label="Over/Under by week">
          <h2>
            Over/Under by week, all sites
            <span className="report-h2-note">FTE; actuals to W{pad(r.throughWeek)}, then the plan. Positive is over, negative is under.</span>
          </h2>
          <OverUnderChart weeks={r.weeks} series={r.curve} throughWeek={r.throughWeek} events={r.events} onTable={onTable} />
          {r.events.length > 0 && (
            <div className="report-events">
              {r.events.map((e) => (
                <span key={e.code}>
                  <span className="event-code">{e.code}</span> {e.name}, W{pad(e.fromWeek)}–W{pad(e.toWeek)}
                </span>
              ))}
            </div>
          )}
        </section>

        <div className="report-columns">
          <section className="report-section" aria-label="Hiring instruction">
            <h2>
              Hiring instruction
              <span className="report-h2-note">
                Classes starting W{pad(r.hiringWindow[0])}–W{pad(r.hiringWindow[1])}
              </span>
            </h2>
            {r.hiring.length === 0 ? (
              <p className="report-empty">No class starts in these weeks.</p>
            ) : (
              <table className="report-table hiring-table">
                <thead>
                  <tr>
                    <th>Start</th>
                    <th>Starters</th>
                    <th>Classes</th>
                    <th>Productive</th>
                    <th className="text">Sites</th>
                  </tr>
                </thead>
                <tbody>
                  {r.hiring.map((c) => (
                    <tr key={c.startWeek}>
                      <td>{c.startLabel.slice(5)}</td>
                      <td>{c.starters}</td>
                      <td>{c.classes}</td>
                      <td>{c.productiveLabel.slice(5)}</td>
                      <td className="text report-why" title={c.sites.map((s) => `${s.siteName} ${s.starters}`).join(', ')}>
                        {c.sites.map((s, i) => (
                          <span key={s.siteId}>
                            {i > 0 ? ', ' : ''}
                            {s.siteName} <span className="num">{s.starters}</span>
                            {s.moved ? <span className="moved-mark" title="Includes a class moved earlier by a constraint">*</span> : null}
                          </span>
                        ))}
                        {c.events.length > 0 && <span className="event-code"> · {c.events.join(', ')}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="report-more">
              * includes a class started early because its own week is blocked or full.
              {r.hiringMore > 0 ? ` And ${r.hiringMore} more start weeks; the hiring plan has every class.` : ''}
            </p>
          </section>

          <section className="report-section" aria-label="Top variances">
            <h2>
              Top variances
              <span className="report-h2-note">FTE a week</span>
            </h2>
            <table className="report-table variance-table">
              <thead>
                <tr>
                  <th className="text">Against</th>
                  <th className="text">Site</th>
                  <th className="text">When</th>
                  <th>FTE</th>
                </tr>
              </thead>
              <tbody>
                {r.variances.map((v, i) => (
                  <tr key={i}>
                    <td className="text">{v.kind}</td>
                    <td className="text">{v.where}</td>
                    <td className="text">{v.when}</td>
                    <td className={v.bad ? 'neg' : 'pos'}>{`${v.fte > 0 ? '+' : MINUS}${formatValue(Math.abs(v.fte), 'one').text}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="report-more">
              Actual vs plan: Over/Under against the plan, last four elapsed weeks. Against budget: positive is over budget.
            </p>
          </section>
        </div>

        <footer className="report-foot">
          Required FTE includes shrinkage; Productive FTE excludes it. Over/Under = Planned FTE − Required FTE. Statixx Solutions · invented
          data.
        </footer>
      </article>
    </div>
  );
}
