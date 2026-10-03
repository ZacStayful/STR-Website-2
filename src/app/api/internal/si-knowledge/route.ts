import { authoriseInternal, internalSecretsConfigured } from '@/lib/internal-auth';
import { hasServiceRole } from '@/lib/supabase/admin';
import { runKnowledgeSeed } from '@/lib/knowledge/seed-server';
import { gapJobEnabled, runGapJob } from '@/lib/knowledge/gap/run';
import { runWeeklyGapEmail } from '@/lib/knowledge/weekly-server';

/**
 * Batch 24: the Stayful Intelligence knowledge base's internal entry point.
 *
 *   (no step)    the nightly job (vercel.json, 02:50 UTC): stale check and
 *                agent re-sync, then group the questions it couldn't answer
 *                and draft answers for Zac (src/lib/knowledge/gap/run.ts).
 *                House spend, inside si_gap_monthly_cap_pence; once a UK day.
 *                Off until SI_GAP_JOB_ENABLED=true; `?dry=1` always works:
 *                it makes the model calls (counted against the cap) and
 *                shows the groups, drafts and cost, writing nothing else.
 *                `&estimate=1` makes no model call. Then the Monday email
 *                (once a week) and question retention (a dry run counts).
 *   ?step=weekly the Monday email about last week, now (once a week: a week
 *                already sent is skipped). `&dry=1` returns the email it
 *                would send, sends nothing and claims nothing.
 *   ?step=seed   the one-off that puts src/lib/knowledge/seed.ts in as drafts
 *                for Zac to approve (never approves, never touches a live
 *                answer). `&dry=1` reports what it would do and writes nothing.
 *
 * Same auth as the other internal routes:
 *   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/si-knowledge?step=seed&dry=1"
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The nightly job drafts for up to GAP_TIME_BUDGET_MS (240 s), then stops.
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return new Response('Not found', { status: 404 });
  if (!authoriseInternal(request)) return new Response('Unauthorised', { status: 401 });
  if (!hasServiceRole()) return Response.json({ error: 'service role not configured' }, { status: 503 });
  const params = new URL(request.url).searchParams;
  const dry = params.get('dry') === '1';
  const step = params.get('step') ?? '';
  if (step === 'seed') {
    const result = await runKnowledgeSeed({ dry, actor: 'internal' });
    return Response.json(result, { status: result.ok ? 200 : 500 });
  }
  if (step === 'weekly') {
    const result = await runWeeklyGapEmail({ dry, triggeredBy: 'internal' });
    return Response.json(result, { status: result.status === 'failed' ? 500 : 200 });
  }
  if (step === '' || step === 'nightly') {
    const estimate = params.get('estimate') === '1';
    if (!gapJobEnabled() && !dry && !estimate) return Response.json({ enabled: false, reason: 'Set SI_GAP_JOB_ENABLED=true to run the nightly job; ?dry=1 works either way.' });
    const result = await runGapJob({ dry: dry || estimate, estimate, triggeredBy: request.headers.get('authorization') ? 'cron' : 'internal' });
    return Response.json(result.body, { status: result.status });
  }
  return Response.json({ error: 'unknown step', steps: ['nightly', 'weekly', 'seed'] }, { status: 400 });
}
