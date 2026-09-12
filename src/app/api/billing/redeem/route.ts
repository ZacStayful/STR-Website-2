import { currentMember } from '@/lib/credit/auth';
import { CodeError, redeemCode, getBalance } from '@/lib/credit/ledger';

export const dynamic = 'force-dynamic';

const MESSAGES: Record<string, string> = {
  code_required: 'Enter a code.',
  code_invalid: "That code isn't valid.",
  code_expired: 'That code has expired.',
  code_exhausted: 'That code has been fully redeemed.',
  code_own_referral: "You can't use your own referral code.",
  code_already_used: "You've already used that code.",
  referral_already_used: "You've already used a referral code.",
  not_configured: 'Codes are not available right now.',
};

/** POST { code } → { ok, amountPence, kind, balancePence } */
export async function POST(request: Request) {
  const member = await currentMember();
  if (!member) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  let body: { code?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const code = typeof body.code === 'string' ? body.code.trim().slice(0, 40) : '';
  try {
    const r = await redeemCode(member.id, code);
    const bal = await getBalance(member.id);
    return Response.json({ ok: true, ...r, balancePence: bal.totalPence });
  } catch (err) {
    if (err instanceof CodeError) return Response.json({ error: MESSAGES[err.reason] ?? "That code isn't valid." }, { status: 400 });
    console.error('[billing/redeem] failed:', err);
    return Response.json({ error: "Couldn't redeem the code. Please try again." }, { status: 500 });
  }
}
