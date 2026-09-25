import { currentMember } from '@/lib/credit/auth';
import { teamCreditSnapshot } from '@/lib/team/credit';

export const dynamic = 'force-dynamic';

/** GET: the signed-in member's credit summary (nav badge, banner, modal). */
export async function GET() {
  const member = await currentMember();
  if (!member) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  try {
    // A team member sees the team's balance, which is what they spend.
    const snapshot = await teamCreditSnapshot({ id: member.id, admin: member.admin });
    return Response.json(snapshot, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.error('[credit/balance] failed:', err);
    return Response.json({ error: 'Could not load your balance.' }, { status: 500 });
  }
}
