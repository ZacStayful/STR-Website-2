import type { Question } from './types.ts';
import { COST_PENCE, TTL } from './config.ts';
import {
  longLetAttemptParams,
  normalisePostcode,
  saleAttemptParams,
  type CouncilTaxData,
  type DemandKind,
  type DemandSnapshot,
  type Designation,
  type DesignationField,
  type EpcEntry,
  type FloodRisk,
  type FloorAreaEntry,
  type KeyStatsRow,
  type ListedBuilding,
  type MortgageRates,
  type RentValuation,
  type RentValuationOptions,
  type SaleValuation,
  type StampDutyResult,
} from '../apis/propertydata-parse.ts';

/**
 * The PropertyData questions, built from an injectable client so the ladder
 * (keys, TTLs, attempt order, what is and is not cached) is unit-testable
 * with fake fetchers. `questions-propertydata.ts` binds them to the real,
 * metered client; nothing else should construct them.
 *
 * Every rung is level 3 and costs one credit (`COST_PENCE.propertydataCall`)
 * except the region key stats, which cost thirty and are bought only by
 * the market-warm cron; reports read them cache-only. Level 3 rather than
 * 4 so the cron mode (max level 3) can buy the key stats and a quick view
 * can share an outcode-level answer; the budget and the TTLs are what keep
 * spend in check, not the level.
 */

export type StampDutyMode = 'investment' | 'primary' | 'first_time' | 'non_resi';

export interface StampDutyQuery {
  value: number;
  /** PropertyData's country slug: england, wales, scotland or northern_ireland. */
  country: string;
  mode: StampDutyMode;
  ukResident?: boolean;
}

export interface PdClient {
  floorAreas(postcode: string): Promise<FloorAreaEntry[] | null>;
  valuationRent(params: Record<string, string>, opts?: PdCallOptions): Promise<RentValuation | null>;
  valuationSale(params: Record<string, string>): Promise<SaleValuation | null>;
  stampDuty(query: StampDutyQuery): Promise<StampDutyResult | null>;
  mortgageRates(): Promise<MortgageRates | null>;
  councilTax(postcode: string): Promise<CouncilTaxData | null>;
  energyEfficiency(postcode: string): Promise<EpcEntry[] | null>;
  floodRisk(postcode: string): Promise<FloodRisk | null>;
  designation(postcode: string, field: DesignationField): Promise<Designation | null>;
  listedBuildings(postcode: string): Promise<ListedBuilding[] | null>;
  demand(outcode: string, kind: DemandKind): Promise<DemandSnapshot | null>;
  keyStats(region: string): Promise<KeyStatsRow[] | null>;
}

/** Per-call knobs a question may pass to the client; never part of a cache key. */
export interface PdCallOptions {
  /** Overrides the client's default request timeout. */
  timeoutMs?: number;
}

export interface PostcodeParams {
  postcode: string;
}

export interface OutcodeParams {
  outcode: string;
}

export interface LongLetRentParams {
  postcode: string;
  bedrooms: number;
  options?: RentValuationOptions;
  /**
   * How far down the attempt ladder to go (default: all six). The explorer's
   * hourly build asks for one, so an area PropertyData cannot value costs one
   * credit a day, not six an hour. Not part of the key: a rent is the same
   * answer however many attempts it took.
   */
  maxAttempts?: number;
  /** Per-attempt timeout for callers with a time budget (the cron); not part of the key. */
  timeoutMs?: number;
}

/** The rent plus which attempt answered (1 = the member's own details). */
export interface LongLetRentAnswer extends RentValuation {
  attempt: number;
}

export interface SaleValuationParams {
  postcode: string;
  bedrooms: number;
  propertyType: string;
}

export type StampDutyParams = StampDutyQuery;

export interface RegionParams {
  region: string;
}

export interface PdQuestions {
  pdFloorAreas: Question<PostcodeParams, FloorAreaEntry[]>;
  pdLongLetRent: Question<LongLetRentParams, LongLetRentAnswer>;
  pdSaleValuation: Question<SaleValuationParams, SaleValuation>;
  pdStampDuty: Question<StampDutyParams, StampDutyResult>;
  pdMortgageRates: Question<Record<string, never>, MortgageRates>;
  pdCouncilTax: Question<PostcodeParams, CouncilTaxData>;
  pdEnergyEfficiency: Question<PostcodeParams, EpcEntry[]>;
  pdFloodRisk: Question<PostcodeParams, FloodRisk>;
  pdConservationArea: Question<PostcodeParams, Designation>;
  pdGreenBelt: Question<PostcodeParams, Designation>;
  pdAonb: Question<PostcodeParams, Designation>;
  pdNationalPark: Question<PostcodeParams, Designation>;
  pdListedBuildings: Question<PostcodeParams, ListedBuilding[]>;
  pdDemandSale: Question<OutcodeParams, DemandSnapshot>;
  pdDemandRent: Question<OutcodeParams, DemandSnapshot>;
  pdRegionKeyStats: Question<RegionParams, KeyStatsRow[]>;
}

const pc = (p: PostcodeParams) => normalisePostcode(p.postcode);
const oc = (p: OutcodeParams) => p.outcode.replace(/\s+/g, '').toUpperCase();

function rentKey(p: LongLetRentParams): string {
  const o = p.options ?? {};
  const areaBucket = o.internalArea ? Math.round(o.internalArea / 100) * 100 : '';
  return [normalisePostcode(p.postcode), p.bedrooms, o.propertyType ?? '', o.constructionDate ?? '', areaBucket, o.bathrooms ?? '', o.finishQuality ?? '', o.outdoorSpace ?? '', o.offStreetParking ?? ''].join('|');
}

