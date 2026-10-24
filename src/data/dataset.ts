/**
 * Demo dataset, brief section 4. Every figure is invented.
 *
 * Deterministic: seasonality is a fixed table and all variation comes from
 * seeded integer streams, so output is identical on every run and engine.
 */
import type { Channel, DemandCell, PlanConstants, PlanEvent, PlanInput, PlanWeek, PlanningUnit, SiteInput, StaffType } from '../engine/index.ts';
import { DEFAULT_CHAT_EFFICIENCY, WEEKS_PER_MONTH, periodLabel, periodStart, toIsoDate } from '../engine/index.ts';
import { between, streamFor } from './rng.ts';

export const SEED = 20270104;
export const ISO_YEAR = 2027;
export const HORIZON_WEEKS = 52;

/**
 * Share of opening headcount reaching production each week from classes
 * already in training at plan start. Those classes cover the first
 * training + nesting weeks; after that, classes are the engine's.
 */
export const WEEKLY_HIRE_RATE = 0.03;

export const LINES_OF_BUSINESS = ['Mobile', 'Internet', 'Cable'] as const;
export const LANGUAGES = ['EN', 'FR', 'ES', 'TL'] as const;
export const CHANNELS = ['voice', 'chat', 'deferred'] as const satisfies readonly Channel[];

export const STAFF_TYPES = ['full-time', 'part-time'] as const satisfies readonly StaffType[];

/**
 * Sites with a part-time programme: the part-time work week, and the share of
 * each voice and chat queue's requirement part-timers carry.
 */
export const PART_TIME: Readonly<Record<string, { hours: number; share: number }>> = {
  KIN: { hours: 24, share: 0.3 },
  MEX: { hours: 24, share: 0.25 },
  YYZ: { hours: 20, share: 0.4 },
};

export type LineOfBusiness = (typeof LINES_OF_BUSINESS)[number];
export type Language = (typeof LANGUAGES)[number];

export const OUTSOURCERS = ['Teleperformance', 'Telus International', 'Accenture', 'In-house'] as const;
export type Outsourcer = (typeof OUTSOURCERS)[number];

interface SiteRow {
  id: string;
  outsourcer: Outsourcer;
  name: string;
  country: string;
  workWeekHours: number;
  occupancyCeiling: number;
  shrinkage: number;
  monthlyAttrition: number;
  cap: number | null;
  openingHeadcount: number;
}

/** Brief section 4, verbatim. */
export const SITE_TABLE: readonly SiteRow[] = [
  { id: 'MNL1', outsourcer: 'Teleperformance', name: 'Manila-1', country: 'PH', workWeekHours: 45.0, occupancyCeiling: 0.85, shrinkage: 0.305, monthlyAttrition: 0.052, cap: 980, openingHeadcount: 944 },
  { id: 'MNL2', outsourcer: 'Teleperformance', name: 'Manila-2', country: 'PH', workWeekHours: 45.0, occupancyCeiling: 0.85, shrinkage: 0.298, monthlyAttrition: 0.049, cap: null, openingHeadcount: 808 },
  { id: 'CAI', outsourcer: 'Teleperformance', name: 'Cairo', country: 'EG', workWeekHours: 42.5, occupancyCeiling: 0.85, shrinkage: 0.284, monthlyAttrition: 0.041, cap: null, openingHeadcount: 522 },
  { id: 'KIN', outsourcer: 'Telus International', name: 'Kingston', country: 'JM', workWeekHours: 40.0, occupancyCeiling: 0.85, shrinkage: 0.312, monthlyAttrition: 0.058, cap: 520, openingHeadcount: 433 },
  { id: 'CAN', outsourcer: 'Telus International', name: 'Guangzhou', country: 'CN', workWeekHours: 44.0, occupancyCeiling: 0.85, shrinkage: 0.276, monthlyAttrition: 0.037, cap: null, openingHeadcount: 581 },
  { id: 'SZX', outsourcer: 'Accenture', name: 'Shenzhen', country: 'CN', workWeekHours: 44.0, occupancyCeiling: 0.85, shrinkage: 0.271, monthlyAttrition: 0.035, cap: null, openingHeadcount: 621 },
  { id: 'MEX', outsourcer: 'Accenture', name: 'Mexico City', country: 'MX', workWeekHours: 42.0, occupancyCeiling: 0.85, shrinkage: 0.319, monthlyAttrition: 0.061, cap: null, openingHeadcount: 579 },
  { id: 'YYZ', outsourcer: 'In-house', name: 'Toronto', country: 'CA', workWeekHours: 37.5, occupancyCeiling: 0.82, shrinkage: 0.246, monthlyAttrition: 0.022, cap: null, openingHeadcount: 267 },
];

