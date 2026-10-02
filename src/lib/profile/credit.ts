/**
 * The £5 for a complete profile: paid once per account, never again however
 * often the answers change, and only to an account the welcome check cleared
 * (the same abuse rules as the welcome credit and the first-week £1s, never
 * new ones: src/lib/today/checklist.ts rewardEligibility). A team member is
 * never paid, because their credit is the team owner's.
 *
 * "Not sure" counts as an answer for the bar, but not for the money: the
 * credit needs the mandatory answers plus at least
 * billing_settings.profile_credit_min_real_pct of the remaining questions
 * answered with a real value. Below that the credit waits; going back and
 * answering properly earns it, once.
 *
 * The amount is billing_settings.profile_complete_pence (never here). The
 * grant is idempotent on credit_grants.source_ref (PROFILE_CREDIT_REF), so a
 * retry can never pay twice. The reads, writes and the grant itself are in
 * src/lib/profile/server.ts.
 *
 * Pure: no network, no database, no server-only.
 */
import type { Eligibility } from '../today/checklist.ts';
import type { Progress } from './state.ts';

export const PROFILE_CREDIT_KIND = 'welcome' as const;

/** The grant's reference: one per account, so credit_grants' unique source_ref can only ever pay it once. */
export function profileCreditRef(userId: string): string {
  return `profile_complete:${userId}`;
}

export type CreditDecision =
  | { kind: 'pay' }
  /** Not yet: the welcome check has not run, or too many "Not sure"s (`needed` more real answers). */
  | { kind: 'wait'; reason: 'welcome_pending' | 'not_enough_real'; needed: number }
  | { kind: 'never'; reason: 'team_member' | 'welcome_withheld' };

/** How many real answers the credit needs: every mandatory one, plus the share of the rest. */
export function realAnswersNeeded(p: { questions: number; mandatory: number; minRealPct: number }): number {
  const rest = Math.max(0, p.questions - p.mandatory);
  const pct = Math.min(100, Math.max(0, p.minRealPct));
  return p.mandatory + Math.ceil((rest * pct) / 100);
}

export function profileCreditDecision(p: { eligibility: Eligibility; progress: Pick<Progress, 'complete' | 'questions' | 'mandatory' | 'real'>; minRealPct: number }): CreditDecision {
  if (p.eligibility.kind === 'never') return { kind: 'never', reason: p.eligibility.reason };
  const needed = realAnswersNeeded({ questions: p.progress.questions.length, mandatory: p.progress.mandatory.length, minRealPct: p.minRealPct });
  if (!p.progress.complete || p.progress.real < needed) return { kind: 'wait', reason: 'not_enough_real', needed: Math.max(1, needed - p.progress.real) };
  if (p.eligibility.kind === 'pending') return { kind: 'wait', reason: 'welcome_pending', needed: 0 };
  return { kind: 'pay' };
}

/**
 * The line on the celebration screen and the profile page. `pence` is the
 * setting; `paid` whether the grant exists. Batch 22d: `already` when it was
 * paid before this completion (after Start again, or on a blank profile): it
 * says so, and never offers it again.
 */
export function creditLine(p: { paid: boolean; decision: CreditDecision | null; pence: number; already?: boolean }): string {
  const amount = `£${(p.pence / 100).toFixed(p.pence % 100 === 0 ? 0 : 2)}`;
  if (p.paid && p.already) return `You’ve already had your ${amount} for completing your profile, so there’s none for answering again.`;
  if (p.paid) return `${amount} of credit is on your account for completing your profile.`;
  const d = p.decision;
  if (!d) return `Complete your profile for ${amount} of credit.`;
  if (d.kind === 'pay') return `${amount} of credit is on its way for completing your profile.`;
  if (d.kind === 'never') return d.reason === 'team_member' ? 'You use your team’s credit, so there is no profile credit on this login.' : 'Profile credit is not available on this account.';
  if (d.reason === 'welcome_pending') return `Your ${amount} of profile credit arrives once your account check is done.`;
  return `Answer ${d.needed} more question${d.needed === 1 ? '' : 's'} with a real answer (not “Not sure”) to get your ${amount} of credit.`;
}
