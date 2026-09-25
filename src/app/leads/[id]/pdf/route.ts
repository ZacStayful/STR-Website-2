import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient, hasServiceRole } from '@/lib/supabase/admin';
import { leadScopeOrPaused } from '@/lib/leads/scope';
import { touchLeads } from '@/lib/leads/activity';
import { parseBrand } from '@/lib/funnels/brand';
import { renderReportPdf, pdfBrandForFunnel, reportFilename } from '@/lib/pdf/render';
import type { AnalysisResult } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * A lead's report as a PDF, for the customer who owns it.
 *
 * Rendered from the analysis stored when the prospect completed the funnel —
 * nothing is re-run, nothing is charged — under the funnel's branding, so it
 * is the same document the prospect can download. Works whether or not the
 * funnel is still live, which the prospect-facing routes gate on.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Not authorised', { status: 401 });
  if (!hasServiceRole()) return new Response('Not available', { status: 503 });
  const scope = await leadScopeOrPaused(user);
  if (scope === 'paused') return new Response('Your team access is paused', { status: 403 });

  const { data } = await createAdminClient()
    .from('leads')
    .select('result, email, funnels ( brand )')
    .eq('user_id', scope.ownerId)
    .eq('id', id)
    .maybeSingle();
  const row = data as unknown as {
    result: AnalysisResult | null;
    email: string | null;
    funnels: { brand: unknown } | { brand: unknown }[] | null;
  } | null;
  if (!row?.result?.property || !row.result.financials) return new Response('Not found', { status: 404 });

  const funnel = Array.isArray(row.funnels) ? row.funnels[0] ?? null : row.funnels;
  const brand = await pdfBrandForFunnel(parseBrand(funnel?.brand));
  const buffer = await renderReportPdf(row.result, { brand, preparedFor: row.email ?? undefined });

  await touchLeads(scope.ownerId, [id]);

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${reportFilename(row.result, brand)}"`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
