/**
 * Batch 23b: who gets an AI briefing, who gets the template, who gets none.
 *
 *   £0 (nothing spendable)        none: the email is exactly as it is today
 *   kill switch off               template, nothing charged
 *   no writer (no API key / row)  template, nothing charged
 *   balance short                 template, nothing charged: the day's own
 *                                 charge (Today's 5) comes first, and the
 *                                 briefing is written only if what is left
 *                                 still covers its ceiling
 *   otherwise                     AI, charged at most the ceiling
 *
 * Pure: no network, no database, no server-only.
 */

/** The most a briefing may be charged, in base pence (Zac's default: 3p). */
export const BRIEFING_CEILING_PENCE = 3;

export type Plan = { kind: 'none'; reason: 'no_credit' } | { kind: 'template'; reason: 'switched_off' | 'no_writer' | 'low_credit' | 'over_ceiling' } | { kind: 'ai' };

export interface DecideInput {
  /** The payer's spendable base pence now; null when unreadable (treated as none). */
  spendable: number | null;
  /** What this run has already set aside from the same payer (teammates briefed first). */
  heldThisRun: number;
  /** The day's own charge for this member's seats, worked out by dayChargeEstimate. */
  dayCharge: number;
  /** This briefing's ceiling, base pence. */
  ceiling: number;
  enabled: boolean;
  writerReady: boolean;
  /** Admins are never charged: their briefing is written whatever the balance. */
  admin: boolean;
}

export function decide(i: DecideInput): Plan {
  const left = (i.spendable ?? 0) - i.heldThisRun;
  if (!i.admin && !(left > 0)) return { kind: 'none', reason: 'no_credit' };
  if (!i.enabled) return { kind: 'template', reason: 'switched_off' };
  if (!i.writerReady) return { kind: 'template', reason: 'no_writer' };
  if (i.ceiling > BRIEFING_CEILING_PENCE) return { kind: 'template', reason: 'over_ceiling' };
  if (!i.admin && left - i.dayCharge + 1e-9 < i.ceiling) return { kind: 'template', reason: 'low_credit' };
  return { kind: 'ai' };
}

/**
 * The most the day's own charge can be for a member's running seats: one day
 * of daily deals each from the new pricing date, else the dearest pick (the
 * top rung of the open ladder, or one daily_pick unit when that is dearer).
 */
export function dayChargeEstimate(p: { mode: 'per_pick' | 'per_day'; seats: number; dailyPence: number; ladderTopPence: number; pickUnitPence: number }): number {
  const per = p.mode === 'per_day' ? p.dailyPence : Math.max(p.ladderTopPence, p.pickUnitPence);
  return Math.max(0, p.seats) * Math.max(0, per);
}

/** The ceiling from token counts at the unit rows' prices and markup. */
export function ceilingPence(p: { inputTokens: number; maxOutputTokens: number; inputUnitPence: number; outputUnitPence: number; inputMarkup: number; outputMarkup: number }): number {
  return p.inputTokens * p.inputUnitPence * p.inputMarkup + p.maxOutputTokens * p.outputUnitPence * p.outputMarkup;
}

/**
 * After the writer: its text is used, and charged, only when it came back
 * and passed the validator. Anything else (no reply, a refusal, unparseable
 * JSON, a rejection) is the template opener and the email's own subject,
 * charged nothing.
 */
export function afterWriting(p: { replied: boolean; valid: boolean; admin: boolean }): { use: 'ai' | 'template'; charge: boolean } {
  const ok = p.replied && p.valid;
  return { use: ok ? 'ai' : 'template', charge: ok && !p.admin };
}
