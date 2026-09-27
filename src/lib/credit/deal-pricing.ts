/**
 * Batch 10 pricing: the fixed prices for deals in the feed, what one member
 * will actually pay for them with the credit they hold, and the rules for
 * plan credit and daily deals.
 *
 * The prices themselves live in `billing_settings` (full_analysis_pence,
 * pmi_addon_pence, todays_5_daily_pence, plan_credit_pence, ...). What is
 * here are the fallbacks for when that table cannot be read, the parsers
 * that read it defensively, and the arithmetic.
 *
 * A price is quoted in BASE pence (the plan price). What leaves a member's
 * balance is FACE pence: base × the spend rate of whichever grant pays it.
 * `allocate` walks the member's grants exactly as `credit_debit` does, so the
 * price on a button is the price the ledger takes, including a balance that
 * is part plan and part top-up, and grants bought at an older rate.
 *
 * Pure: no server-only, relative `.ts` imports only, so it runs under
 * `node --test`.
 */

import { round4 } from './pricing.ts';

// ── Settings ──

export interface DealPricing {
  /** A full analysis of a deal in the feed, base pence. The Quick look price is included, not added. */
  fullAnalysisPence: number;
  /** The PMI second opinion added to a full analysis, base pence. */
  pmiAddonPence: number;
  /** One day of daily deals (Today's 5), charged on days it is delivered, base pence. */
  todays5DailyPence: number;
  /** How old a saved analysis of a deal may be and still be reused, in days. */
  analysisReuseDays: number;
  /** Monthly plan credit from the new pricing date on, by plan code (pence). */
  planCreditPence: Record<string, number>;
  /**
   * When 1:1 plan credit and the daily deals charge start (ISO date). Null
   * until it is set on /admin/billing: until then plans keep their old credit
   * and picks are charged as they always were.
   */
  newPricingFrom: string | null;
  /** Half-width of the area-estimate profit range, by screening confidence, in percent. */
  profitRangePct: { high: number; medium: number; low: number };
}

export const DEFAULT_DEAL_PRICING: DealPricing = {
  fullAnalysisPence: 400,
  pmiAddonPence: 200,
  todays5DailyPence: 33,
  analysisReuseDays: 30,
  planCreditPence: { starter: 1900, pro: 3999, scale: 9900, pro_annual: 3000 },
  newPricingFrom: null,
  profitRangePct: { high: 10, medium: 15, low: 25 },
};

/** The widest a range may be, either side, whatever the setting says. */
export const MAX_RANGE_PCT = 25;

/** A positive price, or the fallback: a bad setting must never make something free. */
export function parsePence(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? round4(n) : fallback;
}

/** A whole number of days, at least one, or the fallback. */
export function parseDays(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

/** { code: pence } with only positive prices kept. Anything malformed falls back whole. */
export function parsePlanCredit(raw: unknown, fallback: Record<string, number> = DEFAULT_DEAL_PRICING.planCreditPence): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...fallback };
  const out: Record<string, number> = {};
  for (const [code, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(v);
    if (code && Number.isFinite(n) && n > 0) out[code] = Math.round(n);
  }
  return Object.keys(out).length > 0 ? out : { ...fallback };
}

