/**
 * Batch 22f: what a funnel lead costs the funnel's owner — volume tiers.
 *
 * Each lead is priced by its own number in the owner's UK calendar month
 * (a team counts once: the funnel's owner pays): leads 1–20 at £5.00, 21–60
 * at £4.00, 61–150 at £3.25, 151 and on at £2.50, and an enhanced report adds
 * £2.00 at every tier. Lead 21 is the first at £4.00. The numbers live in
 * billing_settings (`funnel_tiers`, `funnel_enhanced_extra_pence`); the
 * defaults below are the same rows, for a database that has not been told.
 *
 * The tier price is the BASE price, spent exactly like every other charge:
 * plan credit and the starter pack's bonus at 1×, top-up credit at 1.3×. No
 * ledger change: one `credit_debit` per lead, made by the
 * `funnel_lead_charge` SQL function, which numbers the lead and charges it in
 * one statement so two leads finishing together never share a number.
 *
 * What counts: a CHARGED lead — a report that ran, qualified or not (held and
 * unqualified leads count). A repeat submission reusing an earlier report, a
 * failed run and a preview are never charged and never counted. API reports
 * (/api/v1/analyse) and members' own analyses are untouched: funnel_markup
 * still prices those doors, and legacy funnel owners until their notice runs
 * out (see pricingFor).
 *
 * For later batches:
 *   - Batches 23/25: never call a stamped management company (profiles.
 *     signup_path = 'management') about investor deals unless daily picks
 *     are on. Batch 23's intro and low-credit calls already skip them while
 *     deal-finding is off (src/lib/voice/eligibility.ts).
 *   - Batch 29: the win-back excludes live funnel owners.
 *
 * Pure: no network, no database, no server-only.
 */

export interface FunnelTier {
  /** The first lead number in the month this price applies to. */
  from: number;
  /** Base pence per standard lead. */
  pence: number;
}

export interface FunnelTierSettings {
  tiers: FunnelTier[];
  /** Base pence an enhanced report adds at every tier. */
  enhancedExtraPence: number;
  /** When tier pricing started: owners with a funnel from before it are legacy until notified. */
  tiersFrom: Date | null;
  /** Days of notice a legacy owner gets after the funnel-price email. */
  noticeDays: number;
}

export const DEFAULT_FUNNEL_TIERS: readonly FunnelTier[] = [
  { from: 1, pence: 500 },
  { from: 21, pence: 400 },
  { from: 61, pence: 325 },
  { from: 151, pence: 250 },
];
export const DEFAULT_ENHANCED_EXTRA_PENCE = 200;
export const DEFAULT_NOTICE_DAYS = 30;

export const DEFAULT_FUNNEL_TIER_SETTINGS: FunnelTierSettings = {
  tiers: [...DEFAULT_FUNNEL_TIERS],
  enhancedExtraPence: DEFAULT_ENHANCED_EXTRA_PENCE,
  tiersFrom: null,
  noticeDays: DEFAULT_NOTICE_DAYS,
};

/**
 * The tier list from its billing_settings value, or the defaults when it is
 * missing or malformed. Valid means: starts at lead 1, strictly increasing
 * `from`, whole positive pence. A half-valid list is never used, so a typo
 * in the admin can never make a tier free.
 */
export function parseTiers(raw: unknown): FunnelTier[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_FUNNEL_TIERS];
  const out: FunnelTier[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') return [...DEFAULT_FUNNEL_TIERS];
    const from = Number((r as Record<string, unknown>).from);
    const pence = Number((r as Record<string, unknown>).pence);
    if (!Number.isInteger(from) || from < 1 || !Number.isFinite(pence) || pence <= 0) return [...DEFAULT_FUNNEL_TIERS];
    if (out.length > 0 && from <= out[out.length - 1].from) return [...DEFAULT_FUNNEL_TIERS];
    out.push({ from, pence: Math.round(pence) });
  }
  return out[0].from === 1 ? out : [...DEFAULT_FUNNEL_TIERS];
}

function parseWholePence(raw: unknown, fallback: number): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

function parseDate(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t) : null;
}

/** The four settings from billing_settings rows (a key → value reader). */
export function parseTierSettings(get: (key: string) => unknown): FunnelTierSettings {
  const days = parseWholePence(get('funnel_notice_days'), DEFAULT_NOTICE_DAYS);
  return {
    tiers: parseTiers(get('funnel_tiers')),
    enhancedExtraPence: parseWholePence(get('funnel_enhanced_extra_pence'), DEFAULT_ENHANCED_EXTRA_PENCE),
    tiersFrom: parseDate(get('funnel_tiers_from')),
    noticeDays: days > 0 ? days : DEFAULT_NOTICE_DAYS,
  };
}

/** The tier lead number `n` (1-based) falls in. */
export function tierFor(n: number, tiers: readonly FunnelTier[] = DEFAULT_FUNNEL_TIERS): FunnelTier {
  const lead = Math.max(1, Math.floor(Number.isFinite(n) ? n : 1));
  let found = tiers[0];
  for (const t of tiers) if (lead >= t.from) found = t;
  return found;
}

