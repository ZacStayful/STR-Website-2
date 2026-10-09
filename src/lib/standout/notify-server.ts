import 'server-only';

/**
 * Batch 25: telling a member about a standout saved for them (the plan is in
 * notify.ts). Run by the standout pass, after the saves:
 *
 *   1. plan    each member's saves nobody has told them about yet: a deal call
 *              (Batch 23's queue, call_type 'deal', one per member per deal),
 *              a text and email below the call floor, or "Saved for you" in
 *              the next daily email (notify = 'email'; notify/message.ts)
 *   2. sync    each deal call's progress from si_calls_log onto its decision;
 *              a call that was stopped before it rang is planned again, so
 *              the member is still told another way (unless the deal went or
 *              they got there first)
 *
 * Charges only through Batch 23's charge-server (claimCharge → send →
 * settleText / settleEmail, or releaseCharge), never below zero, once per
 * decision and channel (charge keys standout:<decision>:text|email). A
 * missed deal call is free; its text and email are Batch 23's fallback.
 * With apply=false nothing is written, queued, sent or charged.
 */
import { createAdminClient } from '../supabase/admin';
import { getBillingSettings } from '../credit/unit-costs';
import { recordActivity } from '../activity/log';
import { siteUrl } from '../url';
import { inSendingWindow } from '../sms/uk-time';
import { missedCallEmail as sendSiEmail } from '../email/si-calls';
import { callsDryRun, callsEnabled } from '../voice/config';
import { inOutboundHours, ukDay } from '../voice/hours';
import { memberFacts, type MemberFacts } from '../voice/member-server';
import { enqueueCall, placeCall } from '../voice/queue-server';
import { callPencePerMinute, claimCharge, releaseCharge, settleEmail, settleText } from '../voice/charge-server';
import { claimCallSlot } from '../voice/cap-server';
import { belowFloorText, dealEmail } from '../voice/templates';
import { dealCallsEnabled } from './flags';
import { belowFloorChannels, callFloorPence, planMember, syncFromCall, type NotifyCandidate, type NotifyStep, type QueuedDealCall } from './notify';
import { dealCallsThisMonth, dealFactsFor, stillShownFor } from './calls-server';
import { sendMemberText, textsOnFor } from './texts-server';

export { dealCallsEnabled } from './flags';

type Admin = ReturnType<typeof createAdminClient>;

export interface NotifyResult {
  considered: number;
  results: { userId: string; dealId: string; outcome: string }[];
}

/** A save older than this is not rung about: it goes in "Saved for you". */
const CALL_MAX_AGE_MS = 3 * 24 * 60 * 60_000;
const MAX_PER_PASS = 300;
const STUCK_CLAIM_MS = 10 * 60_000;

interface PendingRow {
  id: string;
  user_id: string;
  deal_id: string;
  deal_type: string | null;
  match_pct: number | null;
  profit_low_pcm: number | null;
  saved_at: string;
  call_status: string | null;
}

interface CallingRow {
  id: string;
  user_id: string;
  deal_id: string;
  call_id: string | null;
  call_status: string | null;
  emailed_at: string | null;
  updated_at: string;
}

export async function processNotifications(o: { apply: boolean; now: Date; onlyUserId: string | null }): Promise<NotifyResult> {
  const out: NotifyResult = { considered: 0, results: [] };
  const admin = createAdminClient();
  await planPass(admin, o, out);
  if (o.apply) await syncPass(admin, o, out);
  return out;
}

// ── 1. Plan ──

