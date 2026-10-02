import 'server-only';

/**
 * Batch 23: the shared outbound call queue. Every outbound call — the intro,
 * the low-credit call, and Batch 25's deal calls — goes through
 * enqueueCall() and placeCall(). Nothing else places a call.
 *
 * The safety rules (eligibility.ts) are checked when a call is queued and
 * again just before it is dialled; the database's unique indexes are the
 * last word (one outbound call per member per UK day, one in flight, one
 * intro ever, one low-credit call per credit landing). Every call a safety
 * rule stops is kept as a 'blocked' row with its reason, for /admin/calls.
 * Member choices (calls off, a team member, auto top-up on) write nothing.
 *
 * No redials: a call that fails or is missed is not retried; the next
 * trigger is a new call.
 */
import { createAdminClient } from '../supabase/admin';
import { getBillingSettings } from '../credit/unit-costs';
import { PERSONA_VERSION } from '../persona/stayful-intelligence';
import { checkEligibility, type Eligibility } from './eligibility';
import { nextDayOpening, nextOpening, ukDay } from './hours';
import { affordableSeconds } from './charge';
import { callPencePerMinute } from './charge-server';
import { callsDryRun, callsEnabled, toolSecret, voiceConfig, STALE_QUEUED_MS, type BlockedReason, type CallType } from './config';
import { memberFacts, type MemberFacts } from './member-server';
import { contactCardSent, dayFacts, insertCall, updateCall, type CallRow } from './store-server';
import { placeOutboundCall } from './elevenlabs-server';
import { callVariables, fill, openerFor, type CallContext } from './agent/variables';
import { claimCallSlot } from './cap-server';
import { startConversation } from '../conversations/log-server';

type OutboundType = Exclude<CallType, 'callback'>;

/** Reasons the once-ever intro waits for (no row when queueing; a day's wait when dialling). */
const INTRO_WAITS: ReadonlySet<BlockedReason> = new Set(['no_number', 'no_credit']);

export type EnqueueResult =
  | { outcome: 'queued'; call: CallRow }
  | { outcome: 'blocked'; reason: BlockedReason; call: CallRow | null }
  | { outcome: 'skipped'; reason: BlockedReason | 'disabled' | 'unknown_member' }
  | { outcome: 'exists' }
  | { outcome: 'error' };

async function eligibilityFor(type: OutboundType, m: MemberFacts, now: Date, exceptId: string | null): Promise<Eligibility> {
  const [settings, perMin] = await Promise.all([getBillingSettings(), callPencePerMinute()]);
  const day = await dayFacts(createAdminClient(), m.userId, now, exceptId);
  // Keep back enough for the texts the call may send.
  const reserve = settings.voice.textsPerCallMax * settings.intelligence.siTextPence;
  return checkEligibility({
    type,
    now,
    settings: settings.voice,
    callsOn: m.callsOn,
    isOwner: m.isOwner,
    numberOk: m.numberOk,
    autoTopupOn: m.autoTopupOn,
    joinedAt: m.joinedAt,
    placedToday: day.placedToday,
    otherInFlight: day.otherInFlight,
    introToday: day.introToday,
    affordableSeconds: affordableSeconds(m.balancePence, perMin, settings.voice.maxCallSeconds, reserve),
    managementOnly: m.managementOnly,
  });
}

/**
 * Queue an outbound call. Inside hours it is ready at once (the caller may
 * place it straight away); outside, it waits for the next opening.
 */
