import { authoriseInternal, internalSecretsConfigured } from '@/lib/internal-auth';
import { hasServiceRole } from '@/lib/supabase/admin';
import { renewDueSeats, reinstateSeats } from '@/lib/team/seats';

/**
 * Hourly team-seat billing (src/lib/team/seats.ts): renew seats whose 30
 * days are up — suspending any the owner's balance cannot cover — and bring
 * back suspended seats once it can. Reinstatement also runs straight after a
 * top-up; this catches credit that arrives any other way (a plan renewal, a
 * code, an adjustment).
 *
 * Same auth as the other internal routes. `?dry=1` counts without charging.
 *
 *   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/team-seats?dry=1"
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return new Response('Not found', { status: 404 });
  if (!authoriseInternal(request)) return new Response('Unauthorised', { status: 401 });
  if (!hasServiceRole()) return Response.json({ error: 'service role not configured' }, { status: 503 });

  const dry = new URL(request.url).searchParams.get('dry') === '1';
  // Reinstate first: a seat restored now then renews on its own new date,
  // rather than being renewed and immediately found still suspended.
  const reinstated = await reinstateSeats({ dry });
  const renewed = await renewDueSeats({ dry });
  const summary = {
    dry,
    reinstated: reinstated.reinstated,
    renewed: renewed.renewed,
    suspended: renewed.suspended,
    errors: [...reinstated.errors, ...renewed.errors],
  };
  if (summary.errors.length > 0) console.error('[team-seats]', summary.errors.join('; '));
  return Response.json(summary);
}