interface Coverage {
  lobs: readonly LineOfBusiness[];
  /** Primary language first. */
  languages: readonly Language[];
  channels: readonly Channel[];
  /** Chat sessions per agent, where the site runs chat. */
  concurrency?: number;
  /** Required requirement in a season-neutral week, as a multiple of opening HC. */
  loadFactor: number;
}

const COVERAGE: Readonly<Record<string, Coverage>> = {
  MNL1: { lobs: ['Mobile', 'Internet'], languages: ['EN', 'TL'], channels: ['voice', 'chat', 'deferred'], concurrency: 3, loadFactor: 1.0 },
  MNL2: { lobs: ['Internet', 'Cable'], languages: ['EN', 'TL'], channels: ['voice', 'chat'], concurrency: 2, loadFactor: 0.97 },
  CAI: { lobs: ['Mobile', 'Internet'], languages: ['EN', 'FR'], channels: ['voice', 'chat'], concurrency: 2, loadFactor: 1.03 },
  KIN: { lobs: ['Mobile', 'Cable'], languages: ['EN'], channels: ['voice', 'deferred'], loadFactor: 1.01 },
  CAN: { lobs: ['Internet', 'Cable'], languages: ['EN'], channels: ['voice', 'chat', 'deferred'], concurrency: 3, loadFactor: 0.94 },
  SZX: { lobs: ['Mobile', 'Internet'], languages: ['EN'], channels: ['voice', 'chat', 'deferred'], concurrency: 3, loadFactor: 0.99 },
  MEX: { lobs: ['Mobile', 'Internet', 'Cable'], languages: ['ES', 'EN'], channels: ['voice', 'chat'], concurrency: 2, loadFactor: 1.05 },
  YYZ: { lobs: ['Mobile', 'Internet', 'Cable'], languages: ['EN', 'FR'], channels: ['voice', 'deferred'], loadFactor: 0.96 },
};

/**
 * Weekly demand index for 2027: the forecast before any registered event.
 * Annual cycle peaking in January, a summer trough and a year-end lift from
 * week 46. The marketing spike in weeks 31 to 34 is not in the forecast: it
 * is a registered event, EV01, so the plan can say what causes it.
 */
export const SEASONALITY: readonly number[] = [
  1.069, 1.070, 1.069, 1.068, 1.065, 1.062, 1.058, 1.052, 1.046, 1.040, 1.033, 1.025, 1.017,
  1.008, 1.000, 0.992, 0.983, 0.975, 0.967, 0.960, 0.954, 0.948, 0.942, 0.938, 0.935, 0.932,
  0.931, 0.930, 0.931, 0.932, 0.936, 0.941, 0.945, 0.950, 0.954, 0.960, 0.967, 0.975, 0.983,
  0.992, 1.000, 1.008, 1.017, 1.025, 1.033, 1.065, 1.096, 1.127, 1.158, 1.187, 1.215, 1.243,
];

export const MARKETING_SPIKE_WEEKS: readonly number[] = [31, 32, 33, 34];

/** Known drivers of demand the forecast does not hold. */
export const EVENTS: readonly PlanEvent[] = [
  {
    code: 'EV01',
    name: 'Summer offer campaign',
    type: 'campaign',
    scope: { type: 'all' },
    fromWeek: 31,
    toWeek: 34,
    // Customers call about the offer, and the calls run longer while they ask.
    volumePct: 0.16,
    ahtPct: 0.04,
  },
  {
    code: 'EV02',
    name: 'Compliance disclosure training',
    type: 'training',
    scope: { type: 'businessUnit', lob: 'Mobile' },
    fromWeek: 14,
    toWeek: 19,
    // New mandatory disclosures add to every call while agents learn them.
    ahtPct: 0.03,
  },
  {
    code: 'EV03',
    name: 'Billing platform migration',
    type: 'system',
    scope: { type: 'businessUnit', lob: 'Internet' },
    fromWeek: 38,
    toWeek: 40,
    // First bills from the new platform: more calls, and longer ones.
    volumePct: 0.08,
    ahtPct: 0.06,
  },
];

