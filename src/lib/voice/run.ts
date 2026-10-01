import 'server-only';

/**
 * Batch 23: the calls cron (/api/internal/si-calls, every 5 minutes). Each
 * pass, in order:
 *   1. intros for members who turned calls on with no intro yet (those who
 *      said yes before Batch 23 went live, or whose fast path failed)
 *   2. place the queued calls that are due, re-checking every safety rule
 *   3. reconcile calls still "ringing" after 30 minutes from Twilio (a lost
 *      webhook), charging an answered call's minutes once and sending a
 *      missed call's text and email
 *   4. once a UK day, delete transcripts past retention (questions kept)
 * With apply=false (?dry=1) every step reports what it would do and changes
 * nothing.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { getBillingSettings } from '../credit/unit-costs';
import { callsEnabled, STALE_RINGING_MS } from './config';
import { ukDay } from './hours';
import { enqueueCall, placeCall } from './queue-server';
import { CALL_COLUMNS, claimEvent, finishEvent, isSchemaMissing, updateCall, type CallRow } from './store-server';
import { fetchCall, statusFromTwilio } from './twilio-voice';
import { sendMissedCallFallback } from './fallback-server';
import { purgeTranscripts } from './retention-server';

const INTROS_PER_RUN = 20;
const PLACE_PER_RUN = 20;
const RECONCILE_PER_RUN = 20;
/** A ringing call older than this is failed even if Twilio can't be read. */
const HARD_CUTOFF_MS = 2 * 60 * 60_000;

export interface RunResult {
  dry: boolean;
  enabled: boolean;
  schemaMissing: boolean;
  intros: { due: number; queued: number; results: string[] };
  placed: { due: number; results: { id: string; type: string; outcome: string; detail?: unknown }[] };
  reconciled: { due: number; results: { id: string; status: string | null }[] };
  retention: { ran: boolean; due: number; purged: number } | null;
  errors: string[];
}

