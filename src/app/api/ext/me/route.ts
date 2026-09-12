import { extensionAccess } from '@/lib/extension/auth';
import { json, preflight } from '@/lib/extension/cors';
import { formatGbp } from '@/lib/credit/pricing';

export const runtime = 'nodejs';

/** GET: who the token belongs to and whether they can use the extension. */
export async function GET(request: Request) {
  const access = await extensionAccess(request);
  if (access.state === 'anon') return json(request, { error: 'Not connected. Open the Stayful site and connect the extension.', code: 'not_connected' }, { status: 401 });
  return json(request, {
    email: access.user?.email ?? null,
    state: access.state,
    planCode: access.planCode,
    balancePence: access.balancePence,
    balanceLabel: access.balancePence === null ? null : formatGbp(access.balancePence),
    outOfCredit: access.spendableBasePence !== null && access.spendableBasePence <= 0,
  });
}

export function OPTIONS(request: Request) {
  return preflight(request);
}
