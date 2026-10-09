import 'server-only';

/**
 * Batch 25, Part C: the slower-spender nudge (the rule is nudge.ts).
 *
 *   claimNudgeIfDue   read wherever Batch 20's £5 notice is decided — after a
 *                     debit (credit/after-debit.ts) and in the daily runs'
 *                     notices (credit/low-credit-server.ts) — so whichever
 *                     comes first wins. A claim is one credit_nudges row per
 *                     credit landing; it stamps the £5 notice told, so the
 *                     nudge stands in for it for that landing.
 *   processNudges     the standout cron sends the claimed nudges inside the
 *                     text window (08:00–20:00 UK): Batch 23's auto_topup_link
 *                     text (texts on, no STOP) and an email (credit alerts on),
 *                     each charged once through Batch 23's charge-server
 *                     (si_text_pence / si_email_pence, never below zero).
 *
 * Off (nothing claimed, so Batch 20's notice runs as before) until
 * STANDOUT_ENABLED=true. With apply=false nothing is written or sent.
 */
import { createAdminClient } from '../supabase/admin';
import { getBillingSettings } from '../credit/unit-costs';
import { getBalance } from '../credit/ledger';
import { isAdminEmail } from '../admin';
import { recordActivity } from '../activity/log';
import { siteUrl } from '../url';
import { inSendingWindow } from '../sms/uk-time';
import { nudgeEmail as sendNudgeEmail } from '../email/si-calls';
import { callsDryRun } from '../voice/config';
import { latestLanding, type GrantRow } from '../voice/low-credit';
import { callText, nudgeEmail } from '../voice/templates';
import { claimCharge, releaseCharge, settleEmail, settleText } from '../voice/charge-server';
import { claimCallSlot } from '../voice/cap-server';
import { firstNameOf } from '../voice/member-server';
import { standoutEnabled } from './flags';
import { nudgeDue, type NudgeVerdict } from './nudge';
import { sendMemberText, textsOnFor } from './texts-server';

type Admin = ReturnType<typeof createAdminClient>;

export interface NudgeRunResult {
  due: number;
  results: { userId: string; outcome: string }[];
}

/** Low-credit calls that rang: the call (or its missed-call text and email) told them. */
const PLACED = ['ringing', 'answered', 'missed', 'voicemail'];

interface NudgeProfile {
  email: string | null;
  alert_credit: boolean | null;
  auto_topup_amount_pence: number | null;
  reengage_since: string | null;
  full_name: string | null;
}

/** What the rule needs for one member now; null when anything can't be read (then no nudge). */
async function nudgeFacts(admin: Admin, userId: string, now: Date, balancePence?: number): Promise<{ verdict: NudgeVerdict; landingId: string | null; existing: string | null } | null> {
  const settings = await getBillingSettings();
  const s = settings.standout;
  const since = new Date(now.getTime() - (s.slowerSpenderMaxDays + 31) * 86_400_000).toISOString();
  const [{ data: p, error: pErr }, { data: grants, error: gErr }] = await Promise.all([
    admin.from('profiles').select('email, alert_credit, auto_topup_amount_pence, reengage_since, full_name').eq('id', userId).maybeSingle(),
    admin.from('credit_grants').select('id, kind, amount_pence, source_ref, created_at').eq('user_id', userId).gt('amount_pence', 0).gte('created_at', since).order('created_at', { ascending: false }).limit(20),
  ]);
  if (pErr || gErr || !p) return null;
  const prof = p as NudgeProfile;
  const landing = latestLanding((grants ?? []) as GrantRow[]);
  let existing: string | null = null;
  let called = false;
  if (landing) {
    const [n, c] = await Promise.all([
      admin.from('credit_nudges').select('status').eq('user_id', userId).eq('landing_id', landing.id).maybeSingle(),
      admin.from('si_calls_log').select('id').eq('user_id', userId).eq('call_type', 'low_credit').eq('trigger_ref', landing.id).in('status', PLACED).limit(1),
    ]);
    if (n.error) return null;
    existing = (n.data as { status: string } | null)?.status ?? null;
    called = !c.error && (c.data ?? []).length > 0;
  }
  const balance = balancePence ?? (await getBalance(userId).catch(() => null))?.totalPence;
  if (balance === undefined) return null;
  const verdict = nudgeDue({
    balancePence: balance,
    lowCreditPence: settings.lifecycle.lowCreditPence,
    landing,
    now,
    minDays: s.slowerSpenderMinDays,
    maxDays: s.slowerSpenderMaxDays,
    autoTopupOn: Number(prof.auto_topup_amount_pence ?? 0) > 0,
    reengageSince: prof.reengage_since,
    lowCreditCallPlaced: called,
    nudgedThisLanding: existing !== null,
    canText: await textsOnFor(admin, userId),
    canEmail: Boolean(prof.email) && prof.alert_credit !== false,
    admin: isAdminEmail(prof.email),
  });
  return { verdict, landingId: landing?.id ?? null, existing };
}

/**
 * Whether the slower-spender nudge stands in for the £5 notice for this
 * member now: 'claimed' when one is due (claimed here when apply, and the
 * £5 notice stamped told), 'standing' when one was already claimed or sent
 * for their most recent credit, null otherwise. Never throws; null on any
 * doubt, so the £5 notice runs as before.
 */