/** An ISO date or date-time, or null. JSON null, '' and nonsense all read as "not set". */
export function parseDateSetting(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Range half-widths, each clamped to 0–25%. A missing band takes the default. */
export function parseRangePct(raw: unknown, fallback = DEFAULT_DEAL_PRICING.profitRangePct): { high: number; medium: number; low: number } {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const one = (k: 'high' | 'medium' | 'low') => {
    const n = Number(o[k]);
    return Number.isFinite(n) && n >= 0 ? Math.min(MAX_RANGE_PCT, n) : fallback[k];
  };
  return { high: one('high'), medium: one('medium'), low: one('low') };
}

// ── What a member pays: the grant walk ──

/** One credit grant as `credit_debit` sees it. */
export interface GrantLite {
  id: string;
  kind: string;
  /** plan 1, welcome 2, top-up / adjustment 3. */
  priority: number;
  remainingPence: number;
  /** Frozen when the grant was made: face pence taken per base penny. */
  spendRate: number;
  expiresAt: string | null;
  createdAt: string;
}

export interface QuotePart {
  grantId: string;
  kind: string;
  basePence: number;
  facePence: number;
  rate: number;
}

export interface Quote {
  basePence: number;
  /** What leaves the member's balance. */
  facePence: number;
  parts: QuotePart[];
  /** Base pence the grants cannot cover. 0 when the member can afford it. */
  shortfallBasePence: number;
}

const time = (iso: string | null): number => {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
};

/**
 * The grants a debit of `basePence` would take, in the order and at the
 * rates `credit_debit` (supabase/schema.sql) takes them: priority, then
 * expiry (none last), then age; expired and empty grants skipped; each grant
 * at its own frozen rate. The negative overdraft grant is never walked.
 */
export function allocate(grants: readonly GrantLite[], basePence: number, now: Date = new Date()): Quote {
  const want = round4(Math.max(0, basePence));
  const live = grants
    .filter((g) => g.remainingPence > 0 && g.spendRate > 0 && (g.expiresAt === null || time(g.expiresAt) > now.getTime()))
    .slice()
    .sort((a, b) => a.priority - b.priority || time(a.expiresAt) - time(b.expiresAt) || time(a.createdAt) - time(b.createdAt));
  let remaining = want;
  let face = 0;
  const parts: QuotePart[] = [];
  for (const g of live) {
    if (remaining <= 0) break;
    const takeBase = Math.min(remaining, round4(g.remainingPence / g.spendRate));
    if (takeBase <= 0) continue;
    const takeFace = Math.min(g.remainingPence, round4(takeBase * g.spendRate));
    parts.push({ grantId: g.id, kind: g.kind, basePence: round4(takeBase), facePence: round4(takeFace), rate: g.spendRate });
    face += takeFace;
    remaining = round4(remaining - takeBase);
  }
  return { basePence: want, facePence: round4(face), parts, shortfallBasePence: remaining > 0.0001 ? round4(remaining) : 0 };
}

/** "£4", "£5.20", "78p", "43p": whole pence, pounds shown only from £1. */
export function formatPence(pence: number): string {
  const p = Math.round(Math.max(0, pence));
  if (p < 100) return `${p}p`;
  return p % 100 === 0 ? `£${p / 100}` : `£${(p / 100).toFixed(2)}`;
}

const BUCKET_WORDS: Record<string, string> = { plan: 'plan credit', welcome: 'welcome credit', topup: 'top-up credit', adjustment: 'promo credit' };

export interface PriceLabel {
  /** What this member pays: "£5.20". Empty for an admin. */
  main: string;
  /** "£4 on a plan", when any of it is paid above the plan rate. */
  nudge: string | null;
  /** "£1.50 plan credit + £3.25 top-up credit", when more than one kind of credit pays. */
  split: string | null;
  /**
   * 'ok' can pay; 'short' cannot (the button then leads to Top up / Upgrade
   * and shows the plan price); 'admin' is never charged.
   */
  state: 'ok' | 'short' | 'admin';
  /** Face pence this member pays; the plan price when short; 0 for an admin. */
  facePence: number;
  basePence: number;
}

/**
 * The words on a price button. A member paying only from plan or welcome
 * credit sees the price; one paying any of it from top-up (or promo) credit
 * sees what they will actually pay and, next to it, the plan price.
 * `spendableBasePence` (after open reservations) decides 'short' together
 * with the walk, so a balance held by a report in flight is not offered.
 */
export function priceLabel(quote: Quote, opts: { admin?: boolean; spendableBasePence?: number } = {}): PriceLabel {
  if (opts.admin) return { main: '', nudge: null, split: null, state: 'admin', facePence: 0, basePence: quote.basePence };
  const short = quote.shortfallBasePence > 0 || (typeof opts.spendableBasePence === 'number' && opts.spendableBasePence + 0.0001 < quote.basePence);
  if (quote.basePence <= 0) return { main: 'Free', nudge: null, split: null, state: 'ok', facePence: 0, basePence: 0 };
  if (short) return { main: formatPence(quote.basePence), nudge: null, split: null, state: 'short', facePence: quote.basePence, basePence: quote.basePence };
  const aboveRate = quote.parts.some((p) => p.rate > 1 + 1e-9);
  const byKind = new Map<string, number>();
  for (const p of quote.parts) byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + p.facePence);
  const split = byKind.size > 1 ? [...byKind.entries()].map(([k, v]) => `${formatPence(v)} ${BUCKET_WORDS[k] ?? 'credit'}`).join(' + ') : null;
  return {
    main: formatPence(quote.facePence),
    nudge: aboveRate ? `${formatPence(quote.basePence)} on a plan` : null,
    split,
    state: 'ok',
    facePence: round4(quote.facePence),
    basePence: quote.basePence,
  };
}

/** Which kind of credit a quote draws on, for wording: 'plan' | 'welcome' | 'topup' | 'mixed' | 'none'. */
export function quoteSource(quote: Quote): 'plan' | 'welcome' | 'topup' | 'mixed' | 'none' {
  const kinds = new Set(quote.parts.map((p) => (p.kind === 'adjustment' ? 'topup' : p.kind)));
  if (kinds.size === 0) return 'none';
  if (kinds.size > 1) return 'mixed';
  const [only] = [...kinds];
  return only === 'plan' || only === 'welcome' || only === 'topup' ? only : 'mixed';
}

