import { currentMember } from '@/lib/credit/auth';
import { ensureReferralCode } from '@/lib/credit/referral';

export const dynamic = 'force-dynamic';

/** GET → the member's referral code and link (created on first request). */
export async function GET() {
  const member = await currentMember();
  if (!member) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  try {
    const r = await ensureReferralCode(member.id);
    return Response.json(r);
  } catch (err) {
    console.error('[billing/referral] failed:', err);
    return Response.json({ error: "Couldn't load your referral code." }, { status: 500 });
  }
}
