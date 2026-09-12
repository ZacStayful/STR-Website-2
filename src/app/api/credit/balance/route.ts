import { currentMember } from '@/lib/credit/auth';
import { getCreditSummary } from '@/lib/credit/summary';

export const dynamic = 'force-dynamic';

/** GET: the signed-in member's credit summary (nav badge, banner, modal). */
export async function GET() {
  const member = await currentMember();
  if (!member) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  try {
    const summary = await getCreditSummary(member.id);
    return Response.json({ ...summary, admin: member.admin }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.error('[credit/balance] failed:', err);
    return Response.json({ error: 'Could not load your balance.' }, { status: 500 });
  }
}