/** Base pence for the month's `n`th lead. */
export function priceForLead(n: number, enhanced: boolean, s: Pick<FunnelTierSettings, 'tiers' | 'enhancedExtraPence'> = DEFAULT_FUNNEL_TIER_SETTINGS): number {
  return tierFor(n, s.tiers).pence + (enhanced ? s.enhancedExtraPence : 0);
}

/** The next tier after the one lead `n` is in, or null at the last. */
export function nextTier(n: number, tiers: readonly FunnelTier[] = DEFAULT_FUNNEL_TIERS): FunnelTier | null {
  const lead = Math.max(1, Math.floor(Number.isFinite(n) ? n : 1));
  return tiers.find((t) => t.from > lead) ?? null;
}

/** What `pence` of base price takes from credit spent at `rate` (top-up: 1.3), whole pence. */
export function withRate(pence: number, rate: number): number {
  const r = Number.isFinite(rate) && rate > 0 ? rate : 1;
  return Math.round(pence * r);
}

/** "£5.00". */
export function money(pence: number): string {
  return `£${(Math.round(pence) / 100).toFixed(2)}`;
}

/** "£5.00 a lead (£6.50 from top-up credit)". */
export function bothRates(pence: number, topupRate: number): string {
  return `${money(pence)} a lead (${money(withRate(pence, topupRate))} from top-up credit)`;
}

/**
 * The UK calendar month an instant falls in, as 'YYYY-MM-01' — the same key
 * the SQL counter uses (date_trunc on now() at time zone 'Europe/London').
 */
export function ukMonthKey(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit' }).formatToParts(at);
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  return `${y}-${m}-01`;
}

/** Base pence for a whole month of `leads` leads, each at its own tier. */
export function monthCost(leads: number, enhanced: boolean, s: Pick<FunnelTierSettings, 'tiers' | 'enhancedExtraPence'> = DEFAULT_FUNNEL_TIER_SETTINGS): number {
  const n = Math.max(0, Math.floor(Number.isFinite(leads) ? leads : 0));
  let total = 0;
  for (let i = 1; i <= n; i++) total += priceForLead(i, enhanced, s);
  return total;
}

/**
 * Usage's line: "This month: 34 leads · £4.00 a lead now · 27 more to reach
 * £3.25". `count` is the leads charged so far this month; "now" is the price
 * of the next one, and "N more" counts to the first lead at the next tier.
 */
export function usageLine(count: number, enhanced: boolean, s: Pick<FunnelTierSettings, 'tiers' | 'enhancedExtraPence'> = DEFAULT_FUNNEL_TIER_SETTINGS): string {
  const c = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
  const nextLead = c + 1;
  const parts = [`This month: ${c} ${c === 1 ? 'lead' : 'leads'}`, `${money(priceForLead(nextLead, enhanced, s))} a lead now`];
  const up = nextTier(nextLead, s.tiers);
  if (up) parts.push(`${up.from - c} more to reach ${money(up.pence + (enhanced ? s.enhancedExtraPence : 0))}`);
  return parts.join(' · ');
}

/**
 * Which pricing an owner is on. 'legacy' (metered at funnel_markup, as before
 * Batch 22f) only for an owner whose first funnel predates tier pricing and
 * who has not yet had 30 days since their funnel-price email — so nobody's
 * price changes without notice. Everyone else, including every new owner, is
 * on tiers. Without a start date (schema not run) everyone stays legacy:
 * nothing changes until the switch is made.
 */
export function pricingFor(o: { firstFunnelAt: Date | null; noticeSentAt: Date | null; now?: Date }, s: Pick<FunnelTierSettings, 'tiersFrom' | 'noticeDays'>): 'tiers' | 'legacy' {
  if (!s.tiersFrom) return 'legacy';
  const now = o.now ?? new Date();
  if (!o.firstFunnelAt || o.firstFunnelAt.getTime() >= s.tiersFrom.getTime()) return 'tiers';
  if (!o.noticeSentAt) return 'legacy';
  return now.getTime() >= o.noticeSentAt.getTime() + s.noticeDays * 86_400_000 ? 'tiers' : 'legacy';
}

/** The date a notified legacy owner moves to tiers. */
export function tiersStartFor(noticeSentAt: Date, noticeDays: number): Date {
  return new Date(noticeSentAt.getTime() + noticeDays * 86_400_000);
}

/**
 * About how many leads at `leadPence` the starter pack pays for: its bonus
 * (welcome credit, 1×) and its paid part (top-up credit, at the top-up rate).
 * Rounded down, because the copy says "about" and must never overpromise:
 * £20 bonus + £10 at 1.3× ≈ £27.69 of base credit → about 5 leads at £5.00.
 */
export function leadsFromPack(g: { topupPence: number; bonusPence: number }, rates: { welcome: number; topup: number }, leadPence: number): number {
  if (!(leadPence > 0)) return 0;
  const base = g.bonusPence / (rates.welcome > 0 ? rates.welcome : 1) + g.topupPence / (rates.topup > 0 ? rates.topup : 1);
  return Math.floor(base / leadPence);
}