async function planPass(admin: Admin, o: { apply: boolean; now: Date; onlyUserId: string | null }, out: NotifyResult): Promise<void> {
  let q = admin
    .from('standout_decisions')
    .select('id, user_id, deal_id, deal_type, match_pct, profit_low_pcm, saved_at, call_status')
    .eq('outcome', 'standout')
    .not('saved_at', 'is', null)
    .is('notify', null)
    .not('deal_id', 'is', null)
    .is('not_for_me_at', null)
    .is('opened_at', null)
    .is('stage_moved_at', null)
    .order('saved_at', { ascending: true })
    .limit(MAX_PER_PASS);
  if (o.onlyUserId) q = q.eq('user_id', o.onlyUserId);
  const { data, error } = await q;
  if (error) {
    console.error('[standout] notify read failed:', error.message);
    return;
  }
  const rows = (data ?? []) as PendingRow[];
  out.considered = rows.length;
  if (rows.length === 0) return;

  const live = await liveDealIds(admin, [...new Set(rows.map((r) => r.deal_id))]);
  const byUser = new Map<string, PendingRow[]>();
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);

  const [settings, perMin] = await Promise.all([getBillingSettings(), callPencePerMinute()]);
  const s = settings.standout;
  const floor = callFloorPence(s.callMinBalancePence, perMin, settings.voice.textsPerCallMax * settings.intelligence.siTextPence);
  const switchedOn = dealCallsEnabled() && callsEnabled();

  for (const [userId, list] of byUser) {
    const rowById = new Map(list.map((r) => [r.id, r]));
    const m = await memberFacts(userId);
    const [placed, queued] = await Promise.all([dealCallsThisMonth(admin, userId, o.now), queuedDealCall(admin, userId)]);
    const candidates: NotifyCandidate[] = list.map((r) => ({ decisionId: r.id, matchPct: r.match_pct, profitLow: r.profit_low_pcm, savedAt: r.saved_at, dealLive: live.has(r.deal_id) }));
    const steps =
      placed === null || queued === 'error'
        ? list.map((r): NotifyStep => ({ decisionId: r.id, action: 'wait', status: 'pending' }))
        : planMember({
            candidates,
            callsSwitchedOn: switchedOn,
            member: m ? { isOwner: m.isOwner, callsOn: m.callsOn, numberOk: m.numberOk, managementOnly: m.managementOnly, balancePence: m.balancePence } : null,
            placedThisMonth: placed,
            callsPerMonth: s.callsPerMonth,
            floorPence: floor,
            queued,
            textWindow: inSendingWindow(o.now),
            now: o.now,
            maxAgeMs: CALL_MAX_AGE_MS,
          });
    for (const step of steps) {
      const row = rowById.get(step.decisionId)!;
      const outcome = o.apply ? await applyStep(admin, step, row, m, o.now) : `would_${step.action}${'status' in step ? `:${step.status}` : ''}`;
      out.results.push({ userId, dealId: row.deal_id, outcome });
    }
  }
}

async function liveDealIds(admin: Admin, ids: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await admin.from('marketplace_deals').select('id').in('id', ids.slice(i, i + 150)).eq('status', 'live');
    if (error) {
      // Unreadable: treat every deal as live; the call's own last check reads it again.
      ids.slice(i, i + 150).forEach((id) => out.add(id));
      continue;
    }
    for (const r of (data ?? []) as { id: string }[]) out.add(r.id);
  }
  return out;
}

/** The member's deal call waiting in the queue, with the decision it is about. */
async function queuedDealCall(admin: Admin, userId: string): Promise<QueuedDealCall | null | 'error'> {
  const { data, error } = await admin.from('si_calls_log').select('id, trigger_ref').eq('user_id', userId).eq('call_type', 'deal').eq('status', 'queued').limit(1);
  if (error) return 'error';
  const call = ((data ?? [])[0] as { id: string; trigger_ref: string | null } | undefined) ?? null;
  if (!call) return null;
  const { data: d } = await admin.from('standout_decisions').select('id, match_pct, profit_low_pcm').eq('call_id', call.id).limit(1);
  const dec = ((d ?? [])[0] as { id: string; match_pct: number | null; profit_low_pcm: number | null } | undefined) ?? null;
  return { callId: call.id, decisionId: dec?.id ?? null, matchPct: dec?.match_pct ?? null, profitLow: dec?.profit_low_pcm ?? null };
}

/** Set a decision's notify once (only while nobody else has). */
async function claimNotify(admin: Admin, id: string, patch: Record<string, unknown>, now: Date): Promise<boolean> {
  const { data, error } = await admin.from('standout_decisions').update({ ...patch, updated_at: now.toISOString() }).eq('id', id).is('notify', null).select('id');
  if (error) console.error('[standout] notify write failed:', error.message);
  return !error && (data ?? []).length === 1;
}

async function applyStep(admin: Admin, step: NotifyStep, row: PendingRow, m: MemberFacts | null, now: Date): Promise<string> {
  switch (step.action) {
    case 'none':
      await claimNotify(admin, row.id, { notify: 'none', call_status: step.status }, now);
      return step.status;
    case 'email':
      await claimNotify(admin, row.id, { notify: 'email', call_status: step.status }, now);
      return `email:${step.status}`;
    case 'wait':
      await admin.from('standout_decisions').update({ call_status: step.status, updated_at: now.toISOString() }).eq('id', row.id).is('notify', null);
      return `wait:${step.status}`;
    case 'retarget':
      return retarget(admin, step, row, now);
    case 'call':
      return startCall(admin, row, now);
    case 'below_floor':
      return m ? belowFloor(admin, row, m, now) : 'error';
  }
}