export async function runCalls(o: { apply: boolean; now?: Date; onlyUserId?: string | null }): Promise<RunResult> {
  const now = o.now ?? new Date();
  const out: RunResult = { dry: !o.apply, enabled: callsEnabled(), schemaMissing: false, intros: { due: 0, queued: 0, results: [] }, placed: { due: 0, results: [] }, reconciled: { due: 0, results: [] }, retention: null, errors: [] };
  if (!hasServiceRole()) {
    out.errors.push('service role not configured');
    return out;
  }
  const admin = createAdminClient();
  const settings = await getBillingSettings();

  // 1. Intros owed.
  try {
    const ids: string[] = [];
    if (o.onlyUserId) ids.push(o.onlyUserId);
    else {
      for (let from = 0; from < 10_000; from += 1000) {
        const { data, error } = await admin.from('profiles').select('id').eq('si_calls', true).order('id', { ascending: true }).range(from, from + 999);
        if (error) throw error;
        ids.push(...((data ?? []) as { id: string }[]).map((r) => r.id));
        if ((data?.length ?? 0) < 1000) break;
      }
    }
    const owed: string[] = [];
    // Only owners with a number that can be called, no intro yet: team members
    // are never called, and a number that sent STOP waits for START. In chunks
    // (a long id list does not fit in a URL); shuffled so a few that can't be
    // called yet never starve the rest.
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const [had, members, numbers] = await Promise.all([
        admin.from('si_calls_log').select('user_id').eq('call_type', 'intro').in('user_id', chunk),
        admin.from('team_members').select('member_id').in('member_id', chunk),
        admin.from('sms_contacts').select('user_id').in('user_id', chunk).not('verified_at', 'is', null).is('stopped_at', null),
      ]);
      if (had.error || members.error || numbers.error) throw had.error ?? members.error ?? numbers.error;
      const done = new Set(((had.data ?? []) as { user_id: string }[]).map((r) => r.user_id));
      const teamMembers = new Set(((members.data ?? []) as { member_id: string }[]).map((r) => r.member_id));
      const callable = new Set(((numbers.data ?? []) as { user_id: string }[]).map((r) => r.user_id));
      owed.push(...chunk.filter((id) => !done.has(id) && !teamMembers.has(id) && callable.has(id)));
    }
    owed.sort(() => Math.random() - 0.5);
    out.intros.due = owed.length;
    if (o.apply && out.enabled) {
      for (const id of owed.slice(0, INTROS_PER_RUN)) {
        const r = await enqueueCall({ userId: id, type: 'intro', now: new Date() });
        out.intros.results.push(r.outcome);
        if (r.outcome === 'queued') out.intros.queued += 1;
      }
    }
  } catch (err) {
    if (isSchemaMissing(err as { message?: string; code?: string })) out.schemaMissing = true;
    else out.errors.push(`intros: ${(err as Error)?.message ?? err}`);
  }
  if (out.schemaMissing) return out;

  // 2. Due calls.
  try {
    let q = admin.from('si_calls_log').select(CALL_COLUMNS).eq('status', 'queued').eq('direction', 'outbound').lte('not_before', now.toISOString()).order('not_before', { ascending: true }).limit(PLACE_PER_RUN);
    if (o.onlyUserId) q = q.eq('user_id', o.onlyUserId);
    const { data, error } = await q;
    if (error) throw error;
    const due = (data ?? []) as CallRow[];
    out.placed.due = due.length;
    for (const call of due) {
      if (!out.enabled && o.apply) {
        out.placed.results.push({ id: call.id, type: call.call_type, outcome: 'disabled' });
        continue;
      }
      // Each call checks the clock as it dials (a slow pass must not dial after 7pm).
      const r = await placeCall(call, { apply: o.apply, now: o.now ?? new Date() });
      out.placed.results.push({ id: call.id, type: call.call_type, outcome: r.outcome, detail: 'reason' in r ? r.reason : 'until' in r ? r.until : 'would' in r ? r.would : undefined });
    }
  } catch (err) {
    out.errors.push(`place: ${(err as Error)?.message ?? err}`);
  }

  // 3. Calls with no webhook.
  try {
    let q = admin.from('si_calls_log').select(CALL_COLUMNS).eq('status', 'ringing').lt('placed_at', new Date(now.getTime() - STALE_RINGING_MS).toISOString()).order('placed_at', { ascending: true }).limit(RECONCILE_PER_RUN);
    if (o.onlyUserId) q = q.eq('user_id', o.onlyUserId);
    const { data, error } = await q;
    if (error) throw error;
    const stale = (data ?? []) as CallRow[];
    out.reconciled.due = stale.length;
    for (const call of stale) {
      const tw = call.twilio_call_sid ? await fetchCall(call.twilio_call_sid) : null;
      const old = now.getTime() - Date.parse(call.placed_at ?? call.queued_at) > HARD_CUTOFF_MS;
      // Twilio unreadable: wait, but never past the cutoff (a stuck row would block every later call).
      const status = tw ? (statusFromTwilio(tw) ?? (old ? 'failed' : null)) : call.twilio_call_sid && !old ? null : 'failed';
      out.reconciled.results.push({ id: call.id, status });
      if (!o.apply || !status) continue;
      // With no transcript we can't tell an answered call from an undetected
      // voicemail, so a call settled here is never charged for its minutes
      // (the safe direction); a late post-call webhook still can't charge it,
      // as the row is no longer ringing.
      const seconds = status === 'answered' && tw ? tw.durationSecs : 0;
      const updated = await updateCall(admin, call.id, { status, seconds, ended_at: now.toISOString(), error: tw ? 'no webhook: settled from Twilio, minutes not charged' : 'no webhook, no call details' }, ['ringing']);
      if (!updated) continue;
      if ((status === 'missed' || status === 'voicemail') && updated.direction === 'outbound') await sendMissedCallFallback(updated);
    }
  } catch (err) {
    out.errors.push(`reconcile: ${(err as Error)?.message ?? err}`);
  }

  // 4. Retention, once a UK day.
  try {
    const key = `retention:${ukDay(now)}`;
    if (!o.apply) {
      const r = await purgeTranscripts({ apply: false, days: settings.voice.transcriptRetentionDays, now });
      out.retention = { ran: false, ...r };
    } else if ((await claimEvent(admin, 'cron', key)) === 'new') {
      const total = { due: 0, purged: 0 };
      for (let i = 0; i < 10; i++) {
        const r = await purgeTranscripts({ apply: true, days: settings.voice.transcriptRetentionDays, now, limit: 500 });
        total.due += r.due;
        total.purged += r.purged;
        if (r.purged < 500) break;
      }
      await finishEvent(admin, 'cron', key, null);
      out.retention = { ran: true, ...total };
    }
  } catch (err) {
    out.errors.push(`retention: ${(err as Error)?.message ?? err}`);
  }
  return out;
}
