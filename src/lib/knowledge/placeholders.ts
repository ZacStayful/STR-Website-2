/**
 * Batch 24: every {placeholder} and {#condition} a knowledge answer may use,
 * and how each is resolved when the answer is shown.
 *
 * Global values are read from the raw settings rows (billing_settings,
 * billing_plans, unit_costs) with no defaults: a row that is missing or not
 * a valid value resolves to null, and an approved answer that uses it is
 * marked stale and hidden until Zac approves it again. That is what a
 * renamed or removed setting looks like here. Each value is worked out the
 * way the product charges it (the same formatter, the same ladder, the same
 * call-minute row), so an answer can never quote a price the site doesn't
 * charge.
 *
 * Member values come from the member's own state (the Stayful Intelligence
 * view works them out once, in view-server.ts). They are never available on
 * a call: a caller is identified by caller ID alone, which can be faked
 * (persona rule phone_no_figures), so an entry allowed on calls may only use
 * global placeholders.
 *
 * Pure: no network, no database, no server-only.
 */
import { formatPence } from '../credit/deal-pricing.ts';
import { BALANCE_BANDS_PENCE, PRODUCT_FACTS, TEAM_EMAIL } from './config.ts';

/** One billing_plans row, as read. */
export interface PlanRow {
  code: string;
  pricePence: number;
  interval: string;
  active: boolean;
}

/** One unit_costs row, as read. */
export interface UnitRow {
  unitCostPence: number;
  markup: number;
}

/** Everything a global placeholder may read, taken in one go when an answer is shown. */
export interface GlobalSnapshot {
  /** billing_settings key → value, exactly as stored (a JSON null is present, not missing). */
  settings: ReadonlyMap<string, unknown>;
  plans: readonly PlanRow[];
  /** `${provider}:${unit}` → the row. */
  units: ReadonlyMap<string, UnitRow>;
  /** Calls are switched on for members (SI_CALLS_ENABLED). */
  callsLive: boolean;
}

/** A member's own values, for the view and (Batch 26) the chat. Never on a call. */
export interface MemberValues {
  balancePence: number | null;
  /** Live deals ranked for them today; null when there is no stored count. */
  checked: number | null;
  tailored: boolean;
  alertsByText: boolean;
  freeMember: boolean;
  /** Batch 20's pack is on and not bought. */
  packAvailable: boolean;
  /** The welcome price on their revealed deals and the day it ends; null outside the window. */
  welcome: { fullPence: number; until: string } | null;
  /** The first deep report's price, when they haven't had one. */
  firstDeepPence: number | null;
  /** Part F's line, when nothing (or little) matches. */
  noMatch: string | null;
}

export type Scope = 'global' | 'member';

export interface PlaceholderDef {
  /** What it is, for the admin catalogue and the drafting model. */
  label: string;
  scope: Scope;
  /** Where the value comes from, for the admin catalogue. */
  reads: string;
  resolve: (g: GlobalSnapshot, m: MemberValues | null) => string | null;
}

export interface ConditionDef {
  label: string;
  scope: Scope;
  resolve: (g: GlobalSnapshot, m: MemberValues | null) => boolean | null;
}

// ── Reading raw values strictly ─────────────────────────────────────────────

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const raw = (g: GlobalSnapshot, key: string): unknown => (g.settings.has(key) ? g.settings.get(key) : undefined);
/** A price in pence: present, a number, above zero. */
const pence = (g: GlobalSnapshot, key: string): number | null => {
  const n = num(raw(g, key));
  return n !== null && n > 0 ? n : null;
};
/** A whole number at least `min`. */
const whole = (g: GlobalSnapshot, key: string, min: number): number | null => {
  const n = num(raw(g, key));
  return n !== null && Number.isInteger(n) && n >= min ? n : null;
};

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
/** Small counts in words ("five"), larger ones in figures ("1,284"). */
export function countWords(n: number): string {
  return Number.isInteger(n) && n >= 0 && n < WORDS.length ? WORDS[n] : Math.round(n).toLocaleString('en-GB');
}

export const money = (p: number | null): string | null => (p === null ? null : formatPence(p));

/** "£10, £25 or £50". */
export function moneyList(ps: readonly number[]): string {
  const xs = ps.map(formatPence);
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;
}