function postcodeQuestion<T>(name: string, ttlMs: number, run: (postcode: string) => Promise<T | null>): Question<PostcodeParams, T> {
  return {
    name,
    key: pc,
    rungs: [{ provider: 'propertydata', level: 3, costPence: COST_PENCE.propertydataCall, ttlMs, run: (p) => run(p.postcode) }],
  };
}

export function pdQuestions(client: PdClient): PdQuestions {
  return {
    pdFloorAreas: postcodeQuestion('pdFloorAreas', TTL.pdPostcode, (postcode) => client.floorAreas(postcode)),

    pdLongLetRent: {
      name: 'pdLongLetRent',
      key: rentKey,
      rungs: [
        {
          provider: 'propertydata',
          level: 3,
          // One credit per attempt; the ladder sees the first attempt's cost
          // for budgeting and the meter charges each attempt as it happens.
          costPence: COST_PENCE.propertydataCall,
          ttlMs: TTL.pdValuation,
          run: async (p) => {
            const attempts = longLetAttemptParams(p.postcode, p.bedrooms, p.options).slice(0, Math.max(1, p.maxAttempts ?? Number.MAX_SAFE_INTEGER));
            const opts = p.timeoutMs ? { timeoutMs: p.timeoutMs } : undefined;
            for (let i = 0; i < attempts.length; i++) {
              const v = await client.valuationRent(attempts[i], opts);
              if (v) return { ...v, attempt: i + 1 };
            }
            // Null on purpose: the national-median fallback is the caller's,
            // and must never be cached as if PropertyData had said it.
            return null;
          },
        },
      ],
    },

    pdSaleValuation: {
      name: 'pdSaleValuation',
      key: (p) => `${normalisePostcode(p.postcode)}|${p.bedrooms}|${p.propertyType}`,
      rungs: [
        {
          provider: 'propertydata',
          level: 3,
          costPence: COST_PENCE.propertydataCall,
          ttlMs: TTL.pdValuation,
          run: async (p) => {
            for (const params of saleAttemptParams(p.postcode, p.bedrooms, p.propertyType)) {
              const v = await client.valuationSale(params);
              if (v) return v;
            }
            return null;
          },
        },
      ],
    },

    pdStampDuty: {
      name: 'pdStampDuty',
      // The month is part of the key: the calculator prices for today, and a
      // figure cached before a budget's rate change must not outlive it.
      key: (p) => `${p.country}|${p.mode}|${p.ukResident === false ? 'nonres' : 'res'}|${Math.round(p.value)}|${new Date().toISOString().slice(0, 7)}`,
      rungs: [{ provider: 'propertydata', level: 3, costPence: COST_PENCE.propertydataCall, ttlMs: TTL.pdStampDuty, run: (p) => client.stampDuty(p) }],
    },

    pdMortgageRates: {
      name: 'pdMortgageRates',
      key: () => 'uk',
      rungs: [{ provider: 'propertydata', level: 3, costPence: COST_PENCE.propertydataCall, ttlMs: TTL.pdMortgageRates, run: () => client.mortgageRates() }],
    },

    pdCouncilTax: postcodeQuestion('pdCouncilTax', TTL.pdPostcode, (postcode) => client.councilTax(postcode)),
    pdEnergyEfficiency: postcodeQuestion('pdEnergyEfficiency', TTL.pdPostcode, (postcode) => client.energyEfficiency(postcode)),
    pdFloodRisk: postcodeQuestion('pdFloodRisk', TTL.pdPostcode, (postcode) => client.floodRisk(postcode)),
    pdConservationArea: postcodeQuestion('pdConservationArea', TTL.pdPostcode, (postcode) => client.designation(postcode, 'conservation_area')),
    pdGreenBelt: postcodeQuestion('pdGreenBelt', TTL.pdPostcode, (postcode) => client.designation(postcode, 'green_belt')),
    pdAonb: postcodeQuestion('pdAonb', TTL.pdPostcode, (postcode) => client.designation(postcode, 'aonb')),
    pdNationalPark: postcodeQuestion('pdNationalPark', TTL.pdPostcode, (postcode) => client.designation(postcode, 'national_park')),
    pdListedBuildings: postcodeQuestion('pdListedBuildings', TTL.pdPostcode, (postcode) => client.listedBuildings(postcode)),

    pdDemandSale: {
      name: 'pdDemandSale',
      key: oc,
      rungs: [{ provider: 'propertydata', level: 3, costPence: COST_PENCE.propertydataCall, ttlMs: TTL.pdDemand, run: (p) => client.demand(oc(p), 'sale') }],
    },
    pdDemandRent: {
      name: 'pdDemandRent',
      key: oc,
      rungs: [{ provider: 'propertydata', level: 3, costPence: COST_PENCE.propertydataCall, ttlMs: TTL.pdDemand, run: (p) => client.demand(oc(p), 'rent') }],
    },

    pdRegionKeyStats: {
      name: 'pdRegionKeyStats',
      key: (p) => p.region.trim().toLowerCase(),
      rungs: [{ provider: 'propertydata', level: 3, costPence: COST_PENCE.propertydataKeyStats, ttlMs: TTL.pdKeyStats, run: (p) => client.keyStats(p.region.trim().toLowerCase()) }],
    },
  };
}
