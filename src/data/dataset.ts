/**
 * Demo dataset, brief section 4. Every figure is invented.
 *
 * Deterministic: seasonality is a fixed table and all variation comes from
 * seeded integer streams, so output is identical on every run and engine.
 */
import type { Channel, DemandCell, PlanConstants, PlanInput, PlanWeek, PlanningUnit, SiteInput } from '../engine/index.ts';
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

export type LineOfBusiness = (typeof LINES_OF_BUSINESS)[number];
export type Language = (typeof LANGUAGES)[number];

export const VENDORS = ['Teleperformance', 'Telus International', 'Accenture', 'In-house'] as const;
export type Vendor = (typeof VENDORS)[number];

interface SiteRow {
  id: string;
  vendor: Vendor;
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
  { id: 'MNL1', vendor: 'Teleperformance', name: 'Manila-1', country: 'PH', workWeekHours: 45.0, occupancyCeiling: 0.85, shrinkage: 0.305, monthlyAttrition: 0.052, cap: 980, openingHeadcount: 944 },
  { id: 'MNL2', vendor: 'Teleperformance', name: 'Manila-2', country: 'PH', workWeekHours: 45.0, occupancyCeiling: 0.85, shrinkage: 0.298, monthlyAttrition: 0.049, cap: null, openingHeadcount: 808 },
  { id: 'CAI', vendor: 'Teleperformance', name: 'Cairo', country: 'EG', workWeekHours: 42.5, occupancyCeiling: 0.85, shrinkage: 0.284, monthlyAttrition: 0.041, cap: null, openingHeadcount: 522 },
  { id: 'KIN', vendor: 'Telus International', name: 'Kingston', country: 'JM', workWeekHours: 40.0, occupancyCeiling: 0.85, shrinkage: 0.312, monthlyAttrition: 0.058, cap: 520, openingHeadcount: 433 },
  { id: 'CAN', vendor: 'Telus International', name: 'Guangzhou', country: 'CN', workWeekHours: 44.0, occupancyCeiling: 0.85, shrinkage: 0.276, monthlyAttrition: 0.037, cap: null, openingHeadcount: 581 },
  { id: 'SZX', vendor: 'Accenture', name: 'Shenzhen', country: 'CN', workWeekHours: 44.0, occupancyCeiling: 0.85, shrinkage: 0.271, monthlyAttrition: 0.035, cap: null, openingHeadcount: 621 },
  { id: 'MEX', vendor: 'Accenture', name: 'Mexico City', country: 'MX', workWeekHours: 42.0, occupancyCeiling: 0.85, shrinkage: 0.319, monthlyAttrition: 0.061, cap: null, openingHeadcount: 579 },
  { id: 'YYZ', vendor: 'In-house', name: 'Toronto', country: 'CA', workWeekHours: 37.5, occupancyCeiling: 0.82, shrinkage: 0.246, monthlyAttrition: 0.022, cap: null, openingHeadcount: 267 },
];

