import { currentMember } from '@/lib/credit/auth';
import { getBillingSettings } from '@/lib/credit/unit-costs';
import { loadBillingProfile } from '@/lib/stripe/customer';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** POST { amountPence | null, thresholdPence } — opt in/out of auto top-up (needs a saved card). */
export async function POST(request: Request) {
  const member = await currentMember();
  if (!member) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  let body: { amountPence?: unknown; thresholdPence?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const settings = await getBillingSettings();
  const amount = body.amountPence === null ? null : Number(body.amountPence);
  if (amount !== null && !settings.topupPresetsPence.includes(amount)) return Response.json({ error: 'Choose one of the top-up amounts.' }, { status: 400 });
  const threshold = Number(body.thresholdPence ?? 500);
  if (!Number.isFinite(threshold) || threshold < 100 || threshold > 10000) return Response.json({ error: 'Threshold must be between £1 and £100.' }, { status: 400 });
  const profile = await loadBillingProfile(member.id);
  if (!profile) return Response.json({ error: 'Your account is not set up yet.' }, { status: 403 });
  if (amount !== null && !profile.stripe_default_payment_method_id) return Response.json({ error: 'Save a card first: make one top-up through checkout, then turn auto top-up on.' }, { status: 400 });
  const { error } = await createAdminClient().from('profiles').update({ auto_topup_amount_pence: amount, auto_topup_threshold_pence: Math.round(threshold) }).eq('id', member.id);
  if (error) return Response.json({ error: "Couldn't save that." }, { status: 500 });
  return Response.json({ ok: true, amountPence: amount, thresholdPence: Math.round(threshold) });
}