/** 9 → "9am", 19 → "7pm", 12 → "noon". */
export function hourWords(h: number): string {
  if (h === 0 || h === 24) return 'midnight';
  if (h === 12) return 'noon';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** [1..5] → "weekdays"; [1..6] → "Monday to Saturday"; anything else listed. */
export function dayWords(days: readonly number[]): string {
  const ds = [...new Set(days)].sort((a, b) => a - b);
  if (ds.join() === '1,2,3,4,5') return 'weekdays';
  if (ds.join() === '0,1,2,3,4,5,6') return 'every day';
  const consecutive = ds.every((d, i) => i === 0 || d === ds[i - 1] + 1);
  if (consecutive && ds.length > 2) return `${DAY[ds[0]]} to ${DAY[ds[ds.length - 1]]}`;
  const names = ds.map((d) => `${DAY[d]}s`);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The open-price ladder's cheapest and dearest bands, read strictly (any malformed band → null). */
function ladderBounds(g: GlobalSnapshot): { min: number; max: number } | null {
  const v = raw(g, 'deal_open_ladder');
  if (!Array.isArray(v) || v.length === 0) return null;
  const prices: number[] = [];
  let open = false;
  for (const band of v) {
    if (!band || typeof band !== 'object') return null;
    const p = num((band as Record<string, unknown>).pence);
    if (p === null || p <= 0) return null;
    if ((band as Record<string, unknown>).upTo === null || (band as Record<string, unknown>).upTo === undefined) open = true;
    prices.push(p);
  }
  if (!open) return null;
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

function presets(g: GlobalSnapshot): number[] | null {
  const v = raw(g, 'topup_presets_pence');
  if (!Array.isArray(v) || v.length === 0) return null;
  const ps = v.map(num);
  if (ps.some((p) => p === null || p <= 0)) return null;
  return (ps as number[]).sort((a, b) => a - b);
}

function topupRate(g: GlobalSnapshot): number | null {
  const v = raw(g, 'spend_rates');
  if (!v || typeof v !== 'object') return null;
  const r = num((v as Record<string, unknown>).topup);
  return r !== null && r > 0 ? r : null;
}

function lowestMonthlyPlan(g: GlobalSnapshot): number | null {
  const ps = g.plans.filter((p) => p.active && p.interval === 'month' && Number.isFinite(p.pricePence) && p.pricePence > 0).map((p) => p.pricePence);
  return ps.length ? Math.min(...ps) : null;
}

/** What members pay for a call minute: the si:call_minute row × its markup (the same sum the charge uses). */
function callMinutePence(g: GlobalSnapshot): number | null {
  const row = g.units.get('si:call_minute');
  if (!row || !(row.unitCostPence > 0) || !(row.markup > 0)) return null;
  return Math.round(row.unitCostPence * row.markup * 10_000) / 10_000;
}

function outboundHours(g: GlobalSnapshot): { start: number; end: number } | null {
  const start = whole(g, 'si_outbound_start_hour', 0);
  const end = whole(g, 'si_outbound_end_hour', 1);
  if (start === null || end === null || start >= end || end > 24) return null;
  return { start, end };
}

function outboundDays(g: GlobalSnapshot): number[] | null {
  const v = raw(g, 'si_outbound_weekdays');
  if (!Array.isArray(v) || v.length === 0) return null;
  const ds = v.map(num);
  if (ds.some((d) => d === null || !Number.isInteger(d) || d < 0 || d > 6)) return null;
  return ds as number[];
}

function balanceBand(p: number): string {
  const [low, high] = BALANCE_BANDS_PENCE;
  if (p < low) return `under ${formatPence(low)}`;
  if (p <= high) return `between ${formatPence(low)} and ${formatPence(high)}`;
  return `over ${formatPence(high)}`;
}

// ── The registry ────────────────────────────────────────────────────────────

const g_ = (label: string, reads: string, resolve: (g: GlobalSnapshot) => string | null): PlaceholderDef => ({ label, scope: 'global', reads, resolve: (g) => resolve(g) });
const m_ = (label: string, reads: string, resolve: (m: MemberValues) => string | null): PlaceholderDef => ({ label, scope: 'member', reads, resolve: (_g, m) => (m ? resolve(m) : null) });

export const PLACEHOLDERS: Readonly<Record<string, PlaceholderDef>> = {
  // Credit and plans
  welcome_credit: g_('Free credit every new account gets', 'billing_settings.welcome_grant_pence', (g) => money(pence(g, 'welcome_grant_pence'))),
  lowest_plan_cost: g_("The cheapest monthly plan's price", 'billing_plans (active, monthly)', (g) => money(lowestMonthlyPlan(g))),
  min_topup: g_('The smallest top-up', 'billing_settings.topup_presets_pence', (g) => money(presets(g)?.[0] ?? null)),
  topup_amounts: g_('Every top-up amount, listed', 'billing_settings.topup_presets_pence', (g) => {
    const ps = presets(g);
    return ps ? moneyList(ps) : null;
  }),
  topup_rate: g_("Top-up credit's spend rate against plan credit, e.g. 1.3×", 'billing_settings.spend_rates.topup', (g) => {
    const r = topupRate(g);
    return r === null ? null : `${r}×`;
  }),
  auto_topup_amount: g_('What auto top-up adds', 'billing_settings.reveal_auto_topup_amount_pence', (g) => money(pence(g, 'reveal_auto_topup_amount_pence'))),
  auto_topup_threshold: g_('The balance auto top-up tops up below', 'billing_settings.reveal_auto_topup_threshold_pence', (g) => money(pence(g, 'reveal_auto_topup_threshold_pence'))),
  pack_cost: g_("The starter pack's price", 'billing_settings.starter_pack_price_pence', (g) => money(pence(g, 'starter_pack_price_pence'))),
  pack_credit: g_('The credit the starter pack gives', 'billing_settings.starter_pack_credit_pence', (g) => money(pence(g, 'starter_pack_credit_pence'))),
  profile_credit: g_('The one-off credit for a complete profile', 'billing_settings.profile_complete_pence', (g) => money(pence(g, 'profile_complete_pence'))),
  // Deals and reports
  open_cost_min: g_('The cheapest price to open a deal', 'billing_settings.deal_open_ladder', (g) => money(ladderBounds(g)?.min ?? null)),
  open_cost_max: g_('The dearest price to open a deal', 'billing_settings.deal_open_ladder', (g) => money(ladderBounds(g)?.max ?? null)),
  full_analysis_cost: g_("A Full analysis's price", 'billing_settings.full_analysis_pence', (g) => money(pence(g, 'full_analysis_pence'))),
  pmi_addon_cost: g_("PMI's second opinion's price, added to a Full analysis", 'billing_settings.pmi_addon_pence', (g) => money(pence(g, 'pmi_addon_pence'))),
  deep_report_cost: g_('A deep report (Full analysis + PMI)', 'billing_settings.full_analysis_pence + pmi_addon_pence', (g) => {
    const f = pence(g, 'full_analysis_pence');
    const p = pence(g, 'pmi_addon_pence');
    return f === null || p === null ? null : formatPence(f + p);
  }),
  analyses_in_welcome: g_('How many Full analyses the free credit covers, in words', 'welcome_grant_pence ÷ full_analysis_pence', (g) => {
    const w = pence(g, 'welcome_grant_pence');
    const f = pence(g, 'full_analysis_pence');
    return w === null || f === null ? null : countWords(Math.floor(w / f));
  }),
  deep_reports_in_welcome: g_('How many deep reports the free credit covers, in words', 'welcome_grant_pence ÷ (full + pmi)', (g) => {
    const w = pence(g, 'welcome_grant_pence');
    const f = pence(g, 'full_analysis_pence');
    const p = pence(g, 'pmi_addon_pence');
    return w === null || f === null || p === null ? null : countWords(Math.floor(w / (f + p)));
  }),
  analysis_reuse_days: g_('Days a saved analysis is reused free', 'billing_settings.analysis_reuse_days', (g) => {
    const d = whole(g, 'analysis_reuse_days', 1);
    return d === null ? null : String(d);
  }),
  daily_deals_cost: g_('Daily deals (Today’s 5) per day', 'billing_settings.todays_5_daily_pence', (g) => money(pence(g, 'todays_5_daily_pence'))),
  free_delay_hours: g_('Hours a free member waits to see a new deal', 'billing_settings.free_deal_delay_hours', (g) => {
    const h = whole(g, 'free_deal_delay_hours', 1);
    return h === null ? null : String(h);
  }),
  saved_profiles_max: g_('Saved profiles a member may keep, in words', 'billing_settings.saved_profiles_max', (g) => {
    const n = whole(g, 'saved_profiles_max', 1);
    return n === null ? null : countWords(n);
  }),
  sms_monthly_cap: g_('Alert texts a month at most, in words', 'billing_settings.sms_monthly_cap', (g) => {
    const n = whole(g, 'sms_monthly_cap', 1);
    return n === null ? null : countWords(n);
  }),
  // Calls
  call_minute_cost: g_('What an answered call costs a minute', 'unit_costs si:call_minute × markup', (g) => money(callMinutePence(g))),
  text_cost: g_('A text from Stayful Intelligence', 'billing_settings.si_text_pence', (g) => money(pence(g, 'si_text_pence'))),
  email_cost: g_('An email from Stayful Intelligence after a missed call', 'billing_settings.si_email_pence', (g) => money(pence(g, 'si_email_pence'))),
  call_hours_start: g_('When outbound calls start, e.g. 9am', 'billing_settings.si_outbound_start_hour', (g) => {
    const h = outboundHours(g);
    return h ? hourWords(h.start) : null;
  }),
  call_hours_end: g_('When outbound calls stop, e.g. 7pm', 'billing_settings.si_outbound_end_hour', (g) => {
    const h = outboundHours(g);
    return h ? hourWords(h.end) : null;
  }),
  call_days: g_('The days outbound calls happen, e.g. weekdays', 'billing_settings.si_outbound_weekdays', (g) => {
    const d = outboundDays(g);
    return d ? dayWords(d) : null;
  }),
  // Fixed product facts (src/lib/knowledge/config.ts)
  report_sections: g_("A Full analysis report's sections", 'config PRODUCT_FACTS.reportSections', () => String(PRODUCT_FACTS.reportSections)),
  forecast_months: g_("The forecast's months", 'config PRODUCT_FACTS.forecastMonths', () => String(PRODUCT_FACTS.forecastMonths)),
  management_fee: g_("Stayful Management's fee", 'config PRODUCT_FACTS.managementFeePct', () => `${PRODUCT_FACTS.managementFeePct}% + VAT`),
  ledger_properties: g_('Properties in the methodology ledger, in words', 'config PRODUCT_FACTS.ledgerProperties', () => countWords(PRODUCT_FACTS.ledgerProperties)),
  ledger_year: g_('The year the ledger covers', 'config PRODUCT_FACTS.ledgerYear', () => String(PRODUCT_FACTS.ledgerYear)),
  team_email: g_('The Stayful team’s email address', 'config TEAM_EMAIL', () => TEAM_EMAIL),

  // The member's own (view and chat only, never a call)
  balance: m_('Their exact credit balance', 'the member’s credit', (m) => money(m.balancePence)),
  credit_balance_band: m_('Their credit as a band (under £5 …)', 'the member’s credit', (m) => (m.balancePence === null ? null : balanceBand(m.balancePence))),
  checked_count: m_('Live deals ranked for them today', 'Today’s stored count', (m) => (m.checked === null ? null : m.checked.toLocaleString('en-GB'))),
  welcome_cost: m_('Their welcome price on revealed deals', 'the member’s offer', (m) => money(m.welcome?.fullPence ?? null)),
  welcome_until: m_('The day their welcome price ends', 'the member’s offer', (m) => m.welcome?.until ?? null),
  first_deep_cost: m_('Their first deep report’s price', 'the member’s offer', (m) => money(m.firstDeepPence)),
  no_match_line: m_('What would find them a match (Part F)', 'the member’s profile', (m) => m.noMatch),
};

export const CONDITIONS: Readonly<Record<string, ConditionDef>> = {
  calls_live: { label: 'Calls are switched on (SI_CALLS_ENABLED)', scope: 'global', resolve: (g) => g.callsLive },
  welcome_offer: { label: 'They have a welcome price running', scope: 'member', resolve: (_g, m) => (m ? m.welcome !== null : null) },
  first_deep_offer: { label: 'Their first deep report is discounted', scope: 'member', resolve: (_g, m) => (m ? m.firstDeepPence !== null : null) },
  alerts_by_text: { label: 'Their alerts also come by text', scope: 'member', resolve: (_g, m) => (m ? m.alertsByText : null) },
  tailored: { label: 'Their picks use their answers (tailoring)', scope: 'member', resolve: (_g, m) => (m ? m.tailored : null) },
  pack_available: { label: 'The starter pack is on and not bought', scope: 'member', resolve: (_g, m) => (m ? m.packAvailable : null) },
  free_delay_applies: {
    label: 'They are a free member and new deals wait for free members',
    scope: 'member',
    resolve: (g, m) => {
      if (!m) return null;
      const h = whole(g, 'free_deal_delay_hours', 0);
      return h === null ? null : m.freeMember && h > 0;
    },
  },
  no_match: { label: 'Nothing (or little) matches them today', scope: 'member', resolve: (_g, m) => (m ? m.noMatch !== null : null) },
};

export const isPlaceholder = (name: string): boolean => Object.prototype.hasOwnProperty.call(PLACEHOLDERS, name);
export const isCondition = (name: string): boolean => Object.prototype.hasOwnProperty.call(CONDITIONS, name);

/** The placeholders an entry allowed on calls may use: every global one. Fixed in code, so the call's variable list never depends on what is approved. */
export const CALL_PLACEHOLDERS: readonly string[] = Object.keys(PLACEHOLDERS).filter((n) => PLACEHOLDERS[n].scope === 'global');
