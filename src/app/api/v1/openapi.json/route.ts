import { openApiDocument } from '@/lib/api/openapi';
import { siteUrl } from '@/lib/url';

export const dynamic = 'force-dynamic';

/**
 * The API description, generated from the same module the docs page reads,
 * so the two cannot disagree. Public: a spec is not a secret, and an agent
 * needs to read it before it has a key.
 */
export async function GET() {
  return Response.json(openApiDocument(siteUrl()), {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
