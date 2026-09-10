import { extensionAccess } from '@/lib/extension/auth';
import { json, preflight } from '@/lib/extension/cors';
import { runsRemaining } from '@/lib/access';

export const runtime = 'nodejs';

/** GET: who the token belongs to and whether they can use the extension. */
export async function GET(request: Request) {
  const access = await extensionAccess(request);
  if (access.state === 'anon') return json(request, { error: 'Not connected. Open the Stayful site and connect the extension.', code: 'not_connected' }, { status: 401 });
  return json(request, {
    email: access.user?.email ?? null,
    state: access.state,
    plan: access.plan,
    runsRemaining: access.plan === 'pro' ? null : runsRemaining({ reports_run: access.reportsRun ?? 0 }),
  });
}

export function OPTIONS(request: Request) {
  return preflight(request);
}
