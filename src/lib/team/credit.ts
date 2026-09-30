import 'server-only';

import { getCreditSummary, type CreditSummary } from '../credit/summary';
import { starterPackStateFor } from '../starter-pack/server';
import type { PackCopy } from '../starter-pack/rules';
import { decisionOffer, type DecisionOffer } from '../credit/low-credit-server';
import { payerFor, teamName } from './index';

/**
 * The credit a signed-in person should see: their own, or — for a team
 * member — the team's, which is the owner's balance they spend from.
 * `member` tells the UI to hide top-up and plans (the owner pays) and to
 * say whom to ask instead.
 */
export interface TeamCreditSnapshot extends CreditSummary {
  admin: boolean;
  member: { teamName: string; paused: boolean } | null;
  /** Batch 20: the starter pack's words, while this member can still buy it (the banner and the out-of-credit modal offer it). */
  pack: PackCopy | null;
  /** Batch 20, Part B: with no plan (and no pack to offer), the choice at £5 or less: Starter or the £10 top-up. */
  decision: DecisionOffer | null;
}

export async function teamCreditSnapshot(user: { id: string; admin: boolean }): Promise<TeamCreditSnapshot> {
  const payer = await payerFor(user.id);
  const [summary, pack] = await Promise.all([getCreditSummary(payer.payerId), payer.memberId || user.admin ? null : starterPackStateFor(user.id)]);
  const packCopy = pack?.offer.eligible ? pack.copy : null;
  return {
    ...summary,
    admin: user.admin,
    member: payer.memberId ? { teamName: await teamName(payer.payerId), paused: payer.suspended } : null,
    pack: packCopy,
    decision: !payer.memberId && !user.admin && !packCopy && summary.noPlan ? await decisionOffer() : null,
  };
}