interface Coverage {
  lobs: readonly LineOfBusiness[];
  /** Primary language first. */
  languages: readonly Language[];
  channels: readonly Channel[];
  /** Chat sessions per agent, where the site runs chat. */
  concurrency?: number;
  /** Rostered requirement in a season-neutral week, as a multiple of opening HC. */
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
 * Weekly demand index for 2027. Annual cycle peaking in January, a summer
 * trough, a marketing spike in weeks 31 to 34 and a year-end lift from week 46.
 */
export const SEASONALITY: readonly number[] = [
  1.069, 1.070, 1.069, 1.068, 1.065, 1.062, 1.058, 1.052, 1.046, 1.040, 1.033, 1.025, 1.017,
  1.008, 1.000, 0.992, 0.983, 0.975, 0.967, 0.960, 0.954, 0.948, 0.942, 0.938, 0.935, 0.932,
  0.931, 0.930, 0.931, 0.932, 1.055, 1.138, 1.112, 1.028, 0.954, 0.960, 0.967, 0.975, 0.983,
  0.992, 1.000, 1.008, 1.017, 1.025, 1.033, 1.065, 1.096, 1.127, 1.158, 1.187, 1.215, 1.243,
];

export const MARKETING_SPIKE_WEEKS: readonly number[] = [31, 32, 33, 34];

/** Handle time rises during the spike while customers ask about the new offer. */
const SPIKE_AHT_LIFT = 0.04;

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

export const CONSTANTS: PlanConstants = {
  periodsPerMonth: WEEKS_PER_MONTH,
  trainingWeeks: 4,
  nestingWeeks: 2,
  trainingAttrition: 0.15,
  codes: {
    periodsPerMonth: 'GLB.PPM',
    trainingWeeks: 'GLB.TRW',
    nestingWeeks: 'GLB.NSW',
    trainingAttrition: 'GLB.TRA',
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
}

export interface Dataset {
  seed: number;
  plan: PlanInput;
  vendors: readonly Vendor[];
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
    return {
      ...row,
      committedHires: weeks.map((wk) => (wk.index <= committedWeeks ? hires : 0)),
      codes: {
        workWeekHours: `${row.id}.WWK`,
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
    const siteRostered = site.openingHeadcount * cov.loadFactor;

    for (const d of drafts) {
      const unit: UnitMeta = { id: d.id, siteId: site.id, lob: d.lob, language: d.language, channel: d.channel };
      let handleSeconds = d.baseAht;
      if (d.channel === 'chat') {
        const c = cov.concurrency ?? 2;
        unit.concurrency = c;
        unit.codes = { concurrency: `${site.id}.CHC`, chatEfficiency: `GLB.CEF${c}` };
        handleSeconds = d.baseAht / (c * (DEFAULT_CHAT_EFFICIENCY[c] ?? 1));
      }
      units.push(unit);

      // Volume that produces this unit's share of the rostered requirement.
      const occ = d.channel === 'deferred' ? 1 : site.occupancyCeiling;
      const productiveHours = siteRostered * (d.weight / totalWeight) * (1 - site.shrinkage) * site.workWeekHours * occ;
      const baseVolume = (productiveHours * 3600) / handleSeconds;

      const noise = streamFor(seed, `weekly:${d.id}`);
      demand[d.id] = weeks.map((week, w) => {
        const season = SEASONALITY[w] ?? 1;
        const trend = 1 + CHANNEL_TREND[d.channel] * (w / (HORIZON_WEEKS - 1));
        const volume = Math.round(baseVolume * season * trend * between(noise, 0.975, 1.025));
        const spike = MARKETING_SPIKE_WEEKS.includes(week.index) ? 1 + SPIKE_AHT_LIFT : 1;
        const aht = Math.round(d.baseAht * spike * between(noise, 0.985, 1.015));
        return { volume, aht, source: `FC27.${d.id}.W${String(week.index).padStart(2, '0')}` };
      });
    }
  }

  const plan: PlanInput = { isoYear: ISO_YEAR, weeks, constants: CONSTANTS, sites, units, demand };
  return { seed, plan, vendors: VENDORS, units, assumptions: assumptionRegister(sites) };
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
  ];
  for (const c of [2, 3, 4]) {
    records.push({ code: `GLB.CEF${c}`, label: `Chat efficiency at concurrency ${c}`, value: DEFAULT_CHAT_EFFICIENCY[c] ?? null, unit: 'ratio', scope: 'Global' });
  }
  for (const s of sites) {
    const scope = `${s.vendor} / ${s.name}`;
    records.push(
      { code: s.codes.workWeekHours, label: 'Work week', value: s.workWeekHours, unit: 'hours', scope },
      { code: s.codes.occupancyCeiling, label: 'Occupancy ceiling', value: s.occupancyCeiling, unit: 'ratio', scope },
      { code: s.codes.shrinkage, label: 'Shrinkage', value: s.shrinkage, unit: 'ratio', scope },
      { code: s.codes.monthlyAttrition, label: 'Monthly attrition', value: s.monthlyAttrition, unit: 'ratio', scope },
      { code: s.codes.cap, label: 'Contracted HC cap', value: s.cap, unit: 'heads', scope },
      { code: s.codes.openingHeadcount, label: 'Opening headcount, week 1', value: s.openingHeadcount, unit: 'heads', scope },
      { code: s.codes.committedHires, label: 'Committed hires per week, weeks 1 to 6', value: s.committedHires[0] ?? 0, unit: 'heads', scope },
    );
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
