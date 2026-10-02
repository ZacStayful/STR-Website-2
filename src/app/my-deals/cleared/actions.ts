'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { restoreClearedDeal } from '@/lib/listing/tracked-server';

/** Batch 22d: "Bring back" on Cleared deals. The member is the session's; the key only picks one of their own cleared deals. */
export async function restoreClearedDealAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/my-deals/cleared');
  const key = formData.get('key');
  const ok = typeof key === 'string' && (await restoreClearedDeal(user.id, key));
  revalidatePath('/my-deals');
  redirect(`/my-deals/cleared?msg=${ok ? 'restored' : 'not_restored'}`);
}
