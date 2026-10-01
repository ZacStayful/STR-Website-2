import 'server-only';

/**
 * Batch 22, Part F: the what-if suggestions for a member's day, ready to show
 * (WhatIfSuggestions): the best 1–3 with their lines, or the plain line when
 * nothing helps. A member search that can still run says so.
 */
import { whatIfsForMember, type MemberContext } from '../today/selection';
import { bestWhatIfs, NO_WHAT_IF_LINE, NO_WHAT_IF_LINE_NO_SEARCH, whatIfLine } from './what-if';
import { WHAT_IF_SHOWN } from './config';

export interface WhatIfView {
  items: { key: string; line: string; mustHave: boolean; save: 'use' | 'budget'; bestHref: string | null }[];
  none: string;
}

export async function whatIfViewFor(member: MemberContext, now: Date = new Date()): Promise<WhatIfView> {
  const { results } = await whatIfsForMember(member, now);
  const best = bestWhatIfs(results, WHAT_IF_SHOWN);
  const searching = process.env.MEMBER_SEARCH_ENABLED === 'true';
  return {
    items: best.map((r) => ({ key: r.key, line: whatIfLine(r), mustHave: r.mustHave, save: r.save, bestHref: r.best ? `/deals/${r.best.dealId}` : null })),
    none: searching ? NO_WHAT_IF_LINE : NO_WHAT_IF_LINE_NO_SEARCH,
  };
}
