import { after } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { handlePresence } from '@/lib/activity/presence';

export const dynamic = 'force-dynamic';

/**
 * The visit heartbeat (src/components/activity/VisitHeartbeat.tsx). Answers
 * at once with 204; the visit and any view are written after the response
 * (src/lib/activity/presence.ts). Signed-in members only: whose visit it is
 * comes from the session, never from the request.
 */
export async function POST(request: Request) {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > 2048) return new Response(null, { status: 413 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return new Response(null, { status: 401 });
    const userId = user.id;
    after(() => handlePresence(userId, body));
  } catch (err) {
    console.warn('[presence] failed:', err instanceof Error ? err.message : err);
  }
  return new Response(null, { status: 204 });
}
