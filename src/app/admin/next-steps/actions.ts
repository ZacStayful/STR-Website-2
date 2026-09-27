'use server';

import { redirect, notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { updateBillingSetting } from '@/lib/credit/unit-costs';
import { OFFER_RULES_KEY, rulesFromForm } from '@/lib/pipeline/offer-rules';
import { invalidateOfferRules } from '@/lib/pipeline/rules-server';

async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/admin/next-steps');
  if (!isAdminEmail(user.email)) notFound();
  return user;
}

/**
 * Saves the offer range's discount bands. Blank rows are dropped; a filled
 * row that does not parse refuses the whole save. Saving with every row
 * blank switches the listing-history part of the range off.
 */
export async function saveOfferRulesAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const rules = rulesFromForm((name) => {
    const v = formData.get(name);
    return typeof v === 'string' ? v : null;
  });
  if (!rules) redirect('/admin/next-steps?msg=bad');
  try {
    await updateBillingSetting(OFFER_RULES_KEY, rules);
  } catch (err) {
    console.error('[admin/next-steps] save failed:', err);
    redirect('/admin/next-steps?msg=failed');
  }
  invalidateOfferRules();
  redirect('/admin/next-steps?msg=saved');
}
