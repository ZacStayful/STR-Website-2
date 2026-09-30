import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { parseDateSetting } from '../credit/deal-pricing';
import { LIFECYCLE_KEYS, welcomeGrantRef } from './settings';

/**
 * The starter pack's cutover, read straight from billing_settings, for the
 * one decision that must not fall back to a default: whether a new account
 * gets the welcome credit. getBillingSettings() answers "not set" when the
 * table cannot be read, which here would hand £20 to a member the pack was
 * meant for; this says it could not tell instead, and the caller waits.
 */
export async function readStarterPackCutover(): Promise<{ ok: true; from: string | null } | { ok: false }> {
  if (!hasServiceRole()) return { ok: false };
  try {
    const { data, error } = await createAdminClient().from('billing_settings').select('value').eq('key', LIFECYCLE_KEYS.starterPackFrom).maybeSingle();
    if (error) return { ok: false };
    return { ok: true, from: parseDateSetting((data as { value?: unknown } | null)?.value ?? null) };
  } catch {
    return { ok: false };
  }
}

const PAGE = 1000;
const CHUNK = 300;

/**
 * The cutover was moved later or cleared (strandedByCutoverMove): accounts
 * created in between were checked as pack accounts, so they got no welcome
 * credit, and they are now before the cutover, so no pack either. Their
 * welcome check is cleared, and the next sign-in decides it again and grants
 * the £20 (after the same abuse checks) as for anyone who joined before the
 * cutover. Left alone: anyone who already has the welcome credit, has a pack
 * (bought or being paid for), or was withheld the credit (a disposable email,
 * a number already used, a team member). Returns how many were reopened.
 */
export async function reopenWelcomeCheck(window: { from: string; to: string | null }): Promise<{ ok: true; reopened: number } | { ok: false; error: string }> {
  if (!hasServiceRole()) return { ok: false, error: 'no service role' };
  const admin = createAdminClient();
  const ids: string[] = [];
  for (let at = 0; ; at += PAGE) {
    let q = admin.from('profiles').select('id').gte('created_at', window.from).not('welcome_checked_at', 'is', null).is('welcome_withheld_reason', null);
    if (window.to) q = q.lt('created_at', window.to);
    const { data, error } = await q.order('id', { ascending: true }).range(at, at + PAGE - 1);
    if (error) return { ok: false, error: `profiles read failed: ${error.message}` };
    ids.push(...((data ?? []) as { id: string }[]).map((r) => r.id));
    if ((data?.length ?? 0) < PAGE) break;
  }
  let reopened = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const some = ids.slice(i, i + CHUNK);
    const [grants, packs] = await Promise.all([
      admin.from('credit_grants').select('user_id').in('source_ref', some.map(welcomeGrantRef)),
      admin.from('starter_pack_purchases').select('user_id').in('user_id', some).in('status', ['reserved', 'granted']),
    ]);
    if (grants.error) return { ok: false, error: `welcome grants read failed: ${grants.error.message}` };
    if (packs.error) return { ok: false, error: `starter packs read failed: ${packs.error.message}` };
    const keep = new Set([...((grants.data ?? []) as { user_id: string }[]), ...((packs.data ?? []) as { user_id: string | null }[])].map((r) => r.user_id));
    const reopen = some.filter((id) => !keep.has(id));
    if (reopen.length === 0) continue;
    const { data, error } = await admin.from('profiles').update({ welcome_checked_at: null }).in('id', reopen).is('welcome_withheld_reason', null).select('id');
    if (error) return { ok: false, error: `reopen failed: ${error.message}` };
    reopened += data?.length ?? 0;
  }
  return { ok: true, reopened };
}
