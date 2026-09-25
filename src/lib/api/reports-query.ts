import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import type { AnalysisResult } from '../types';

/**
 * Reading a member's OWN analyser history for the API.
 *
 * `saved_searches`, never `leads`. The two are kept apart at every layer —
 * storage, navigation, billing history and here — because one is properties
 * the member chose to research and the other is strangers who filled in
 * their funnel. No endpoint returns both.
 *
 * Service role with an explicit `user_id` filter, for the same reason as
 * leads: an API key is not a session, so the filter is the whole boundary.
 */

export interface ReportSummary {
  id: string;
  address: string | null;
  postcode: string | null;
  postcodeArea: string | null;
  bedrooms: number | null;
  kind: string | null;
  annualRevenue: number | null;
  createdAt: string;
}

export interface ReportDetail extends ReportSummary {
  result: AnalysisResult | null;
}

interface Row {
  id: string;
  address: string | null;
  postcode: string | null;
  postcode_area: string | null;
  bedrooms: number | null;
  kind: string | null;
  created_at: string;
  result: AnalysisResult | null;
}

/** Zero revenue means the short-let lookup failed, not a worthless property. */
function revenueOf(result: AnalysisResult | null): number | null {
  const v = result?.shortLet?.annualRevenue;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

function summary(row: Row): ReportSummary {
  return {
    id: row.id,
    address: row.address,
    postcode: row.postcode,
    postcodeArea: row.postcode_area,
    bedrooms: row.bedrooms,
    kind: row.kind,
    annualRevenue: revenueOf(row.result),
    createdAt: row.created_at,
  };
}

/**
 * The account's reports — for an owner, the whole team's, since a member's
 * reports are paid for by and belong to the owner (`owner_id`).
 */
export async function listReports(userId: string, limit: number, offset: number): Promise<{ reports: ReportSummary[]; total: number; limit: number; offset: number }> {
  if (!hasServiceRole()) return { reports: [], total: 0, limit, offset };

  const { data, count, error } = await createAdminClient()
    .from('saved_searches')
    .select('id, address, postcode, postcode_area, bedrooms, kind, created_at, result', { count: 'exact' })
    .eq('owner_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) {
    console.error('[api] report list failed:', error.message);
    return { reports: [], total: 0, limit, offset };
  }
  return {
    // The full analysis is deliberately not in the list: it is tens of
    // kilobytes per row, and a caller that wants it asks for one report.
    reports: ((data ?? []) as unknown as Row[]).map(summary),
    total: count ?? 0,
    limit,
    offset,
  };
}

export async function getReport(userId: string, id: string): Promise<ReportDetail | null> {
  if (!hasServiceRole()) return null;
  const { data } = await createAdminClient()
    .from('saved_searches')
    .select('id, address, postcode, postcode_area, bedrooms, kind, created_at, result')
    .eq('owner_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as Row;
  return { ...summary(row), result: row.result };
}
