import { extensionAccess } from '@/lib/extension/auth';
import { json, preflight } from '@/lib/extension/cors';

export const runtime = 'nodejs';

/** GET: who the token belongs to and whether they can use the extension. */
export async function GET(request: Request) {
  const access = await extensionAccess(request);
  if (access.state === 'anon') return json(request, { error: 'Not connected. Open the Stayful site and connect the extension.', code: 'not_connected' }, { status: 401 });
  return json(request, {
    email: access.user?.email ?? null,
    state: access.state,
    plan: access.plan,
    // null for subscribers — they have no free-report count to show.
    runsRemaining: access.freeReportsLeft,
  });
}

export function OPTIONS(request: Request) {
  return preflight(request);
}
