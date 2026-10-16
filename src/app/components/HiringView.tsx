import { createColumnHelper, flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import { formatValue, type Formatted } from '../format.ts';
import { sumClasses, type Exception, type HiringClass, type HiringPlan } from '../hiring.ts';
import { PLAN } from '../plan.ts';
import { Caret, Check } from './icons.tsx';
import { Menu } from './Menu.tsx';

export type HiringGrouping = 'week' | 'site';
export type HiringKey = 'starters' | 'graduates' | 'deficit' | 'start' | 'training' | 'nesting' | 'productive';

export interface HiringRef {
  classId: string;
  key: HiringKey;
}

interface HRow {
  id: string;
  kind: 'group' | 'site' | 'subtotal' | 'total';
  label: string;
  sub?: string;
  cls?: HiringClass;
  sums?: { starters: number; graduates: number; deficit: number };
}

interface HiringViewProps {
  hp: HiringPlan;
  scenarioName: string | null;
  trainingAttrition: number;
  vendors: readonly string[];
  vendorFilter: ReadonlySet<string>;
  onVendorFilter: (v: ReadonlySet<string>) => void;
  grouping: HiringGrouping;
  onGrouping: (g: HiringGrouping) => void;
  selected: HiringRef | null;
  onSelect: (ref: HiringRef | null) => void;
}

const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const one = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const day = (iso: string) => dayFmt.format(new Date(`${iso}T00:00:00Z`)).replace(',', '');

interface ColDef {
  key: HiringKey | 'id' | 'vendor' | 'driver';
  header: string;
  group: string;
  width: number;
  text?: boolean;
}

const COLS: readonly ColDef[] = [
  { key: 'id', header: 'Site', group: 'identity', width: 230, text: true },
  { key: 'vendor', header: 'Vendor', group: 'Class', width: 150, text: true },
  { key: 'starters', header: 'Starters', group: 'Class', width: 76 },
  { key: 'graduates', header: 'Graduates', group: 'Class', width: 84 },
  { key: 'start', header: 'Start', group: 'Schedule', width: 96 },
  { key: 'training', header: 'Training', group: 'Schedule', width: 92 },
  { key: 'nesting', header: 'Nesting', group: 'Schedule', width: 84 },
  { key: 'productive', header: 'Productive', group: 'Schedule', width: 86 },
  { key: 'deficit', header: 'Need FTE', group: 'Need', width: 80 },
  { key: 'driver', header: 'Driver', group: 'Need', width: 176, text: true },
];

const helper = createColumnHelper<HRow>();

function buildRows(hp: HiringPlan, grouping: HiringGrouping): HRow[] {
  const rows: HRow[] = [];
  if (grouping === 'week') {
    for (const g of hp.byWeek) {
      rows.push({ id: `g:${g.week}`, kind: 'group', label: g.label, sub: `Classes start ${day(g.date)}` });
      for (const c of g.classes) rows.push({ id: c.id, kind: 'site', label: c.siteName, sub: c.siteId, cls: c });
      rows.push({
        id: `t:${g.week}`,
        kind: 'subtotal',
        label: `${g.label.slice(5)} total`,
        sub: `${g.classes.length} class${g.classes.length === 1 ? '' : 'es'}`,
        sums: sumClasses(g.classes),
      });
    }
  } else {
    const sites = [...new Set(hp.classes.map((c) => c.siteId))];
    const order = hp.classes.slice().sort((a, b) => a.vendor.localeCompare(b.vendor) || a.siteName.localeCompare(b.siteName));
    for (const siteId of [...new Set(order.map((c) => c.siteId))].filter((s) => sites.includes(s))) {
      const cs = hp.classes.filter((c) => c.siteId === siteId);
      const first = cs[0]!;
      rows.push({ id: `g:${siteId}`, kind: 'group', label: first.siteName, sub: `${siteId} · ${first.vendor}` });
      for (const c of cs) rows.push({ id: c.id, kind: 'site', label: c.startLabel, sub: day(c.startDate), cls: c });
      rows.push({
        id: `t:${siteId}`,
        kind: 'subtotal',
        label: `${first.siteName} total`,
        sub: `${cs.length} class${cs.length === 1 ? '' : 'es'}`,
        sums: sumClasses(cs),
      });
    }
  }
  if (hp.classes.length > 0) {
    rows.push({ id: 'total', kind: 'total', label: 'Total', sub: `${hp.classes.length} classes`, sums: sumClasses(hp.classes) });
  }
  return rows;
}

function cell(row: HRow, key: ColDef['key']): Formatted {
  const c = row.cls;
  const s = row.sums;
  const text = (t: string): Formatted => ({ text: t, tone: undefined });
  if (row.kind === 'group') return text('');
  switch (key) {
    case 'starters':
      return formatValue(c?.starters ?? s?.starters ?? null, 'int');
    case 'graduates':
      return formatValue(c?.graduates ?? s?.graduates ?? null, 'one');
    case 'deficit':
      return formatValue(c?.deficit ?? s?.deficit ?? null, 'one');
    case 'vendor':
      return text(c?.vendor ?? '');
    case 'start':
      return c ? text(day(c.startDate)) : text('');
    case 'training':
      return text(c?.trainingLabel ?? '');
    case 'nesting':
      return text(c?.nestingLabel ?? '');
    case 'productive':
      return text(c?.productiveLabel.slice(5) ?? '');
    case 'driver':
      return text(c?.driver ?? '');
    default:
      return text('');
  }
}

export function HiringView(props: HiringViewProps) {
  const { hp, scenarioName, trainingAttrition, vendors, vendorFilter, onVendorFilter, grouping, onGrouping, selected, onSelect } = props;
  const rows = useMemo(() => buildRows(hp, grouping), [hp, grouping]);
  const totals = sumClasses(hp.classes);
  const busiest = hp.byWeek.reduce<{ label: string; n: number } | null>((best, g) => {
    const n = sumClasses(g.classes).starters;
    return !best || n > best.n ? { label: g.label, n } : best;
  }, null);
  const sitesHiring = new Set(hp.classes.map((c) => c.siteId)).size;
  const first = hp.byWeek[0];

  const columns = useMemo<ColumnDef<HRow, unknown>[]>(() => {
    const groups = ['identity', 'Class', 'Schedule', 'Need'];
    return groups.map((g) =>
      helper.group({
        id: g,
        header: g === 'identity' ? (grouping === 'week' ? 'Start week / site' : 'Site / start week') : g,
        columns: COLS.filter((c) => c.group === g).map((c) =>
          helper.display({ id: c.key, header: c.key === 'id' ? (grouping === 'week' ? 'Site' : 'Start week') : c.header, size: c.width }),
        ),
      }),
    );
  }, [grouping]);

  const table = useReactTable({ data: rows, columns, getRowId: (r) => r.id, getCoreRowModel: getCoreRowModel() });
  const leaves = table.getVisibleLeafColumns();
  const width = leaves.reduce((s, c) => s + c.getSize(), 0);
  const [bandRow, headRow] = table.getHeaderGroups();
  const allVendors = vendorFilter.size === vendors.length;

  return (
    <>
      <div className="scenario-bar">
        <div className="sc-title">
          <span className="sc-name">Hiring plan</span>
          <span className="tag">{scenarioName ? 'Draft' : 'Locked'}</span>
          <span className="sc-fork">
            {PLAN.name} {PLAN.version} · {scenarioName ?? PLAN.scenario}
          </span>
        </div>
        <div className="sc-overrides">
          <span className="sc-empty">
            Classes of at least <span className="num">{hp.minClassSize}</span> · training <span className="num">{hp.trainingWeeks}</span> wks ·
            nesting <span className="num">{hp.nestingWeeks}</span> wks · training attrition{' '}
            <span className="num">{one.format(trainingAttrition * 100)}%</span>
          </span>
        </div>
      </div>
      <div className="summary-strip" aria-label="Hiring summary">
        <span className="ss-label">FY27</span>
        <Stat label="Classes" value={int.format(hp.classes.length)} />
        <Stat label="Starters" value={int.format(totals.starters)} strong />
        <Stat label="Graduates" value={one.format(totals.graduates)} />
        <Stat label="Sites hiring" value={int.format(sitesHiring)} />
        {first && <Stat label="First class" value={`${first.label} · ${day(first.date)}`} />}
        {busiest && <Stat label="Busiest start week" value={`${busiest.label} · ${int.format(busiest.n)} starters`} />}
      </div>
      <div className="toolbar" role="toolbar" aria-label="Hiring plan controls">
        <div className="tl-seg">
          <Menu
            trigger={(p) => (
              <button className="tl-button" {...p}>
                <span className="tl-key">Group</span> {grouping === 'week' ? 'Start week' : 'Site'} <Caret />
              </button>
            )}
          >
            {(close) =>
              (['week', 'site'] as const).map((g) => (
                <button
                  key={g}
                  className="menu-item"
                  role="menuitemradio"
                  aria-checked={g === grouping}
                  onClick={() => {
                    onGrouping(g);
                    close();
                  }}
                >
                  <span className="tick">{g === grouping && <Check />}</span>
                  {g === 'week' ? 'Start week' : 'Site'}
                </button>
              ))
            }
          </Menu>
        </div>
        <div className="tl-seg">
          <Menu
            trigger={(p) => (
              <button className="tl-button" {...p}>
                <span className="tl-key">Vendor</span> {allVendors ? 'All' : [...vendorFilter].join(', ')} <Caret />
              </button>
            )}
          >
            {() => (
              <>
                {vendors.map((v) => {
                  const on = vendorFilter.has(v);
                  return (
                    <button
                      key={v}
                      className="menu-item"
                      role="menuitemcheckbox"
                      aria-checked={on}
                      onClick={() => {
                        const next = new Set(vendorFilter);
                        if (on) next.delete(v);
                        else next.add(v);
                        if (next.size > 0) onVendorFilter(next);
                      }}
                    >
                      <span className={`check ${on ? 'on' : ''}`}>{on && <Check />}</span>
                      {v}
                    </button>
                  );
                })}
                <div className="menu-foot">
                  <button onClick={() => onVendorFilter(new Set(vendors))} disabled={allVendors}>
                    All vendors
                  </button>
                </div>
              </>
            )}
          </Menu>
        </div>
        <div className="tl-spacer" />
        <div className="tl-note">Each class is productive in the week its site needs the heads</div>
      </div>

      <div className="grid-scroll">
        {rows.length === 0 ? (
          <div className="grid-empty">No classes are needed for the selected vendors.</div>
        ) : (
          <table className="grid hiring" style={{ width }}>
            <colgroup>
              {leaves.map((c) => (
                <col key={c.id} style={{ width: c.getSize() }} />
              ))}
            </colgroup>
            <thead>
              <tr className="band">
                {bandRow?.headers.map((h) => (
                  <th key={h.id} colSpan={h.colSpan} className={h.column.id === 'identity' ? 'id' : undefined}>
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
              <tr className="head">
                {headRow?.headers.map((h) => {
                  const def = COLS.find((c) => c.key === h.column.id);
                  return (
                    <th key={h.id} className={h.column.id === 'id' ? 'id' : def?.text ? 'text' : undefined} scope="col">
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {table.getRowModel().rows.map((r) => {
                const row = r.original;
                return (
                  <tr key={r.id} className={row.kind}>
                    {r.getVisibleCells().map((c) => {
                      const def = COLS.find((x) => x.key === c.column.id)!;
                      if (def.key === 'id') {
                        return (
                          <td key={c.id} className="id">
                            <div className="id-cell">
                              <span className="id-name">{row.label}</span>
                              {row.sub && <span className="id-code">{row.sub}</span>}
                              {row.cls?.capLimited && (
                                <span className="flag-cap" title="Class limited by the site's contracted cap">
                                  CAP
                                </span>
                              )}
                            </div>
                          </td>
                        );
                      }
                      const f = cell(row, def.key);
                      const selectable = row.cls !== undefined && !def.text;
                      const isSel = selectable && selected?.classId === row.cls!.id && selected.key === def.key;
                      const cls = [def.text ? 'text' : undefined, f.tone, selectable ? 'computed' : undefined, isSel ? 'selected' : undefined]
                        .filter(Boolean)
                        .join(' ');
                      return (
                        <td
                          key={c.id}
                          className={cls || undefined}
                          onClick={selectable ? () => onSelect(isSel ? null : { classId: row.cls!.id, key: def.key as HiringKey }) : undefined}
                        >
                          {f.text}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {hp.exceptions.length > 0 && <Exceptions exceptions={hp.exceptions} />}
      </div>
    </>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <span className="ss-item">
      <span className="ss-key">{label}</span>
      <span className={`num ${strong ? 'ss-delta' : ''}`}>{value}</span>
    </span>
  );
}

const ACTION: Readonly<Record<Exception['kind'], string>> = {
  lead: 'Cover with overtime, transfers or vendor surge',
  cap: 'Raise the contracted cap or move volume to another site',
};

function Exceptions({ exceptions }: { exceptions: readonly Exception[] }) {
  const rows = [...exceptions].sort((a, b) => (a.kind === b.kind ? a.siteName.localeCompare(b.siteName) : a.kind === 'lead' ? -1 : 1));
  const weeks = (ws: readonly number[]) => {
    // Compress to ranges: W01–W06, W31–W34.
    const out: string[] = [];
    let start = ws[0]!;
    let prev = start;
    const push = () => out.push(start === prev ? `W${pad(start)}` : `W${pad(start)}–W${pad(prev)}`);
    for (const w of ws.slice(1)) {
      if (w === prev + 1) prev = w;
      else {
        push();
        start = prev = w;
      }
    }
    push();
    return out.join(', ');
  };
  return (
    <table className="grid hiring exceptions" style={{ width: 1194 }}>
      <colgroup>
        <col style={{ width: 230 }} />
        <col style={{ width: 150 }} />
        <col style={{ width: 150 }} />
        <col style={{ width: 230 }} />
        <col style={{ width: 84 }} />
        <col style={{ width: 350 }} />
      </colgroup>
      <thead>
        <tr className="band">
          <th className="id" colSpan={6}>
            Not coverable by hiring
          </th>
        </tr>
        <tr className="head">
          <th className="id">Site</th>
          <th className="text">Vendor</th>
          <th className="text">Reason</th>
          <th className="text">Weeks</th>
          <th>Peak FTE</th>
          <th className="text">Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((e) => (
          <tr key={`${e.kind}:${e.siteId}`} className="site">
            <td className="id">
              <div className="id-cell">
                <span className="id-name">{e.siteName}</span>
                <span className="id-code">{e.siteId}</span>
                {e.kind === 'cap' && <span className="flag-cap">CAP</span>}
              </div>
            </td>
            <td className="text">{e.vendor}</td>
            <td className="text">{e.kind === 'lead' ? 'Inside training lead time' : 'Above contracted cap'}</td>
            <td className="text">{weeks(e.weeks)}</td>
            <td>{one.format(e.peakFte)}</td>
            <td className="text">{ACTION[e.kind]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
