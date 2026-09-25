'use server';

import { touchLeadByReportToken } from '@/lib/leads/activity';

/**
 * The report token is the whole credential for this page, and all this can
 * do with one is move that lead's retention clock forward — never read or
 * change anything else about it.
 */
export async function markReportOpenedAction(token: string): Promise<void> {
  if (typeof token !== 'string') return;
  await touchLeadByReportToken(token);
}
