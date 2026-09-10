import { extensionAccess } from '@/lib/extension/auth';
import { revokeExtensionToken } from '@/lib/extension/tokens';
import { json, preflight } from '@/lib/extension/cors';

export const runtime = 'nodejs';

/** POST: revokes the calling token (the extension's "Disconnect"). */
export async function POST(request: Request) {
  const access = await extensionAccess(request);
  if (!access.user || !access.tokenId) return json(request, { ok: true });
  await revokeExtensionToken(access.user.id, access.tokenId);
  return json(request, { ok: true });
}

export function OPTIONS(request: Request) {
  return preflight(request);
}
