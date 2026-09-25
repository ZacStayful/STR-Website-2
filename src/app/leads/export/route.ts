import { createSupabaseServerClient } from '@/lib/supabase/server';
import { listLeads } from '@/lib/api/leads-query';
import { leadsCsv } from '@/lib/api/csv';
import { leadScopeOrPaused } from '@/lib/leads/scope';
import { parseLeadFilters, queryFor } from '@/lib/leads/filters';

export const dynamic = 'force-dynamic';

/** Same ceiling as the API export. */
const EXPORT_LIMIT = 1000;

/**
 * The Leads page's "Export CSV": whatever the current search and tab show,
 * as a spreadsheet. Takes the page's own query string, so it cannot export
 * something other than what the customer is looking at.
 *
 * Deliberately not activity: exporting everything is not a decision to keep
 * everything, and counting it would stop retention ever running for anyone
 * who exports regularly.
 */
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Not authorised', { status: 401 });
  const scope = await leadScopeOrPaused(user);
  if (scope === 'paused') return new Response('Your team access is paused', { status: 403 });

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const filters = parseLeadFilters(params);
  const page = await listLeads(scope.ownerId, { ...queryFor(filters, filters.tab, false), limit: EXPORT_LIMIT });

  return new Response(leadsCsv(page.leads), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
