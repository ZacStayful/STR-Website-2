import { authoriseInternal, internalSecretsConfigured } from '@/lib/internal-auth';
import { hasServiceRole } from '@/lib/supabase/admin';
import { tidyInstructions } from '@/lib/si-actions/run-server';

/**
 * Nightly (Batch 27, src/lib/si-actions): Stayful Intelligence's unfinished
 * instructions. A question whose answer never arrived is cancelled (nothing
 * in it ran); a countdown or confirm nobody answered expires; a run left
 * open past two hours is closed (its steps' own code settled them); a
 * checked listing's held snapshot is cleared once the Undo window has passed
 * without a Keep. Nothing is charged or refunded here.
 *
 * Same auth as the other internal routes. `?dry=1` counts and changes nothing.
 *
 *   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/si-actions?dry=1"
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return new Response('Not found', { status: 404 });
  if (!authoriseInternal(request)) return new Response('Unauthorised', { status: 401 });
  if (!hasServiceRole()) return Response.json({ error: 'service role not configured' }, { status: 503 });
  const dry = new URL(request.url).searchParams.get('dry') === '1';
  try {
    return Response.json({ dry, ...(await tidyInstructions({ apply: !dry })) });
  } catch (err) {
    console.error('[si-actions]', (err as Error)?.message ?? err);
    return Response.json({ dry, error: (err as Error)?.message ?? 'failed' }, { status: 500 });
  }
}
