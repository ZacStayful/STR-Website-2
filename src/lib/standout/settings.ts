/**
 * Batch 25: the standout deals' billing_settings rows, one parser
 * (BillingSettings.standout). Seeded in supabase/schema.sql's Batch 25
 * section; edited on /admin/standout. A malformed value falls back to its
 * default.
 *
 * Reused, not duplicated here: the outbound hours and the one-call-a-day
 * rule (voice), the free delay (freeDealDelayHours), low_credit_pence (the
 * £5 mark, lifecycle), the text and email prices (intelligence).
 *
 * Pure.
 */

export interface StandoutSettings {
  /** Match (met ÷ checked, %) at or above this… */
  minMatchPct: number;
  /** …over at least this many checked answers. */
  minChecked: number;
  /** The low end of the profit at least this % above the member's minimum. */
  profitOverMinPct: number;
  /** The listing confirmed live within this many hours; older is rechecked first. */
  liveConfirmHours: number;
  /** Deal calls a member may get in a UK calendar month. */
  callsPerMonth: number;
  /** No deal call below this balance (face pence). */
  callMinBalancePence: number;
  /** Listings one pass may recheck itself; the rest wait for the hourly recheck. */
  rechecksPerRun: number;
  /** Standouts saved for a member in one UK day (the best first); 0 = no limit. */
  maxPerDay: number;
  /** A standout must make more than every deal at least as good shown or saved to the member in this many days; 0 = off. */
  beatBestDays: number;
  /** Not-standout decisions are deleted after this many days. */
  keepDays: number;
  /** The slower-spender nudge: days from the most recent credit to the £5 mark, at least… */
  slowerSpenderMinDays: number;
  /** …and at most. */
  slowerSpenderMaxDays: number;
}

export const STANDOUT_KEYS = {
  minMatchPct: 'standout_min_match_pct',
  minChecked: 'standout_min_checked',
  profitOverMinPct: 'standout_profit_over_min_pct',
  liveConfirmHours: 'standout_live_confirm_hours',
  callsPerMonth: 'standout_calls_per_month',
  callMinBalancePence: 'standout_call_min_balance_pence',
  rechecksPerRun: 'standout_rechecks_per_run',
  maxPerDay: 'standout_max_per_day',
  beatBestDays: 'standout_beat_best_days',
  keepDays: 'standout_keep_days',
  slowerSpenderMinDays: 'slower_spender_min_days',
  slowerSpenderMaxDays: 'slower_spender_max_days',
} as const satisfies Record<keyof StandoutSettings, string>;

export const DEFAULT_STANDOUT: StandoutSettings = {
  minMatchPct: 90,
  minChecked: 5,
  profitOverMinPct: 25,
  liveConfirmHours: 6,
  callsPerMonth: 2,
  callMinBalancePence: 100,
  rechecksPerRun: 3,
  maxPerDay: 1,
  beatBestDays: 30,
  keepDays: 90,
  slowerSpenderMinDays: 8,
  slowerSpenderMaxDays: 21,
};

function numberIn(raw: unknown, min: number, max: number, fallback: number): number {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

export function parseStandout(get: (key: string) => unknown): StandoutSettings {
  const d = DEFAULT_STANDOUT;
  const k = STANDOUT_KEYS;
  const minDays = numberIn(get(k.slowerSpenderMinDays), 1, 365, d.slowerSpenderMinDays);
  let maxDays = numberIn(get(k.slowerSpenderMaxDays), 1, 365, d.slowerSpenderMaxDays);
  if (maxDays < minDays) maxDays = minDays;
  return {
    minMatchPct: numberIn(get(k.minMatchPct), 1, 100, d.minMatchPct),
    minChecked: numberIn(get(k.minChecked), 1, 30, d.minChecked),
    profitOverMinPct: numberIn(get(k.profitOverMinPct), 0, 500, d.profitOverMinPct),
    liveConfirmHours: numberIn(get(k.liveConfirmHours), 1, 72, d.liveConfirmHours),
    callsPerMonth: numberIn(get(k.callsPerMonth), 0, 31, d.callsPerMonth),
    callMinBalancePence: numberIn(get(k.callMinBalancePence), 0, 100_000, d.callMinBalancePence),
    rechecksPerRun: numberIn(get(k.rechecksPerRun), 0, 10, d.rechecksPerRun),
    maxPerDay: numberIn(get(k.maxPerDay), 0, 50, d.maxPerDay),
    beatBestDays: numberIn(get(k.beatBestDays), 0, 365, d.beatBestDays),
    keepDays: numberIn(get(k.keepDays), 7, 3650, d.keepDays),
    slowerSpenderMinDays: minDays,
    slowerSpenderMaxDays: maxDays,
  };
}
