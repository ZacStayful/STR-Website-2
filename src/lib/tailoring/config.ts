/**
 * Every number Batch 14's tailoring runs on, in one place. Nothing here is
 * admin-editable: a change is a code change, reviewed and tested. The one
 * setting tailoring reads from billing_settings is Batch 10's profit range
 * width (profit_range_pct), because the cards already show that range and
 * the "minimum profit" check must judge the same figure the card shows.
 *
 * Pure: no network, no database, no server-only.
 */

export const TAILORING = {
  /**
   * How far back a Keep, an own open or a Full analysis counts as "what I
   * liked", and how far back the behaviour prompts look. The same 60 days as
   * the "Not for me" feedback window (FEEDBACK_WINDOW_MS in listing/rank.ts).
   */
  signalWindowDays: 60,

  /** The most rows the tailored path reads to rank (kind, visibility and passes only). */
  poolLimit: 1000,
  /** Deals whose full listing is read at once for the last feedback pass, as the untailored path. */
  fullListingBatch: 40,

  /** "Fit for you": each named adjustment moves a deal at most this far either way… */
  adjustmentCap: 10,
  /** …and all of them together at most this far. */
  adjustmentTotalCap: 30,

  /** Cash-flow goal: points per 1% of cash-on-cash, and per £100 a month of cash flow, each capped at half the adjustment. */
  cashflowGoal: { pointsPerCashOnCashPct: 1 / 3, pointsPerHundredPcm: 1, eachCap: 5 },
  /** Growth goal: points per 1% of the area's 5-year growth, and per 1% below the area's typical value for the size. */
  growthGoal: { pointsPerGrowthPct: 1 / 4, pointsPerBelowTypicalPct: 1 / 4, eachCap: 5 },
  /** Cautious members and beginners: up for the steadiest income estimate and a low break-even, down for renovation or auction wording. */
  steady: { confidencePoints: 5, breakEvenLowPct: 50, breakEvenLowPoints: 5, breakEvenMidPct: 60, breakEvenMidPoints: 3, workPoints: -10 },
  /** "Go for it": motivated sellers up, and renovation wording not held against a deal. */
  bold: { motivationPointsPer10: 1 },
  /** Near the member's operations: full points within `fullMiles` of an area they run units in, none from `zeroMiles`. Management companies count 1.5×. */
  operations: { fullMiles: 10, zeroMiles: 40, points: 10, managerMultiplier: 1.5 },
  /** Deal sourcers: motivated sellers up; room below the area's typical value at least their fee. */
  sourcer: { motivationPointsPer10: 1, roomPoints: 5 },
  /** Similar to what the member liked: points per shared attribute with any signal, capped. */
  similarity: { perAttribute: 3, cap: 10, priceBandPct: 20 },

  /** "Near me + the best elsewhere": local slots, then national ones; either fills from the other when short. */
  nearPlusBest: { local: 3, national: 2 },

  /** Match %: shown once at least this many of the member's criteria apply to a deal. */
  matchMinChecked: 2,

  /** Behaviour prompts: Keeps against an answer before asking, how often one question may be asked, and the quiet spell after "keep my answer". */
  prompts: { minContradictions: 3, repeatDays: 7, afterKeepDays: 30 },

  /** Widen and see: suggestions shown at most, and the size of each step offered. */
  widen: { maxSuggestions: 3, milesStep: 10, maxMiles: 100, rentStepPcm: 250, profitStepPcm: 100, cashStep: 'next band' as const },

  /** Browse's "Best for you": how long a member's order for one search is kept, so pages never shuffle or repeat. */
  browse: { cacheSeconds: 300 },

  /** The minimum monthly profit when the member has not given one: Batch 12's own default. */
  fallbackMinProfitPcm: 500,

  /** A cash-available band's top, the most the member can put in (null: no ceiling). */
  cashAvailableTop: { u30: 30_000, '30-60': 60_000, '60-100': 100_000, '100-200': 200_000, '200+': null },
  /** A setup budget band's top (null: no ceiling). */
  setupBudgetTop: { u3k: 3_000, '3-6k': 6_000, '6-10k': 10_000, '10k+': null },
  /** The room below the area's typical value that covers a sourcer's fee: the top of their band ("£4k or more" reads as £4k). */
  sourcingFeeRoom: { u2k: 2_000, '2-4k': 4_000, '4k+': 4_000 },
} as const;
