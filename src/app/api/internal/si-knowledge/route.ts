import { authoriseInternal, internalSecretsConfigured } from '@/lib/internal-auth';
import { hasServiceRole } from '@/lib/supabase/admin';
import { runKnowledgeSeed } from '@/lib/knowledge/seed-server';

/**
 * Batch 24: the Stayful Intelligence knowledge base's internal entry point.
 *
 *   ?step=seed   the one-off that puts src/lib/knowledge/seed.ts in as drafts
 *                for Zac to approve (never approves, never touches a live
 *                answer). `&dry=1` reports what it would do and writes nothing.
 *
 * Same auth as the other internal routes:
 *   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/si-knowledge?step=seed&dry=1"
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
  return Response.json({ error: 'unknown step', steps: ['seed'] }, { status: 400 });
}
