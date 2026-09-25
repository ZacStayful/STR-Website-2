'use server';

import { redirect, notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAdminEmail } from '@/lib/admin';
import { runSweep } from '@/lib/marketplace/sweep-run';
import { runMarketplaceRecheck } from '@/lib/marketplace/recheck-run';
import { parseLadder, DEFAULT_DEAL_OPEN_LADDER } from '@/lib/marketplace/ladder';
import { updateBillingSetting } from '@/lib/credit/unit-costs';
import { retireDeal, revalidateDeals } from '@/lib/marketplace/server';

// Mirrored in page.tsx: a 'use server' module may only export async functions.
const RUN_COOKIE = 'sf_deals_run';

async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/admin/deals');
  if (!isAdminEmail(user.email)) notFound();
  return user;
}

/** Stashes a short run summary for the page to render once, then goes back to it. */
async function finish(kind: string, body: Record<string, unknown>): Promise<never> {
  const jar = await cookies();
  // Lists are dropped so the cookie stays under the size a browser keeps.
  const compact = Object.fromEntries(Object.entries(body).filter(([, v]) => !Array.isArray(v)));
  const value = Buffer.from(JSON.stringify({ kind, at: new Date().toISOString(), body: compact })).toString('base64url').slice(0, 3800);
  jar.set(RUN_COOKIE, value, { maxAge: 300, path: '/admin/deals', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  redirect('/admin/deals');
}

export async function dryRunSweepAction(): Promise<void> {
  await requireAdmin();
  const result = await runSweep({ dry: true });
  await finish('sweep-dry', result.body as Record<string, unknown>);
}

export async function runSweepPassAction(): Promise<void> {
  await requireAdmin();
  const result = await runSweep({ dry: false });
  await finish('sweep', result.body as Record<string, unknown>);
}

export async function dryRunRecheckAction(): Promise<void> {
  await requireAdmin();
  const result = await runMarketplaceRecheck({ dry: true });
  await finish('recheck-dry', result.body as Record<string, unknown>);
}

export async function runRecheckPassAction(): Promise<void> {
  await requireAdmin();
  const result = await runMarketplaceRecheck({ dry: false });
  await finish('recheck', result.body as Record<string, unknown>);
}

export async function retireDealAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const url = String(formData.get('canonical_url') ?? '');
  if (!/^https?:\/\//.test(url)) redirect('/admin/deals?msg=bad_url');
  await retireDeal(createAdminClient(), url, 'admin');
  revalidateDeals();
  redirect('/admin/deals?msg=retired');
}

export async function restoreDealAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const url = String(formData.get('canonical_url') ?? '');
  if (!/^https?:\/\//.test(url)) redirect('/admin/deals?msg=bad_url');
  const now = new Date().toISOString();
  const { error } = await createAdminClient().from('marketplace_deals').update({ status: 'live', retired_reason: null, retired_at: null, next_check_due_at: now, updated_at: now }).eq('canonical_url', url).eq('retired_reason', 'admin');
  if (error) redirect('/admin/deals?msg=failed');
  revalidateDeals();
  redirect('/admin/deals?msg=restored');
}

/** The open-price ladder from the form: five "upTo" / "pence" pairs, last upTo blank for the open top band. */
export async function updateLadderAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const bands: { upTo: number | null; pence: number }[] = [];
  for (let i = 0; i < 8; i += 1) {
    const pence = formData.get(`pence_${i}`);
    if (pence === null || String(pence).trim() === '') continue;
    const upToRaw = String(formData.get(`upTo_${i}`) ?? '').trim();
    bands.push({ upTo: upToRaw === '' ? null : Number(upToRaw), pence: Number(pence) });
  }
  const parsed = parseLadder(bands);
  if (parsed === DEFAULT_DEAL_OPEN_LADDER && JSON.stringify(bands) !== JSON.stringify(DEFAULT_DEAL_OPEN_LADDER)) redirect('/admin/deals?msg=bad_ladder');
  await updateBillingSetting('deal_open_ladder', parsed);
  redirect('/admin/deals?msg=ladder_saved');
}