export async function enqueueCall(o: { userId: string; type: OutboundType; triggerRef?: string | null; now?: Date }): Promise<EnqueueResult> {
  const now = o.now ?? new Date();
  if (!callsEnabled()) return { outcome: 'skipped', reason: 'disabled' };
  const m = await memberFacts(o.userId);
  if (!m) return { outcome: 'skipped', reason: 'unknown_member' };
  const e = await eligibilityFor(o.type, m, now, null);
  const admin = createAdminClient();
  const settings = await getBillingSettings();
  const base = { user_id: o.userId, direction: 'outbound' as const, call_type: o.type, trigger_ref: o.triggerRef ?? null, context: o.type, persona_version: PERSONA_VERSION };
  if (!e.ok && e.defer === undefined) {
    // The intro is once ever: a missing number or credit now must not use it up.
    if (e.skip || (o.type === 'intro' && INTRO_WAITS.has(e.reason))) return { outcome: 'skipped', reason: e.reason };
    const r = await insertCall(admin, { ...base, status: 'blocked', blocked_reason: e.reason });
    if (!r.ok) return r.reason === 'duplicate' ? { outcome: 'exists' } : { outcome: 'error' };
    console.log(`[voice] ${o.type} call blocked (${e.reason})`);
    return { outcome: 'blocked', reason: e.reason, call: r.call };
  }
  const notBefore = e.ok ? now : e.defer === 'next_day' ? nextDayOpening(now, settings.voice) : nextOpening(now, settings.voice);
  const r = await insertCall(admin, { ...base, status: 'queued', not_before: notBefore.toISOString() });
  if (!r.ok) {
    // One in flight already, or this intro / this landing's call exists.
    if (r.reason === 'duplicate' && o.type !== 'intro' && /in_flight/.test(r.message ?? '')) {
      const b = await insertCall(admin, { ...base, status: 'blocked', blocked_reason: 'in_flight' });
      return b.ok ? { outcome: 'blocked', reason: 'in_flight', call: b.call } : { outcome: 'exists' };
    }
    return r.reason === 'duplicate' ? { outcome: 'exists' } : { outcome: 'error' };
  }
  return { outcome: 'queued', call: r.call };
}

export type PlaceResult =
  | { outcome: 'placed'; conversationId: string | null }
  | { outcome: 'deferred'; until: string }
  | { outcome: 'blocked'; reason: BlockedReason }
  | { outcome: 'failed'; message: string }
  | { outcome: 'dry_run'; would: Record<string, unknown> }
  | { outcome: 'not_due' | 'gone' };

/**
 * Stop a queued call. An intro that never rang is dropped instead (its row
 * deleted), so it is still owed: the intro is once ever, and it was never made.
 */
async function dropOrBlock(call: CallRow, reason: BlockedReason): Promise<void> {
  const admin = createAdminClient();
  if (call.call_type === 'intro') {
    const { error } = await admin.from('si_calls_log').delete().eq('id', call.id).eq('status', 'queued');
    if (error) console.error('[voice] intro drop failed:', error.message);
    return;
  }
  await updateCall(admin, call.id, { status: 'blocked', blocked_reason: reason }, ['queued']);
}

