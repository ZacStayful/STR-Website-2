import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import type { ReportRow } from './aggregate';
import { toReportRow } from './report-row';
import type { PlanningSignal } from './planning';

/**
 * Loads the analyser reports the Market Explorer is built from.
 *
 * Every source is loaded, including 'lead_db' — properties a Stayful lead
 * database customer paid to analyse from their own lead list, which are meant
 * to count here. No landlord details are ever sent with those, and nothing
 * here selects the address column. Which rows then count, and where, is
 * decided in aggregate.ts and quality.ts.
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
  'monthly:raw_response->shortLet->monthlyRevenue, ' +
  // The analyser's own quality verdict, so synthetic estimates can be left out (quality.ts).
  'comparables_found:raw_response->dataQuality->comparablesFound, quality_level:raw_response->dataQuality->>level';

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

/** Planning signals per postcode area (large applications nearby), refreshed by /api/internal/planning-signals. */
export async function loadPlanningSignals(): Promise<PlanningSignal[]> {
  if (!hasServiceRole()) return [];
  const admin = createAdminClient();
  const { data, error } = await admin.from('area_planning_signals').select('postcode_area, large_apps_12m, large_apps_prev_12m, fetched_at');
  if (error) {
    console.warn('[market] area_planning_signals select failed:', error.message);
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    postcode_area: String(r.postcode_area ?? '').toUpperCase(),
    large_apps_12m: typeof r.large_apps_12m === 'number' ? r.large_apps_12m : null,
    large_apps_prev_12m: typeof r.large_apps_prev_12m === 'number' ? r.large_apps_prev_12m : null,
    fetched_at: typeof r.fetched_at === 'string' ? r.fetched_at : null,
  }));
}
