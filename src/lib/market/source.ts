import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import type { ReportRow } from './aggregate';
import { toReportRow } from './report-row';

/**
 * Loads the analyser reports the Market Explorer is built from.
 *
 * SERVER ONLY: uses the service-role client. Selects only the columns the
 * aggregator reads, with the monthly revenue breakdown pulled out of
 * `raw_response` by JSON path (never the whole document), and pages in
 * 1000-row chunks because PostgREST caps a single select at 1000 rows.
 * Returns `[]` when the service role is not configured or the query fails,
 * so the pages show their "market data is loading" state instead of
 * throwing. At tens of thousands of rows the aggregation should move into
 * a Postgres view; today the table is in the hundreds.
 */

export const REPORT_COLUMNS =
  'id, created_at, source, postcode, postcode_area, bedrooms, adr, occupancy, gross_revenue, net_revenue, property_value_low, property_value_high, ' +
  'comp_avg_rating, comp_avg_review_count, comp_avg_listing_age, listing_density, demand_hospitals, demand_universities, demand_transport, demand_events, ' +
  'monthly:raw_response->shortLet->monthlyRevenue';

const PAGE = 1000;
const MAX_PAGES = 50;

export async function loadReportRows(): Promise<ReportRow[]> {
  if (!hasServiceRole()) {
    console.warn('[market] SUPABASE_SERVICE_ROLE_KEY not set — market data unavailable');
    return [];
  }
  const admin = createAdminClient();
  const out: ReportRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE;
    const { data, error } = await admin
      .from('analyser_reports')
      .select(REPORT_COLUMNS)
      .gt('gross_revenue', 0)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.warn('[market] analyser_reports select failed:', error.message);
      return [];
    }
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    for (const r of rows) out.push(toReportRow(r));
    if (rows.length < PAGE) break;
  }
  return out;
}
