import { currentMember } from '@/lib/credit/auth';
import { usageHistory } from '@/lib/credit/history';

export const dynamic = 'force-dynamic';

/** GET ?before=<iso>&limit=50 — the member's ledger, newest first, debits grouped by action. */
export async function GET(request: Request) {
  const member = await currentMember();
  if (!member) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const url = new URL(request.url);
  const before = url.searchParams.get('before');
  const limit = Number(url.searchParams.get('limit') ?? 50);
  try {
    const page = await usageHistory(member.id, { before: before && !Number.isNaN(Date.parse(before)) ? before : null, limit: Number.isFinite(limit) ? limit : 50 });
    return Response.json(page, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.error('[credit/usage] failed:', err);
    return Response.json({ error: 'Could not load your usage.' }, { status: 500 });
  }
}
