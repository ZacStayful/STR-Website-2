/**
 * Batch 22's numbers: the signup reveal, the accuracy levels, the member
 * searches, the welcome and first-time prices and the call prices. Every one
 * is a billing_settings row (seeded by the "Batch 22: signup reveal" schema
 * section; the money ones are edited on /admin/billing, the thresholds by
 * SQL); this module is the one place they are parsed, with the brief's
 * defaults.
 *
 *   reveal_from                    accounts created at or after it get the reveal.
 *                                  Empty = nobody does (the section has not run).
 *   accuracy_advanced_pct          Advanced: real optional answers ≥ this share
 *   reveal_low_match_pct           a tailored #1 under this is "the closest I have"
 *   reveal_small_count             under this many checked, said plainly
 *   strong_match_pct / _min_checked  a strong match: no must-have missed, at least
 *                                  this many checks, at least this %
 *   signup_search_cap_pence        layer 2's raw-cost cap per member
 *   signup_thin_stock              fewer live deals of a kind than this: thin
 *   signup_search_fresh_hours      an area searched within this is not searched again
 *   signup_confirm_live_max        finds confirmed live at once
 *   signup_income_checks_max       finds given the income check
 *   signup_search_monthly_cap_pence  all signup searches in a calendar month
 *   member_search_confirms_per_hour  live confirmations across all member searches
 *   deep_search_markup             the deep search's price = raw cost × this
 *   deep_search_max_raw_pence      one deep search's raw-cost cap
 *   deep_search_monthly_cap_pence  all deep searches in a calendar month
 *   deep_search_first_discount_pct the first deep search's discount
 *   deep_search_nearby_areas       nearby areas a deep search adds
 *   reveal_analysis_discount_pct   the welcome price's discount
 *   reveal_welcome_days            how long the welcome price lasts
 *   deep_first_run_extra_pence     the first deep report: full + this
 *   reveal_auto_topup_*            the auto top-up offered after reports
 *   si_call_pence_per_min, si_text_pence, si_email_pence  the call box's prices
 *
 * Pure: no network, no database, no server-only.
 */
import { parseDateSetting } from '../credit/deal-pricing.ts';

export interface IntelligenceSettings {
  revealFrom: string | null;
  accuracyAdvancedPct: number;
  revealLowMatchPct: number;
  revealSmallCount: number;
  strongMatchPct: number;
  strongMatchMinChecked: number;
  signupSearchCapPence: number;
  signupThinStock: number;
  signupSearchFreshHours: number;
  signupConfirmLiveMax: number;
  signupIncomeChecksMax: number;
  signupSearchMonthlyCapPence: number;
  memberSearchConfirmsPerHour: number;
  deepSearchMarkup: number;
  deepSearchMaxRawPence: number;
  deepSearchMonthlyCapPence: number;
  deepSearchFirstDiscountPct: number;
  deepSearchNearbyAreas: number;
  revealAnalysisDiscountPct: number;
  revealWelcomeDays: number;
  deepFirstRunExtraPence: number;
  revealAutoTopupAmountPence: number;
  revealAutoTopupThresholdPence: number;
  siCallPencePerMin: number;
  siTextPence: number;
  siEmailPence: number;
}

export const INTELLIGENCE_KEYS = {
  revealFrom: 'reveal_from',
  accuracyAdvancedPct: 'accuracy_advanced_pct',
  revealLowMatchPct: 'reveal_low_match_pct',
  revealSmallCount: 'reveal_small_count',
  strongMatchPct: 'strong_match_pct',
  strongMatchMinChecked: 'strong_match_min_checked',
  signupSearchCapPence: 'signup_search_cap_pence',
  signupThinStock: 'signup_thin_stock',
  signupSearchFreshHours: 'signup_search_fresh_hours',
  signupConfirmLiveMax: 'signup_confirm_live_max',
  signupIncomeChecksMax: 'signup_income_checks_max',
  signupSearchMonthlyCapPence: 'signup_search_monthly_cap_pence',
  memberSearchConfirmsPerHour: 'member_search_confirms_per_hour',
  deepSearchMarkup: 'deep_search_markup',
  deepSearchMaxRawPence: 'deep_search_max_raw_pence',
  deepSearchMonthlyCapPence: 'deep_search_monthly_cap_pence',
  deepSearchFirstDiscountPct: 'deep_search_first_discount_pct',
  deepSearchNearbyAreas: 'deep_search_nearby_areas',
  revealAnalysisDiscountPct: 'reveal_analysis_discount_pct',
  revealWelcomeDays: 'reveal_welcome_days',
  deepFirstRunExtraPence: 'deep_first_run_extra_pence',
  revealAutoTopupAmountPence: 'reveal_auto_topup_amount_pence',
  revealAutoTopupThresholdPence: 'reveal_auto_topup_threshold_pence',
  siCallPencePerMin: 'si_call_pence_per_min',
  siTextPence: 'si_text_pence',
  siEmailPence: 'si_email_pence',
} as const satisfies Record<keyof IntelligenceSettings, string>;

