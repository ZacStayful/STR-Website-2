/**
 * Batch 23, Part C: the low-credit call's trigger. Pure.
 *
 * Fires when the member's balance has dropped to low_credit_pence (£5) AND
 * they spent at least si_low_credit_spent_ratio (80%) of their most recent
 * credit within si_low_credit_window_days (7) of it landing.
 *
 * "Most recent credit" from the ledger: the newest credit_grants row with
 * amount_pence > 0 that is a top-up (kind 'topup': a top-up, an auto top-up or
 * the starter pack's paid £10), plan credit (kind 'plan'), or the starter
 * pack's bonus (a 'welcome' grant with source_ref 'pack_bonus:<pi>'), which is
 * merged with its 'pi:<pi>' twin into one landing. Referral, promo, admin,
 * checklist and profile grants, overdraft rows and clawbacks are not "credit
 * landing". Spending is measured in displayed (face) pence: debits minus
 * refunds since the landing.
 *
 * The landing's id is the call's trigger_ref, so it fires once per landing
 * and again only after the next credit lands.
 */
import type { VoiceSettings } from './settings.ts';

export interface GrantRow {
  id: string;
  kind: string;
  amount_pence: number;
  source_ref: string | null;
  created_at: string;
}

export interface Landing {
  /** The trigger_ref: the landing's grant id (the paid half, for a starter pack). */
  id: string;
  amountPence: number;
  landedAt: Date;
}

function counts(g: GrantRow): boolean {
  if (!(Number(g.amount_pence) > 0)) return false;
  const ref = g.source_ref ?? '';
  if (ref.startsWith('overdraft:')) return false;
  if (g.kind === 'topup' || g.kind === 'plan') return true;
  return g.kind === 'welcome' && ref.startsWith('pack_bonus:');
}

/** The pack's two halves share one key. */
function groupKey(g: GrantRow): string {
  const ref = g.source_ref ?? '';
  if (ref.startsWith('pack_bonus:')) return `pi:${ref.slice('pack_bonus:'.length)}`;
  return ref || `id:${g.id}`;
}

export function latestLanding(grants: readonly GrantRow[]): Landing | null {
  const usable = grants.filter(counts);
  if (usable.length === 0) return null;
  const newest = usable.reduce((a, b) => (Date.parse(b.created_at) > Date.parse(a.created_at) ? b : a));
  const key = groupKey(newest);
  const group = usable.filter((g) => groupKey(g) === key);
  const paid = group.find((g) => !(g.source_ref ?? '').startsWith('pack_bonus:')) ?? group[0];
  return {
    id: paid.id,
    amountPence: group.reduce((n, g) => n + Number(g.amount_pence), 0),
    landedAt: new Date(Math.min(...group.map((g) => Date.parse(g.created_at)))),
  };
}

export interface TriggerInput {
  /** The member's displayed balance. */
  balancePence: number;
  lowCreditPence: number;
  landing: Landing | null;
  /** Face pence spent since the landing (debits minus refunds). */
  spentSincePence: number;
  now: Date;
  settings: Pick<VoiceSettings, 'lowCreditSpentRatio' | 'lowCreditWindowDays'>;
}

export function lowCreditTriggered(i: TriggerInput): boolean {
  if (!i.landing || i.lowCreditPence <= 0) return false;
  if (i.balancePence > i.lowCreditPence) return false;
  if (i.now.getTime() - i.landing.landedAt.getTime() > i.settings.lowCreditWindowDays * 24 * 60 * 60_000) return false;
  return i.spentSincePence >= i.settings.lowCreditSpentRatio * i.landing.amountPence;
}

/** Face pence spent from ledger rows: a debit's amount_pence is negative, a refund's positive. */
export function spentFromLedger(rows: readonly { kind: string; amount_pence: number }[]): number {
  let n = 0;
  for (const r of rows) {
    if (r.kind === 'debit') n += -Number(r.amount_pence) || 0;
    else if (r.kind === 'refund') n -= Number(r.amount_pence) || 0;
  }
  return Math.max(0, n);
}