/** Place a queued call if it is still allowed; never twice (the status moves queued → ringing once). */
export async function placeCall(call: CallRow, o: { apply: boolean; now?: Date }): Promise<PlaceResult> {
  const now = o.now ?? new Date();
  if (call.status !== 'queued' || call.direction !== 'outbound' || !call.user_id) return { outcome: 'gone' };
  if (call.not_before && Date.parse(call.not_before) > now.getTime()) return { outcome: 'not_due' };
  const admin = createAdminClient();
  const type = call.call_type as OutboundType;
  if (now.getTime() - Date.parse(call.queued_at) > STALE_QUEUED_MS) {
    if (o.apply) await dropOrBlock(call, 'stale');
    return { outcome: 'blocked', reason: 'stale' };
  }
  const m = await memberFacts(call.user_id);
  if (!m) return { outcome: 'gone' };
  const settings = await getBillingSettings();
  const e = await eligibilityFor(type, m, now, call.id);
  if (!e.ok) {
    if (e.defer !== undefined) {
      const until = (e.defer === 'next_day' ? nextDayOpening(now, settings.voice) : nextOpening(now, settings.voice)).toISOString();
      if (o.apply) await updateCall(admin, call.id, { not_before: until }, ['queued']);
      return { outcome: 'deferred', until };
    }
    // An intro waits a day for a number or credit rather than being used up.
    if (type === 'intro' && INTRO_WAITS.has(e.reason)) {
      const until = nextDayOpening(now, settings.voice).toISOString();
      if (o.apply) await updateCall(admin, call.id, { not_before: until }, ['queued']);
      return { outcome: 'deferred', until };
    }
    if (o.apply) await dropOrBlock(call, e.reason);
    return { outcome: 'blocked', reason: e.reason };
  }

  const config = voiceConfig();
  const perMin = await callPencePerMinute();
  const reserve = settings.voice.textsPerCallMax * settings.intelligence.siTextPence;
  const seconds = affordableSeconds(m.balancePence, perMin, settings.voice.maxCallSeconds, reserve);
  const context: CallContext = type === 'intro' ? 'intro' : 'low_credit';
  const vars = callVariables({
    callType: type,
    context,
    firstName: m.firstName,
    member: true,
    cardSent: await contactCardSent(admin, m.userId),
    minutesAvailable: Math.max(1, Math.floor((seconds - settings.voice.wrapUpSeconds) / 60)),
    topupAmountPence: settings.intelligence.revealAutoTopupAmountPence,
    topupThresholdPence: settings.intelligence.revealAutoTopupThresholdPence,
  });
  const would = { call: call.id, type, to: 'number on file', vars: { ...vars } };
  if (!o.apply || callsDryRun() || !config || !m.phone) {
    if (o.apply && !config) console.warn('[voice] not configured (ELEVENLABS_API_KEY / ELEVENLABS_AGENT_ID / ELEVENLABS_PHONE_NUMBER_ID): call left queued');
    return { outcome: 'dry_run', would };
  }
  const secret = toolSecret();
  // Claim the call: queued → ringing with today's UK day. The one-a-day index refuses a second.
  const claimed = await admin
    .from('si_calls_log')
    .update({ status: 'ringing', uk_day: ukDay(now), placed_at: now.toISOString(), context, persona_version: PERSONA_VERSION, updated_at: now.toISOString() })
    .eq('id', call.id)
    .eq('status', 'queued')
    .select('id');
  if (claimed.error) {
    if (claimed.error.code === '23505') {
      await updateCall(admin, call.id, { status: 'blocked', blocked_reason: 'daily_limit' }, ['queued']);
      return { outcome: 'blocked', reason: 'daily_limit' };
    }
    console.error('[voice] claim failed:', claimed.error.message);
    return { outcome: 'failed', message: claimed.error.message };
  }
  if ((claimed.data ?? []).length !== 1) return { outcome: 'gone' };
  // The conversation log row, so the agent's tools can record questions as they happen.
  const conversationId = await startConversation({ channel: 'call', userId: m.userId, startedAt: now });
  if (conversationId) await updateCall(admin, call.id, { conversation_id: conversationId });

  const res = await placeOutboundCall(config.apiKey, {
    agentId: config.agentId,
    phoneNumberId: config.phoneNumberId,
    to: m.phone,
    dynamicVariables: { ...vars, ...(secret ? { secret__tool_token: secret } : {}) },
    firstMessage: fill(openerFor(context), vars),
  });
  if (!res.ok) {
    // No redial (Q10): the call is failed, shown on admin, the day's call used.
    await updateCall(admin, call.id, { status: 'failed', error: (res.message ?? 'refused').slice(0, 300), ended_at: new Date().toISOString() });
    return { outcome: 'failed', message: res.message ?? 'refused' };
  }
  await updateCall(admin, call.id, { el_conversation_id: res.conversationId, twilio_call_sid: res.callSid });
  // Calls override the one-a-day cap: take the day's slot so later capped emails move to tomorrow.
  await claimCallSlot(m.userId, now);
  console.log(`[voice] ${type} call placed (${call.id})`);
  return { outcome: 'placed', conversationId: res.conversationId };
}
