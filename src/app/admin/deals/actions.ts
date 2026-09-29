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
import { parseR2rBar } from '@/lib/listing/screen';
import { retireDeal, revalidateDeals } from '@/lib/marketplace/server';
import { runLowEntrySearch } from '@/lib/deal-quality/low-entry-run';
import { runDealChecks } from '@/lib/deal-quality/checks-run';
import { retireUncheckedLive, runDealRecheck } from '@/lib/deal-quality/recheck-comps-run';
import { DEAL_CHECKS_KEY, LOW_ENTRY_KEY, parseDealChecks, parseLowEntry, type DealChecksSettings, type LowEntrySettings } from '@/lib/deal-quality/config';

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

// ── Batch 16, Part F: the nationwide low-entry search ──

/** The dry run keeps its area list (the cookie drops arrays) as one line. */
function withAreaList(body: Record<string, unknown>): Record<string, unknown> {
  return { ...body, ...(Array.isArray(body.wouldQuery) ? { wouldQuery: (body.wouldQuery as string[]).join(', ') } : {}) };
}

export async function dryRunLowEntryAction(): Promise<void> {
  const user = await requireAdmin();
  const result = await runLowEntrySearch({ dry: true, triggeredBy: user.email ?? 'admin' });
  await finish('low-entry-dry', withAreaList(result.body as Record<string, unknown>));
}

export async function runLowEntryPassAction(): Promise<void> {
  const user = await requireAdmin();
  const result = await runLowEntrySearch({ dry: false, triggeredBy: user.email ?? 'admin' });
  await finish('low-entry', result.body as Record<string, unknown>);
}

/**
 * billing_settings.low_entry from the form: whole numbers within the bounds
 * in src/lib/deal-quality/config.ts. A value the bounds refuse is reported,
 * never quietly replaced by the default.
 */
export async function updateLowEntryAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const whole = (name: string) => {
    const raw = String(formData.get(name) ?? '').replace(/[£,\s]/g, '');
    return /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  };
  const next: LowEntrySettings = { maxCashIn: whole('maxCashIn'), searchMaxPrice: whole('searchMaxPrice'), minBedrooms: whole('minBedrooms'), weeklyCapPence: whole('weeklyCapPence'), areasPerPass: whole('areasPerPass') };
  const parsed = parseLowEntry(next);
  if ((Object.keys(next) as (keyof LowEntrySettings)[]).some((k) => parsed[k] !== next[k])) redirect('/admin/deals?msg=bad_low_entry');
  await updateBillingSetting(LOW_ENTRY_KEY, parsed);
  redirect('/admin/deals?msg=low_entry_saved');
}

// ── Batch 16, Part B: the daily paid checks ──

/** The dry run keeps its list (the cookie drops arrays) as one line. */
function withList(body: Record<string, unknown>): Record<string, unknown> {
  return { ...body, ...(Array.isArray(body.wouldCheck) ? { wouldCheck: (body.wouldCheck as string[]).join(' | ') } : {}) };
}

/** "Dry run" lists the day's slots and what would be checked, spending nothing; "Run" makes one pass now, whatever DEAL_CHECKS_ENABLED says. House spend. */
export async function runDealChecksAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const dry = formData.get('mode') !== 'run';
  const result = await runDealChecks({ dry, triggeredBy: user.email ?? 'admin' });
  await finish(dry ? 'deal-checks-dry' : 'deal-checks', withList(result.body as Record<string, unknown>));
}

/** The one-off re-check of live deals: "Dry run" counts and lists what it would check first; "Run" carries on where the last run stopped, within the ceiling. */
export async function runDealRecheckAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const dry = formData.get('mode') !== 'run';
  const result = await runDealRecheck({ dry, triggeredBy: user.email ?? 'admin' });
  await finish(dry ? 'deal-recheck-dry' : 'deal-recheck', withList(result.body as Record<string, unknown>));
}

/** Retires every live deal that has no check of its own as `unchecked`; the next sweep revives it onto the shortlist. "Dry run" only counts. */
export async function retireUncheckedAction(formData: FormData): Promise<void> {
  const user = await requireAdmin();
  const dry = formData.get('mode') !== 'retire';
  const result = await retireUncheckedLive({ dry, triggeredBy: user.email ?? 'admin' });
  await finish(dry ? 'retire-unchecked-dry' : 'retire-unchecked', result.body as Record<string, unknown>);
}

/**
 * billing_settings.deal_checks from the form: whole numbers within the
 * bounds in src/lib/deal-quality/config.ts. A value the bounds refuse is
 * reported, never quietly replaced by the default.
 */
export async function updateDealChecksAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const whole = (name: string) => {
    const raw = String(formData.get(name) ?? '').replace(/[£,\s]/g, '');
    return /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  };
  const next: DealChecksSettings = {
    perDay: whole('perDay'),
    dailyCapPence: whole('dailyCapPence'),
    split: { top60: whole('splitTop60'), low_entry: whole('splitLowEntry'), r2r: whole('splitR2r') },
    maxCallsPerCheck: whole('maxCallsPerCheck'),
    validDays: whole('validDays'),
    shortlistExpiryDays: whole('shortlistExpiryDays'),
    recheckCeilingPence: whole('recheckCeilingPence'),
  };
  const parsed = parseDealChecks(next);
  const same = (['perDay', 'dailyCapPence', 'maxCallsPerCheck', 'validDays', 'shortlistExpiryDays', 'recheckCeilingPence'] as const).every((k) => parsed[k] === next[k]) && parsed.split.top60 === next.split.top60 && parsed.split.low_entry === next.split.low_entry && parsed.split.r2r === next.split.r2r;
  if (!same) redirect('/admin/deals?msg=bad_deal_checks');
  await updateBillingSetting(DEAL_CHECKS_KEY, parsed);
  redirect('/admin/deals?msg=deal_checks_saved');
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

/**
 * The rent-to-rent bar (billing_settings.r2r_qualified_profit): whole pounds
 * a year of profit after rent and running costs, between the £4,000 medium
 * bar and the £20,000 cash bar. New screenings read it within a minute.
 */
export async function updateR2rBarAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const raw = String(formData.get('r2rBar') ?? '').replace(/[£,\s]/g, '');
  const pounds = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (parseR2rBar(pounds) !== pounds) redirect('/admin/deals?msg=bad_r2r_bar');
  await updateBillingSetting('r2r_qualified_profit', pounds);
  redirect('/admin/deals?msg=r2r_saved');
}
