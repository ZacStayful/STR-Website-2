import { currentMember } from '@/lib/credit/auth';
import { loadBillingProfile, cardSummary } from '@/lib/stripe/customer';
import { stripeConfigured } from '@/lib/stripe/client';

export const dynamic = 'force-dynamic';

/**
 * Batch 20, Part B: GET → { card: { brand, last4 } | null }, the saved card a
 * one-tap plan or top-up would go on, for the confirm sheet ("on your card
 * ending 4242"). Read when the sheet opens, not on every page.
 */
export async function GET() {
  const member = await currentMember();
  if (!member) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  if (member.teamMember || !stripeConfigured()) return Response.json({ card: null });
  const profile = await loadBillingProfile(member.id);
  const card = await cardSummary(profile?.stripe_default_payment_method_id ?? null);
  return Response.json({ card: card ? { brand: card.brand, last4: card.last4 } : null }, { headers: { 'cache-control': 'no-store' } });
}
