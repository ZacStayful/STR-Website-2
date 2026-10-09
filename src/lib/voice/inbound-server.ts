import 'server-only';

/**
 * Batch 23, Part D: someone rings the Stayful Intelligence number (any time,
 * day or night). ElevenLabs asks the conversation-initiation webhook who it
 * is before the agent speaks; this answers with the call's dynamic variables
 * and opener.
 *
 *   a recognised member (the caller's number is a verified, not-stopped
 *   mobile on file):
 *     after a missed intro call       → the intro (and the card if not yet sent)
 *     after a missed low-credit call  → the auto top-up offer
 *     after a missed deal call        → the deal, and the link again (Batch 25)
 *     otherwise                       → "Hi [name], how can I help?"
 *     charged per minute; texts 22p (charged to the owner for a team member)
 *   unknown or withheld: what Stayful Intelligence is and the website. No
 *     texts, no member data, never charged. Only a hash of the number is kept.
 */
import { createHmac } from 'node:crypto';
import { createAdminClient } from '../supabase/admin';
import { ukMobile } from '../sms/phone';
import { getBillingSettings } from '../credit/unit-costs';
import { getBalance } from '../credit/ledger';
import { payerFor } from '../team';
import { PERSONA_VERSION } from '../persona/stayful-intelligence';
import { startConversation } from '../conversations/log-server';
import { affordableSeconds } from './charge';
import { callPencePerMinute } from './charge-server';
import { initiateSecret, toolSecret } from './config';
import { memberByNumber, memberFacts } from './member-server';
import { callByConversation, contactCardSent, insertCall, lastOutbound } from './store-server';
import { callVariables, contextForType, fill, isCallContext, openerFor, type CallContext } from './agent/variables';
import { dealCallFacts } from '../standout/calls-server';
import { knowledgeCallValues } from '../knowledge/agent-server';

const MISSED_WITHIN_MS = 7 * 24 * 60 * 60_000;

export interface InitiationRequest {
  caller_id?: string | null;
  called_number?: string | null;
  call_sid?: string | null;
  conversation_id?: string | null;
  agent_id?: string | null;
}

export function callerHash(phone: string): string {
  return createHmac('sha256', initiateSecret() ?? 'si-caller').update(phone).digest('hex').slice(0, 32);
}

export async function answerInitiation(req: InitiationRequest, now: Date = new Date()): Promise<Record<string, unknown>> {
  const admin = createAdminClient();
  const settings = await getBillingSettings();
  const secret = toolSecret();
  const withSecret = (vars: Record<string, string | number | boolean>) => ({ ...vars, ...(secret ? { secret__tool_token: secret } : {}) });
  const respond = (vars: Record<string, string | number | boolean>, context: CallContext) => ({
    type: 'conversation_initiation_client_data',
    dynamic_variables: withSecret(vars),
    conversation_config_override: { agent: { first_message: fill(openerFor(context), vars) } },
  });

  // Batch 24: the knowledge base's figures, as they are now (every call sends all of them).
  const base = { topupAmountPence: settings.intelligence.revealAutoTopupAmountPence, topupThresholdPence: settings.intelligence.revealAutoTopupThresholdPence, knowledge: await knowledgeCallValues(admin) };

  // An outbound call we placed already carries its own variables; if asked anyway, answer with the same ones.
  if (req.conversation_id) {
    const existing = await callByConversation(admin, req.conversation_id, req.call_sid ?? null);
    if (existing && existing.direction === 'outbound' && existing.user_id) {
      const m = await memberFacts(existing.user_id);
      // R2-86: the context it was placed with.
      const context: CallContext = isCallContext(existing.context) ? existing.context : contextForType(existing.call_type);
      const deal = existing.call_type === 'deal' ? (await dealCallFacts(admin, existing))?.vars ?? null : null;
      const vars = callVariables({ callType: existing.call_type, context, firstName: m?.firstName ?? null, member: true, cardSent: await contactCardSent(admin, existing.user_id), minutesAvailable: Math.floor(settings.voice.maxCallSeconds / 60), ...base, deal });
      return { type: 'conversation_initiation_client_data', dynamic_variables: withSecret(vars) };
    }
  }

  const phone = ukMobile(req.caller_id ?? null);
  const userId = phone ? await memberByNumber(phone) : null;

  if (!userId) {
    const vars = callVariables({ callType: 'callback', context: 'unknown', firstName: null, member: false, cardSent: false, minutesAvailable: Math.floor(settings.voice.maxCallSeconds / 60), ...base });
    const conversationId = await startConversation({ channel: 'call', userId: null, startedAt: now });
    await insertCall(admin, {
      user_id: null, direction: 'inbound', call_type: 'callback', status: 'ringing', context: 'unknown', persona_version: PERSONA_VERSION,
      el_conversation_id: req.conversation_id ?? null, twilio_call_sid: req.call_sid ?? null, caller_hash: req.caller_id ? callerHash(String(req.caller_id)) : 'withheld',
      started_at: now.toISOString(), placed_at: now.toISOString(),
    }).then((r) => (r.ok && conversationId ? admin.from('si_calls_log').update({ conversation_id: conversationId }).eq('id', r.call.id) : null));
    return respond(vars, 'unknown');
  }

  const m = await memberFacts(userId);
  const payer = await payerFor(userId);
  const [perMin, balance, cardSent, last] = await Promise.all([
    callPencePerMinute(),
    getBalance(payer.payerId).catch(() => null),
    contactCardSent(admin, userId),
    lastOutbound(admin, userId, MISSED_WITHIN_MS, now),
  ]);
  let context: CallContext = 'member';
  let deal: { headline: string; short: string } | null = null;
  if (last && (last.status === 'missed' || last.status === 'voicemail')) {
    if (last.call_type === 'intro') context = 'missed_intro';
    else if (last.call_type === 'low_credit' && !m?.autoTopupOn) context = 'missed_low_credit';
    else if (last.call_type === 'deal') {
      // Batch 25: ringing back after a missed deal call: the opener names the deal.
      deal = (await dealCallFacts(admin, last))?.vars ?? null;
      if (deal) context = 'missed_deal';
    }
  }
  const seconds = payer.suspended ? 60 : affordableSeconds(balance?.totalPence ?? 0, perMin, settings.voice.maxCallSeconds, settings.voice.textsPerCallMax * settings.intelligence.siTextPence);
  const vars = callVariables({
    callType: 'callback',
    context,
    firstName: m?.firstName ?? null,
    member: true,
    cardSent,
    // A recognised member with little credit still gets a short answer; the charge is capped at the balance.
    minutesAvailable: Math.max(1, Math.floor((seconds - settings.voice.wrapUpSeconds) / 60)),
    ...base,
    deal,
  });
  const conversationId = await startConversation({ channel: 'call', userId, startedAt: now });
  await insertCall(admin, {
    user_id: userId, direction: 'inbound', call_type: 'callback', status: 'ringing', context, persona_version: PERSONA_VERSION,
    el_conversation_id: req.conversation_id ?? null, twilio_call_sid: req.call_sid ?? null, started_at: now.toISOString(), placed_at: now.toISOString(),
  }).then((r) => (r.ok && conversationId ? admin.from('si_calls_log').update({ conversation_id: conversationId }).eq('id', r.call.id) : null));
  return respond(vars, context);
}