const CHANNEL_WEIGHT: Readonly<Record<Channel, number>> = { voice: 0.62, chat: 0.25, deferred: 0.13 };
/** Chat grows and voice shrinks across the year. */
const CHANNEL_TREND: Readonly<Record<Channel, number>> = { voice: -0.03, chat: 0.06, deferred: 0 };
const PRIMARY_LANGUAGE_SHARE = 0.75;

const BASE_AHT: Readonly<Record<Channel, Readonly<Record<LineOfBusiness, number>>>> = {
  voice: { Mobile: 430, Internet: 510, Cable: 470 },
  chat: { Mobile: 620, Internet: 700, Cable: 660 },
  deferred: { Mobile: 300, Internet: 360, Cable: 330 },
};

const LOB_CODE: Readonly<Record<LineOfBusiness, string>> = { Mobile: 'MOB', Internet: 'INT', Cable: 'CAB' };
const CHANNEL_CODE: Readonly<Record<Channel, string>> = { voice: 'VO', chat: 'CH', deferred: 'DF' };

/** Smallest class a outsourcer runs. Smaller needs round up to it. */
export const MIN_CLASS_SIZE = 8;

/** A training room seats 30; a site runs at most two classes from one week. */
export const MAX_CLASS_SIZE = 30;
export const MAX_CLASSES_PER_WEEK = 2;

/** Weeks no class starts: trainers and recruits are on holiday. */
export const BLOCKED_WEEKS: Readonly<Record<number, string>> = {
  6: 'Lunar New Year',
  12: 'Holy Week',
  51: 'Christmas',
  52: 'New Year',
};

export const CONSTANTS: PlanConstants = {
  periodsPerMonth: WEEKS_PER_MONTH,
  trainingWeeks: 4,
  nestingWeeks: 2,
  trainingAttrition: 0.15,
  minClassSize: MIN_CLASS_SIZE,
  maxClassSize: MAX_CLASS_SIZE,
  maxClassesPerWeek: MAX_CLASSES_PER_WEEK,
  blockedWeeks: Object.keys(BLOCKED_WEEKS).map(Number),
  blockedWeekNames: BLOCKED_WEEKS,
  codes: {
    periodsPerMonth: 'GLB.PPM',
    trainingWeeks: 'GLB.TRW',
    nestingWeeks: 'GLB.NSW',
    trainingAttrition: 'GLB.TRA',
    minClassSize: 'GLB.MCS',
    maxClassSize: 'GLB.MXS',
    maxClassesPerWeek: 'GLB.MXW',
    blockedWeeks: 'GLB.BLK',
  },
};

export interface AssumptionRecord {
  code: string;
  label: string;
  value: number | null;
  unit: string;
  scope: string;
}

export interface UnitMeta extends PlanningUnit {
  lob: LineOfBusiness;
  language: Language;
  staffType: StaffType;
}

export interface Dataset {
  seed: number;
  plan: PlanInput;
  outsourcers: readonly Outsourcer[];
  units: readonly UnitMeta[];
  assumptions: readonly AssumptionRecord[];
}