/** A better standout takes over the member's waiting deal call (one call, about the best). */
async function retarget(admin: Admin, step: Extract<NotifyStep, { action: 'retarget' }>, row: PendingRow, now: Date): Promise<string> {
  const { data, error } = await admin.from('si_calls_log').update({ trigger_ref: row.deal_id, updated_at: now.toISOString() }).eq('id', step.callId).eq('status', 'queued').select('id');
  if (error || (data ?? []).length !== 1) {
    // Rung or stopped meanwhile, or this deal already had its call: tell them in "Saved for you".
    await claimNotify(admin, row.id, { notify: 'email', call_status: 'one_call' }, now);
    return 'email:one_call';
  }
  await admin.from('standout_decisions').update({ notify: 'call', call_id: step.callId, call_status: 'queued', updated_at: now.toISOString() }).eq('id', row.id);
  if (step.replaces) await admin.from('standout_decisions').update({ notify: 'email', call_id: null, call_status: 'one_call', updated_at: now.toISOString() }).eq('id', step.replaces);
  return 'call:retargeted';
}

const ENQUEUE_STATUS: Record<string, string> = { calls_off: 'calls_off', not_owner: 'not_owner', management_no_deals: 'management_only', no_number: 'no_number', disabled: 'deal_calls_off', unknown_member: 'calls_off' };

async function startCall(admin: Admin, row: PendingRow, passStart: Date): Promise<string> {
  // Claim the decision first, so two passes never queue two calls for it.
  if (!(await claimNotify(admin, row.id, { notify: 'call', call_status: 'pending' }, passStart))) return 'call:raced';
  // The clock as the call is queued and dialled, not the pass's start: a slow (or admin-run) pass must not dial after hours.
  const now = new Date();
  const set = (patch: Record<string, unknown>) => admin.from('standout_decisions').update({ ...patch, updated_at: now.toISOString() }).eq('id', row.id).eq('notify', 'call');
  const r = await enqueueCall({ userId: row.user_id, type: 'deal', triggerRef: row.deal_id, context: 'deal', now }).catch((err) => {
    console.error('[standout] deal call not queued:', err);
    return { outcome: 'error' as const };
  });
  if (r.outcome === 'queued') {
    const later = r.call.not_before !== null && Date.parse(r.call.not_before) > now.getTime();
    // Inside hours, a call that waits is waiting for tomorrow: today's call is used (Batch 23's one a day).
    const status = later && inOutboundHours(now, (await getBillingSettings()).voice) && ukDay(new Date(r.call.not_before!)) !== ukDay(now) ? 'waiting_called_today' : 'queued';
    await set({ call_id: r.call.id, call_status: status });
    if (!later) {
      const placed = await placeCall(r.call, { apply: true, now: new Date() }).catch((err) => {
        console.error('[standout] deal call failed to place:', err);
        return null;
      });
      return `call:${placed?.outcome ?? 'error'}`;
    }
    return `call:${status}`;
  }
  // Another call queued or ringing, under Batch 23's own minute check, or the queue unwritable: plan again next pass.
  const again = (status: string) => set({ notify: null, call_status: status });
  if (r.outcome === 'skipped' && r.reason === 'in_flight') {
    await again('pending');
    return 'wait:in_flight';
  }
  if (r.outcome === 'skipped' && r.reason === 'no_credit') {
    await again('below_floor');
    return 'wait:no_credit';
  }
  if (r.outcome === 'error') {
    await again('error');
    return 'wait:error';
  }
  // This deal's one call was already used (and stopped): keep the reason it was stopped.
  const status =
    r.outcome === 'exists' ? (row.call_status && (row.call_status.startsWith('blocked:') || row.call_status === 'failed') ? row.call_status : 'exists') : r.outcome === 'blocked' ? `blocked:${r.reason}` : ENQUEUE_STATUS[r.reason] ?? r.reason;
  await set({ notify: 'email', call_status: status, ...(r.outcome === 'blocked' && r.call ? { call_id: r.call.id } : {}) });
  return `email:${status}`;
}

