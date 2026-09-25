import 'server-only';

import { createSupabaseServerClient } from '../supabase/server';
import { isAdminEmail } from '../admin';
import { payerFor } from '../team';

/**
 * The signed-in member for a credit / billing route, or null.
 *
 * `payerId` is whose credit they spend — their team owner's, for a team
 * member — and `teamMember` is true for them. Billing routes that move money
 * (top-ups, plans, codes, the card portal) refuse team members: the owner
 * pays, and a member must not be able to buy on the owner's card.
 */
export async function currentMember(): Promise<{ id: string; email: string | null; admin: boolean; payerId: string; teamMember: boolean } | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return null;
    const payer = await payerFor(data.user.id);
    return { id: data.user.id, email: data.user.email ?? null, admin: isAdminEmail(data.user.email), payerId: payer.payerId, teamMember: Boolean(payer.memberId) };
  } catch {
    return null;
  }
}
