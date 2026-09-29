import { createSupabaseServerClient } from '@/lib/supabase/server';
import { pixelEnabled } from '@/lib/meta/env';
import { claimForBrowser } from '@/lib/meta/conversions';
import { memberConsentFor } from '@/lib/tracking/consent-server';
import { isSameOriginJson } from '@/lib/tracking/request';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * The browser claims one conversion before firing it (Batch 19). Only the
 * first claim wins, so two tabs, a reload or a double tap never fire it
 * twice. Only for the signed-in member's own conversions, while their saved
 * choice is Accept, on a production build.
 *
 *   POST { key }  →  { claimed: { key, name, eventId, valuePence } | null }
 */
export async function POST(request: Request) {
  if (!isSameOriginJson(request)) return Response.json({ error: 'Not allowed.' }, { status: 403 });
  if (Number(request.headers.get('content-length') ?? 0) > 1024) return Response.json({ error: 'Too large.' }, { status: 413 });
  let key: unknown;
  try {
    key = ((await request.json()) as { key?: unknown }).key;
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (typeof key !== 'string' || key.length === 0 || key.length > 200) return Response.json({ error: 'Invalid request.' }, { status: 400 });

  let userId: string | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    userId = null;
  }
  if (!userId) return Response.json({ error: 'Not signed in.' }, { status: 401 });
  if (!pixelEnabled()) return Response.json({ claimed: null }, { headers: NO_STORE });

  const saved = await memberConsentFor(userId);
  if (saved?.choice !== 'accept') return Response.json({ claimed: null }, { headers: NO_STORE });

  return Response.json({ claimed: await claimForBrowser(userId, key) }, { headers: NO_STORE });
}