export async function claimNudgeIfDue(admin: Admin, userId: string, now: Date, o: { apply: boolean; balancePence?: number }): Promise<'claimed' | 'standing' | null> {
  if (!standoutEnabled()) return null;
  try {
    const f = await nudgeFacts(admin, userId, now, o.balancePence);
    if (!f || !f.landingId) return null;
    if (f.existing === 'due' || f.existing === 'sent') return 'standing';
    if (!f.verdict.due) return null;
    if (!o.apply) return 'claimed';
    const { error } = await admin.from('credit_nudges').insert({ user_id: userId, landing_id: f.landingId, days_to_low: f.verdict.daysToLow, status: 'due', decided_at: now.toISOString() });
    if (error) {
      if (error.code === '23505') return 'standing';
      console.error('[nudge] claim failed:', error.message);
      return null;
    }
    // The £5 notice is told for this cycle (Batch 20's markLowCreditTold): the nudge is it.
    const { error: tErr } = await admin.from('profiles').update({ last_low_balance_email_at: now.toISOString() }).eq('id', userId);
    if (tErr) console.error('[nudge] told stamp failed:', tErr.message);
    return 'claimed';
  } catch (err) {
    console.error('[nudge] claim check failed:', err);
    return null;
  }
}

interface DueRow {
  id: string;
  user_id: string;
  landing_id: string;
}

export async function processNudges(o: { apply: boolean; now: Date; onlyUserId: string | null }): Promise<NudgeRunResult> {
  const out: NudgeRunResult = { due: 0, results: [] };
  const admin = createAdminClient();
  let q = admin.from('credit_nudges').select('id, user_id, landing_id').eq('status', 'due').order('decided_at', { ascending: true }).limit(200);
  if (o.onlyUserId) q = q.eq('user_id', o.onlyUserId);
  const { data, error } = await q;
  if (error) return out;
  const rows = (data ?? []) as DueRow[];
  out.due = rows.length;
  if (rows.length === 0) return out;
  if (!inSendingWindow(o.now)) {
    for (const r of rows) out.results.push({ userId: r.user_id, outcome: 'waiting_window' });
    return out;
  }
  for (const r of rows) {
    out.results.push({ userId: r.user_id, outcome: o.apply ? await sendNudge(admin, r, o.now) : 'would_send' });
  }
  return out;
}

async function finish(admin: Admin, id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from('credit_nudges').update(patch).eq('id', id).eq('status', 'due');
  if (error) console.error('[nudge] update failed:', error.message);
}

async function sendNudge(admin: Admin, r: DueRow, now: Date): Promise<string> {
  const settings = await getBillingSettings();
  const [{ data: p }, balance] = await Promise.all([
    admin.from('profiles').select('email, alert_credit, auto_topup_amount_pence, reengage_since, full_name').eq('id', r.user_id).maybeSingle(),
    getBalance(r.user_id).catch(() => null),
  ]);
  const prof = p as NudgeProfile | null;
  if (!prof || !balance) return 'error';
  // Things changed since it was claimed: nothing to nudge about.
  if (Number(prof.auto_topup_amount_pence ?? 0) > 0) {
    await finish(admin, r.id, { status: 'skipped', skip_reason: 'auto_topup_on' });
    return 'skipped:auto_topup_on';
  }
  if (balance.totalPence > settings.lifecycle.lowCreditPence) {
    await finish(admin, r.id, { status: 'skipped', skip_reason: 'topped_up' });
    return 'skipped:topped_up';
  }
  const offer = { topupAmountPence: settings.intelligence.revealAutoTopupAmountPence, topupThresholdPence: settings.intelligence.revealAutoTopupThresholdPence };
  const dry = callsDryRun();
  let texted = false;
  let emailed = false;

  const textKey = `nudge:${r.id}:text`;
  if (await textsOnFor(admin, r.user_id)) {
    const guard = await claimCharge(textKey, null, r.user_id, 'text');
    if (guard) {
      const t = await sendMemberText(admin, { userId: r.user_id, body: callText('auto_topup_link', { base: siteUrl(), ...offer }), kind: 'nudge', purpose: 'si_nudge', dryRun: dry, now });
      if (t.counted) {
        await settleText(guard, textKey, null, r.user_id);
        texted = true;
      } else await releaseCharge(guard);
    }
  }
  const emailKey = `nudge:${r.id}:email`;
  if (prof.email && prof.alert_credit !== false) {
    const guard = await claimCharge(emailKey, null, r.user_id, 'email');
    if (guard) {
      const sent = dry ? false : await sendNudgeEmail(prof.email, nudgeEmail({ ...offer, lowCreditPence: settings.lifecycle.lowCreditPence }, firstNameOf(prof.full_name)), `si-nudge:${r.id}`);
      if (sent) {
        await settleEmail(guard, emailKey, null, r.user_id);
        emailed = true;
      } else await releaseCharge(guard);
    }
  }
  if (!texted && !emailed) {
    await finish(admin, r.id, { status: 'skipped', skip_reason: dry ? 'dry_run' : 'nothing_sent' });
    return 'skipped:nothing_sent';
  }
  await finish(admin, r.id, { status: 'sent', sent_at: now.toISOString(), text_sent: texted, email_sent: emailed });
  await recordActivity(r.user_id, 'si_nudge_sent', { source: 'system', dedupeKey: `si_nudge_sent:${r.id}`, extras: { text: texted, email: emailed } });
  await claimCallSlot(r.user_id, now);
  return `sent:${texted ? 'text+' : ''}${emailed ? 'email' : 'no_email'}`;
}