// ── Full analysis ──

export interface FullAnalysisDue {
  /** The analysis itself: the fixed price less what this account paid to open the deal. */
  analysisBasePence: number;
  pmiBasePence: number;
  totalBasePence: number;
}

/**
 * What a full analysis of a feed deal costs this account, in base pence.
 * Every full analysis totals the fixed price: a Quick look already paid for
 * this deal comes off it (never below 0), whenever it was paid — a deal
 * opened before these prices, or opened as a daily pick, counts what it
 * actually cost. The PMI add-on is on top, and never reduced.
 */
export function fullAnalysisDue(input: { fullPence: number; openPaidBasePence: number | null | undefined; withPmi: boolean; pmiPence: number }): FullAnalysisDue {
  const paid = Number.isFinite(Number(input.openPaidBasePence)) ? Math.max(0, Number(input.openPaidBasePence)) : 0;
  const analysis = round4(Math.max(0, input.fullPence - paid));
  const pmi = input.withPmi ? round4(Math.max(0, input.pmiPence)) : 0;
  return { analysisBasePence: analysis, pmiBasePence: pmi, totalBasePence: round4(analysis + pmi) };
}

// ── Plan credit and the new-pricing date ──

/** True from the moment the new pricing date passes. False while it is unset. */
export function newPricingActive(pricing: Pick<DealPricing, 'newPricingFrom'>, at: Date = new Date()): boolean {
  if (!pricing.newPricingFrom) return false;
  const from = Date.parse(pricing.newPricingFrom);
  return Number.isFinite(from) && at.getTime() >= from;
}

/**
 * A plan's monthly credit for a billing period starting at `periodStart`.
 * Existing subscribers change at their next renewal, never mid-period: a
 * period that began before the new pricing date keeps the old credit
 * (`billing_plans.monthly_credit_pence`). For the annual plan the period is
 * the subscription YEAR, so its monthly slots keep the old credit until the
 * first annual renewal on or after the date.
 */
export function planCreditFor(plan: { code: string; monthlyCreditPence: number }, periodStart: Date, pricing: Pick<DealPricing, 'newPricingFrom' | 'planCreditPence'>): number {
  if (!newPricingActive(pricing, periodStart)) return plan.monthlyCreditPence;
  const next = pricing.planCreditPence[plan.code];
  return typeof next === 'number' && Number.isFinite(next) && next > 0 ? next : plan.monthlyCreditPence;
}

/** Days of daily deals in a month, for "about £10 a month". */
export const DAILY_DEALS_MONTH_DAYS = 30;

/** How many full analyses a month of plan credit covers once daily deals are paid for. Whole, never negative. */
export function fullAnalysesIncluded(planCreditPence: number, pricing: Pick<DealPricing, 'todays5DailyPence' | 'fullAnalysisPence'>): number {
  if (!(pricing.fullAnalysisPence > 0)) return 0;
  const left = planCreditPence - DAILY_DEALS_MONTH_DAYS * Math.max(0, pricing.todays5DailyPence);
  return Math.max(0, Math.floor(left / pricing.fullAnalysisPence + 1e-9));
}

/** "about £10 a month" for the daily price. */
export function dailyDealsMonthly(dailyPence: number): string {
  return `about ${formatPence(Math.round((DAILY_DEALS_MONTH_DAYS * Math.max(0, dailyPence)) / 100) * 100)} a month`;
}

/** Whole days of daily deals the spendable balance covers, or null when there is no daily price. */
export function dailyDealsDaysLeft(spendableBasePence: number, dailyPence: number): number | null {
  if (!(dailyPence > 0)) return null;
  return Math.max(0, Math.floor(Math.max(0, spendableBasePence) / dailyPence + 1e-9));
}

// ── Notice before the new prices ──

/** Members are told at least this many days before plan credit and daily deals change. */
export const PRICING_NOTICE_DAYS = 14;

/**
 * The earliest the new pricing date may be: 14 days after the LAST member
 * was sent the notice (a notice sent over several days counts from its last
 * send), and never less than 14 days from now while no notice has gone.
 */
export function earliestPricingDateFrom(latestNoticeAt: Date | null, now: Date = new Date()): Date {
  const clock = latestNoticeAt ?? now;
  return new Date(Math.max(now.getTime(), clock.getTime() + PRICING_NOTICE_DAYS * 24 * 60 * 60 * 1000));
}
