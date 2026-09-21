import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { parseBrand, type FunnelBrand } from '../funnels/brand';
import { isFunnelToken } from '../funnels';
import type { ReportDepth } from '../funnels';
import type { AnalysisResult } from '../types';

/**
 * Loading a lead's report by its public token.
 *
 * The token is the entire credential — the prospect has no account — so this
 * returns only what they may see. Deliberately absent: the owner's user id,
 * the qualification verdict and anything about the customer's credit. A
 * prospect learning they were filed as "not qualified" would be the worst
 * possible outcome of this feature.
 */

export interface LeadReport {
  result: AnalysisResult;
  /** Printed on the report cover. Null when the funnel did not collect one. */
  email: string | null;
  brand: FunnelBrand;
  /** So the page can render exactly as the funnel that produced it did. */
  funnelToken: string;
  reportDepth: ReportDepth;
}

interface FunnelJoin {
  public_token: string;
  brand: unknown;
  report_depth: string;
}

export async function leadByReportToken(token: string): Promise<LeadReport | null> {
  // Same shape check as every other public token here, so a malformed one is
  // refused before it reaches the database.
  if (!isFunnelToken(token) || !hasServiceRole()) return null;

  const { data, error } = await createAdminClient()
    .from('leads')
    .select('result, email, funnel_id, funnels ( public_token, brand, report_depth )')
    .eq('report_token', token)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as unknown as {
    result: AnalysisResult | null;
    email: string | null;
    funnel_id: string | null;
    // A to-one embed comes back as an object at runtime, but the client types
    // it as an array. Accept both rather than betting on one.
    funnels: FunnelJoin | FunnelJoin[] | null;
  };
  if (!row.result) return null;

  const funnel = Array.isArray(row.funnels) ? row.funnels[0] ?? null : row.funnels;
  return {
    result: row.result,
    email: row.email ?? null,
    brand: parseBrand(funnel?.brand),
    funnelToken: funnel?.public_token ?? '',
    reportDepth: funnel?.report_depth === 'enhanced' ? 'enhanced' : 'standard',
  };
}