/** Credit below the call floor: no call; a text (texts on, and credit for it) and an email with the link and "top up to get calls". */
async function belowFloor(admin: Admin, row: PendingRow, m: MemberFacts, now: Date): Promise<string> {
  // It may have waited for the text window: still a deal type their main profile shows?
  const shown = await stillShownFor(admin, m.userId, row.deal_type, now);
  if (shown === null) return 'wait:profile_unreadable';
  if (shown !== 'ok') {
    await claimNotify(admin, row.id, { notify: 'none', call_status: shown }, now);
    return shown;
  }
  if (!(await claimNotify(admin, row.id, { notify: 'email', call_status: 'below_floor' }, now))) return 'below_floor:raced';
  const settings = await getBillingSettings();
  const [facts, textsOn] = await Promise.all([dealFactsFor(admin, m.userId, row.deal_id), textsOnFor(admin, m.userId)]);
  const deal = facts?.deal ?? null;
  const ch = belowFloorChannels({ textsOn, balancePence: m.balancePence, textPence: settings.intelligence.siTextPence, emailPence: settings.intelligence.siEmailPence });
  const dry = callsDryRun();
  let texted = false;
  let emailed = false;

  if (ch.text) {
    const key = `standout:${row.id}:text`;
    const guard = await claimCharge(key, null, m.userId, 'text');
    if (guard) {
      const ctx = { base: siteUrl(), topupAmountPence: settings.intelligence.revealAutoTopupAmountPence, topupThresholdPence: settings.intelligence.revealAutoTopupThresholdPence, deal };
      const r = await sendMemberText(admin, { userId: m.userId, body: belowFloorText(ctx), kind: 'standout', purpose: 'si_standout', dryRun: dry, now });
      if (r.counted) {
        await settleText(guard, key, null, m.userId);
        texted = true;
      } else await releaseCharge(guard);
    }
  }
  if (m.email) {
    const copy = dealEmail('below_floor', deal, m.firstName, null);
    if (ch.chargeEmail) {
      const key = `standout:${row.id}:email`;
      const guard = await claimCharge(key, null, m.userId, 'email');
      if (guard) {
        const sent = dry ? false : await sendSiEmail(m.email, copy, `si-standout:${row.id}`);
        if (sent) {
          await settleEmail(guard, key, null, m.userId);
          emailed = true;
        } else await releaseCharge(guard);
      }
    } else {
      // The balance can't cover it: the email goes free (the idempotency key stops a second).
      emailed = dry ? false : await sendSiEmail(m.email, copy, `si-standout:${row.id}`);
    }
  }
  const iso = now.toISOString();
  // Emailed (or not: then "Saved for you" carries it, as notify is 'email').
  await admin.from('standout_decisions').update({ ...(texted ? { texted_at: iso } : {}), ...(emailed ? { emailed_at: iso } : {}), updated_at: iso }).eq('id', row.id);
  if (texted || emailed) await claimCallSlot(m.userId, now);
  return `below_floor:${texted ? 'text+' : ''}${emailed ? 'email' : 'no_email'}`;
}

// ── 2. Sync deal calls ──

async function syncPass(admin: Admin, o: { now: Date; onlyUserId: string | null }, out: NotifyResult): Promise<void> {
  let q = admin.from('standout_decisions').select('id, user_id, deal_id, call_id, call_status, emailed_at, updated_at').eq('notify', 'call').in('call_status', ['pending', 'queued', 'waiting_called_today', 'ringing']).limit(MAX_PER_PASS);
  if (o.onlyUserId) q = q.eq('user_id', o.onlyUserId);
  const { data, error } = await q;
  if (error) return;
  const rows = (data ?? []) as CallingRow[];
  if (rows.length === 0) return;
  const ids = rows.map((r) => r.call_id).filter((x): x is string => Boolean(x));
  const calls = new Map<string, { id: string; status: string; blocked_reason: string | null; fallback_sent_at: string | null; placed_at: string | null }>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data: c, error: cErr } = await admin.from('si_calls_log').select('id, status, blocked_reason, fallback_sent_at, placed_at').in('id', ids.slice(i, i + 150));
    if (cErr) return;
    for (const r of (c ?? []) as { id: string; status: string; blocked_reason: string | null; fallback_sent_at: string | null; placed_at: string | null }[]) calls.set(r.id, r);
  }
  const iso = o.now.toISOString();
  for (const r of rows) {
    // Claimed but never queued (a pass that stopped part-way): plan it again once it has sat a while.
    if (!r.call_id && o.now.getTime() - Date.parse(r.updated_at) < STUCK_CLAIM_MS) continue;
    const call = r.call_id ? calls.get(r.call_id) ?? null : null;
    const s = syncFromCall(call);
    if (!s || s.callStatus === r.call_status) continue;
    const patch: Record<string, unknown> = { call_status: s.callStatus, notify: s.notify, updated_at: iso };
    // A missed call's text and email were Batch 23's fallback: the deal is told.
    if (call?.fallback_sent_at && !r.emailed_at) patch.emailed_at = call.fallback_sent_at;
    const { data: moved } = await admin.from('standout_decisions').update(patch).eq('id', r.id).eq('notify', 'call').select('id');
    if ((moved ?? []).length !== 1) continue;
    if ('activity' in s && s.activity && call) await recordActivity(r.user_id, s.activity, { dealId: r.deal_id, source: 'system', dedupeKey: `${s.activity}:${call.id}`, at: call.placed_at ?? iso });
    out.results.push({ userId: r.user_id, dealId: r.deal_id, outcome: `sync:${s.callStatus}` });
  }
}
