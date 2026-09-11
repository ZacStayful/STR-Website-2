import type { BrokerMode, Budget, ProviderName } from './types.ts';

/**
 * The single place where provider priorities, costs, freshness and budgets
 * are edited. Env overrides let Zac tune without a deploy:
 *   BROKER_BUDGET_<PROVIDER>=pence/day (global)
 *   BROKER_MEMBER_BUDGET_<PROVIDER>=pence/day (per member)
 */

const DAY = 24 * 60 * 60 * 1000;

export const TTL = {
  ourData: 90 * DAY,
  airbticsBounds: 7 * DAY,
  pmiEstimate: 30 * DAY,
  pmiMarket: 7 * DAY,
  areaCards: 60 * 60 * 1000,
  // Shorter than the daily sourcing cron so cron jitter can never land on a
  // still-fresh answer from yesterday's run.
  sourcing: 20 * 60 * 60 * 1000,
} as const;

/** Pence per call. Real figures from the spike replace these estimates. */
export const COST_PENCE = {
  airbticsBounds: 5,
  airbticsReport: 40,
  // PMI bills credits: str-estimate 50, str/market 3, listings 1. At the
  // Starter tier (£28/month) a credit is roughly 1.5p; the spike refines this.
  pmiEstimate: 75,
  pmiMarket: 5,
  pmiListings: 2,
  onthemarketFetch: 0,
} as const;

/** Highest ladder level each mode may climb. */
export const MAX_LEVEL: Record<BrokerMode, 1 | 2 | 3 | 4> = { quick: 3, full: 4, cron: 3 };

const DEFAULT_BUDGETS: Record<ProviderName, Budget> = {
  internal: { globalPence: Number.MAX_SAFE_INTEGER, memberPence: Number.MAX_SAFE_INTEGER },
  google: { globalPence: Number.MAX_SAFE_INTEGER, memberPence: Number.MAX_SAFE_INTEGER },
  airbtics: { globalPence: 2000, memberPence: 150 }, // £20/day, £1.50 per member
  pmi: { globalPence: 1500, memberPence: 100 },
  propertydata: { globalPence: 2000, memberPence: 200 },
  onthemarket: { globalPence: 100000, memberPence: 1000 }, // counts fetches, not money
  airroi: { globalPence: 500, memberPence: 50 },
};

function envInt(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function budgetFor(provider: ProviderName): Budget {
  const d = DEFAULT_BUDGETS[provider];
  const up = provider.toUpperCase();
  return {
    globalPence: envInt(`BROKER_BUDGET_${up}`) ?? d.globalPence,
    memberPence: envInt(`BROKER_MEMBER_BUDGET_${up}`) ?? d.memberPence,
  };
}

export function providerEnabled(provider: ProviderName): boolean {
  switch (provider) {
    case 'airbtics':
      return Boolean(process.env.AIRBTICS_API_KEY);
    case 'pmi':
      return Boolean(process.env.PMI_API_KEY);
    case 'propertydata':
      return Boolean(process.env.PROPERTYDATA_API_KEY);
    case 'google':
      return Boolean(process.env.GOOGLE_PLACES_API_KEY);
    case 'airroi':
      return Boolean(process.env.AIRROI_API_KEY);
    case 'onthemarket':
      return process.env.LISTING_SERVER_FETCH !== 'false';
    case 'internal':
      return true;
  }
}