export function buildDataset(seed = SEED): Dataset {
  const weeks: PlanWeek[] = Array.from({ length: HORIZON_WEEKS }, (_, i) => ({
    index: i + 1,
    label: periodLabel(ISO_YEAR, i + 1),
    start: toIsoDate(periodStart(ISO_YEAR, i + 1)),
  }));

  const committedWeeks = CONSTANTS.trainingWeeks + CONSTANTS.nestingWeeks;
  const sites: SiteInput[] = SITE_TABLE.map((row) => {
    const hires = Math.round(row.openingHeadcount * WEEKLY_HIRE_RATE);
    const pt = PART_TIME[row.id];
    return {
      ...row,
      ...(pt ? { partTimeWorkWeekHours: pt.hours } : {}),
      committedHires: weeks.map((wk) => (wk.index <= committedWeeks ? hires : 0)),
      codes: {
        workWeekHours: `${row.id}.WWK`,
        ...(pt ? { partTimeWorkWeekHours: `${row.id}.PTW` } : {}),
        occupancyCeiling: `${row.id}.OCC`,
        shrinkage: `${row.id}.SHR`,
        monthlyAttrition: `${row.id}.ATT`,
        cap: `${row.id}.CAP`,
        openingHeadcount: `${row.id}.HC0`,
        committedHires: `${row.id}.HIR`,
      },
    };
  });

  const units: UnitMeta[] = [];
  const demand: Record<string, DemandCell[]> = {};

  for (const site of sites) {
    const cov = coverageFor(site.id);
    const siteRand = streamFor(seed, `lob-mix:${site.id}`);
    const lobWeight = new Map(cov.lobs.map((lob) => [lob, between(siteRand, 0.7, 1.3)]));

    // Raw unit weights, then normalise to the site's season-neutral requirement.
    const drafts = cov.lobs.flatMap((lob) =>
      cov.languages.flatMap((language, li) =>
        cov.channels.map((channel) => {
          const id = `${site.id}-${LOB_CODE[lob]}-${language}-${CHANNEL_CODE[channel]}`;
          const rand = streamFor(seed, `unit:${id}`);
          const langShare =
            cov.languages.length === 1 ? 1 : li === 0 ? PRIMARY_LANGUAGE_SHARE : (1 - PRIMARY_LANGUAGE_SHARE) / (cov.languages.length - 1);
          const weight = (lobWeight.get(lob) ?? 1) * langShare * CHANNEL_WEIGHT[channel] * between(rand, 0.85, 1.15);
          const ahtJitter = between(rand, 0.94, 1.06) * (language === 'EN' ? 1 : 1.04);
          return { id, lob, language, channel, weight, baseAht: BASE_AHT[channel][lob] * ahtJitter };
        }),
      ),
    );
    const totalWeight = drafts.reduce((s, d) => s + d.weight, 0);
    const siteRequired = site.openingHeadcount * cov.loadFactor;

    const pt = PART_TIME[site.id];
    for (const d of drafts) {
      // A part-time programme takes a share of each voice and chat queue as a unit of its own.
      const split = pt && d.channel !== 'deferred' ? pt.share : 0;
      const kinds: { staffType: StaffType; id: string; share: number; hours: number }[] = [
        { staffType: 'full-time', id: d.id, share: 1 - split, hours: site.workWeekHours },
      ];
      if (split > 0) kinds.push({ staffType: 'part-time', id: `${d.id}-PT`, share: split, hours: pt!.hours });

      for (const k of kinds) {
        const unit: UnitMeta = { id: k.id, siteId: site.id, lob: d.lob, language: d.language, channel: d.channel, staffType: k.staffType };
        let handleSeconds = d.baseAht;
        if (d.channel === 'chat') {
          const c = cov.concurrency ?? 2;
          unit.concurrency = c;
          unit.codes = { concurrency: `${site.id}.CHC`, chatEfficiency: `GLB.CEF${c}` };
          handleSeconds = d.baseAht / (c * (DEFAULT_CHAT_EFFICIENCY[c] ?? 1));
        }
        units.push(unit);

        // Volume that produces this unit's share of the required requirement, at its own work week.
        const occ = d.channel === 'deferred' ? 1 : site.occupancyCeiling;
        const productiveHours = siteRequired * (d.weight / totalWeight) * k.share * (1 - site.shrinkage) * k.hours * occ;
        const baseVolume = (productiveHours * 3600) / handleSeconds;

        const noise = streamFor(seed, `weekly:${k.id}`);
        demand[k.id] = weeks.map((week, w) => {
          const season = SEASONALITY[w] ?? 1;
          const trend = 1 + CHANNEL_TREND[d.channel] * (w / (HORIZON_WEEKS - 1));
          const volume = Math.round(baseVolume * season * trend * between(noise, 0.975, 1.025));
          const aht = Math.round(d.baseAht * between(noise, 0.985, 1.015));
          return { volume, aht, source: `FC27.${k.id}.W${String(week.index).padStart(2, '0')}` };
        });
      }
    }
  }

  const plan: PlanInput = { isoYear: ISO_YEAR, weeks, constants: CONSTANTS, sites, units, demand, events: EVENTS };
  return { seed, plan, outsourcers: OUTSOURCERS, units, assumptions: assumptionRegister(sites) };
}

function coverageFor(siteId: string): Coverage {
  const cov = COVERAGE[siteId];
  if (!cov) throw new Error(`No coverage defined for site ${siteId}`);
  return cov;
}