export const DEFAULT_INTELLIGENCE: IntelligenceSettings = {
  revealFrom: null,
  accuracyAdvancedPct: 50,
  revealLowMatchPct: 70,
  revealSmallCount: 20,
  strongMatchPct: 90,
  strongMatchMinChecked: 5,
  signupSearchCapPence: 50,
  signupThinStock: 5,
  signupSearchFreshHours: 24,
  signupConfirmLiveMax: 5,
  signupIncomeChecksMax: 3,
  signupSearchMonthlyCapPence: 2000,
  memberSearchConfirmsPerHour: 40,
  deepSearchMarkup: 5,
  deepSearchMaxRawPence: 300,
  deepSearchMonthlyCapPence: 5000,
  deepSearchFirstDiscountPct: 50,
  deepSearchNearbyAreas: 3,
  revealAnalysisDiscountPct: 50,
  revealWelcomeDays: 7,
  deepFirstRunExtraPence: 100,
  revealAutoTopupAmountPence: 2500,
  revealAutoTopupThresholdPence: 500,
  siCallPencePerMin: 65,
  siTextPence: 22,
  siEmailPence: 20,
};

function numberIn(raw: unknown, min: number, max: number, fallback: number, whole = true): number {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  if (whole && !Number.isInteger(n)) return fallback;
  return n;
}

/** The settings from billing_settings' key/value rows; a malformed value falls back to its default. */
export function parseIntelligence(get: (key: string) => unknown): IntelligenceSettings {
  const d = DEFAULT_INTELLIGENCE;
  const k = INTELLIGENCE_KEYS;
  const pct = (key: keyof IntelligenceSettings) => numberIn(get(k[key]), 0, 100, d[key] as number);
  const count = (key: keyof IntelligenceSettings, min = 0, max = 100_000) => numberIn(get(k[key]), min, max, d[key] as number);
  const pence = (key: keyof IntelligenceSettings) => numberIn(get(k[key]), 0, 1_000_000, d[key] as number, false);
  return {
    revealFrom: parseDateSetting(get(k.revealFrom)),
    accuracyAdvancedPct: pct('accuracyAdvancedPct'),
    revealLowMatchPct: pct('revealLowMatchPct'),
    revealSmallCount: count('revealSmallCount'),
    strongMatchPct: pct('strongMatchPct'),
    strongMatchMinChecked: count('strongMatchMinChecked', 1),
    signupSearchCapPence: pence('signupSearchCapPence'),
    signupThinStock: count('signupThinStock'),
    signupSearchFreshHours: count('signupSearchFreshHours', 0, 24 * 30),
    signupConfirmLiveMax: count('signupConfirmLiveMax', 0, 50),
    signupIncomeChecksMax: count('signupIncomeChecksMax', 0, 50),
    signupSearchMonthlyCapPence: pence('signupSearchMonthlyCapPence'),
    memberSearchConfirmsPerHour: count('memberSearchConfirmsPerHour', 0, 10_000),
    deepSearchMarkup: numberIn(get(k.deepSearchMarkup), 1, 50, d.deepSearchMarkup, false),
    deepSearchMaxRawPence: pence('deepSearchMaxRawPence'),
    deepSearchMonthlyCapPence: pence('deepSearchMonthlyCapPence'),
    deepSearchFirstDiscountPct: pct('deepSearchFirstDiscountPct'),
    deepSearchNearbyAreas: count('deepSearchNearbyAreas', 0, 12),
    revealAnalysisDiscountPct: pct('revealAnalysisDiscountPct'),
    revealWelcomeDays: count('revealWelcomeDays', 0, 365),
    deepFirstRunExtraPence: pence('deepFirstRunExtraPence'),
    revealAutoTopupAmountPence: pence('revealAutoTopupAmountPence'),
    revealAutoTopupThresholdPence: pence('revealAutoTopupThresholdPence'),
    siCallPencePerMin: pence('siCallPencePerMin'),
    siTextPence: pence('siTextPence'),
    siEmailPence: pence('siEmailPence'),
  };
}

function time(iso: string | Date | null | undefined): number | null {
  if (!iso) return null;
  const t = iso instanceof Date ? iso.getTime() : Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * A "new member" for the reveal: created at or after reveal_from. False when
 * the setting is empty or either date is unreadable, so an existing member is
 * never sent to the reveal by accident.
 */
export function isRevealAccount(createdAt: string | Date | null | undefined, s: Pick<IntelligenceSettings, 'revealFrom'>): boolean {
  const from = time(s.revealFrom);
  const created = time(createdAt);
  return from !== null && created !== null && created >= from;
}
