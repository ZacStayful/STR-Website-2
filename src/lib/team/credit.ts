import 'server-only';

import { getCreditSummary, type CreditSummary } from '../credit/summary';
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
}

export async function teamCreditSnapshot(user: { id: string; admin: boolean }): Promise<TeamCreditSnapshot> {
  const payer = await payerFor(user.id);
  const summary = await getCreditSummary(payer.payerId);
  return {
    ...summary,
    admin: user.admin,
    member: payer.memberId ? { teamName: await teamName(payer.payerId), paused: payer.suspended } : null,
  };
}