function assumptionRegister(sites: readonly SiteInput[]): AssumptionRecord[] {
  const records: AssumptionRecord[] = [
    { code: 'GLB.PPM', label: 'Weeks per month', value: CONSTANTS.periodsPerMonth, unit: 'weeks', scope: 'Global' },
    { code: 'GLB.TRW', label: 'Training duration', value: CONSTANTS.trainingWeeks, unit: 'weeks', scope: 'Global' },
    { code: 'GLB.NSW', label: 'Nesting duration', value: CONSTANTS.nestingWeeks, unit: 'weeks', scope: 'Global' },
    { code: 'GLB.TRA', label: 'Training attrition', value: CONSTANTS.trainingAttrition, unit: 'ratio', scope: 'Global' },
    { code: 'GLB.MCS', label: 'Minimum class size', value: CONSTANTS.minClassSize, unit: 'heads', scope: 'Global' },
    { code: 'GLB.MXS', label: 'Maximum class size', value: MAX_CLASS_SIZE, unit: 'heads', scope: 'Global' },
    { code: 'GLB.MXW', label: 'Classes a site can start in one week', value: MAX_CLASSES_PER_WEEK, unit: 'classes', scope: 'Global' },
  ];
  records.push({ code: 'GLB.BLK', label: 'Weeks no class starts', value: Object.keys(BLOCKED_WEEKS).length, unit: 'weeks', scope: 'Global' });
  for (const [week, name] of Object.entries(BLOCKED_WEEKS)) {
    records.push({ code: `GLB.BLK.W${week.padStart(2, '0')}`, label: `No class starts: ${name}`, value: Number(week), unit: 'week', scope: 'Global' });
  }
  for (const c of [2, 3, 4]) {
    records.push({ code: `GLB.CEF${c}`, label: `Chat efficiency at concurrency ${c}`, value: DEFAULT_CHAT_EFFICIENCY[c] ?? null, unit: 'ratio', scope: 'Global' });
  }
  for (const e of EVENTS) {
    const scope = `${e.name}, W${String(e.fromWeek).padStart(2, '0')}–W${String(e.toWeek).padStart(2, '0')}`;
    if (e.volumePct) records.push({ code: `${e.code}.VOL`, label: 'Event effect on volume', value: e.volumePct, unit: 'ratio', scope });
    if (e.ahtPct) records.push({ code: `${e.code}.AHT`, label: 'Event effect on AHT', value: e.ahtPct, unit: 'ratio', scope });
  }
  for (const s of sites) {
    const scope = `${s.outsourcer} / ${s.name}`;
    records.push(
      { code: s.codes.workWeekHours, label: 'Work week, full-time', value: s.workWeekHours, unit: 'hours', scope },
      { code: s.codes.occupancyCeiling, label: 'Occupancy ceiling', value: s.occupancyCeiling, unit: 'ratio', scope },
      { code: s.codes.shrinkage, label: 'Shrinkage', value: s.shrinkage, unit: 'ratio', scope },
      { code: s.codes.monthlyAttrition, label: 'Monthly attrition', value: s.monthlyAttrition, unit: 'ratio', scope },
      { code: s.codes.cap, label: 'Contracted HC cap', value: s.cap, unit: 'heads', scope },
      { code: s.codes.openingHeadcount, label: 'Opening headcount, week 1', value: s.openingHeadcount, unit: 'heads', scope },
      { code: s.codes.committedHires, label: 'Committed hires per week, weeks 1 to 6', value: s.committedHires[0] ?? 0, unit: 'heads', scope },
    );
    if (s.codes.partTimeWorkWeekHours) {
      records.push({ code: s.codes.partTimeWorkWeekHours, label: 'Work week, part-time', value: s.partTimeWorkWeekHours ?? null, unit: 'hours', scope });
    }
    const conc = COVERAGE[s.id]?.concurrency;
    if (conc !== undefined && COVERAGE[s.id]?.channels.includes('chat')) {
      records.push({ code: `${s.id}.CHC`, label: 'Chat concurrency', value: conc, unit: 'sessions', scope });
    }
  }
  return records;
}

let cached: Dataset | undefined;

/** The demo dataset, built once. */
export function demoDataset(): Dataset {
  cached ??= buildDataset();
  return cached;
}
