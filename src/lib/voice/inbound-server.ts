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
 *
 * Review R3 (R3-17, R3-50 / R2-25 to R2-29): a member is recognised only with
 * calls switched on (their consent), never on a dry-run deployment, and only
 * for a call Twilio placed (a real call sid); a replayed initiation for the
 * same call gets no member data (inbound.ts). Callbacks work while outbound
 * calls are off, by design. The tools' token is no longer sent as a variable
 * once the Sync keeps it in ElevenLabs as a workspace secret.
 */
import { createHmac } from 'node:crypto';
import { createAdminClient } from '../supabase/admin';
import { ukMobile } from '../sms/phone';
import { getBillingSettings } from '../credit/unit-costs';
import { getBalance } from '../credit/ledger';
import { payerFor } from '../team';
import { PERSONA_VERSION } from '../persona/stayful-intelligence';
import { startConversation } from '../conversations/log-server';
import { affordableSeconds, callablePence, maxSpendRate } from './charge';
import { callPencePerMinute } from './charge-server';
import { callsDryRun, initiateSecret, toolSecret } from './config';
import { inboundIdentity } from './inbound';
import { toolHeaderViaSecret } from './agent/tool-header-server';
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
  // R3-50: once the tools take their token from an ElevenLabs workspace secret (the Sync sets it), no answer carries it.
  const secret = (await toolHeaderViaSecret(admin)) ? null : toolSecret();
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
  // R3-17 / R3-50: a member only with calls switched on, never on a dry run, and only for a call Twilio placed.
  const m = userId && !callsDryRun() ? await memberFacts(userId) : null;
  const who = inboundIdentity({ userId, callsOn: m?.callsOn ?? null, dryRun: callsDryRun(), callSid: req.call_sid });
  const unknownVars = () => callVariables({ callType: 'callback', context: 'unknown', firstName: null, member: false, cardSent: false, minutesAvailable: Math.floor(settings.voice.maxCallSeconds / 60), ...base });

  if (who.kind === 'unknown') {
    if (userId) console.warn(`[voice] inbound call from a member answered as unknown (${who.reason})`);
    const vars = unknownVars();
    const conversationId = await startConversation({ channel: 'call', userId: null, startedAt: now });
    await insertCall(admin, {
      user_id: null, direction: 'inbound', call_type: 'callback', status: 'ringing', context: 'unknown', persona_version: PERSONA_VERSION,
      el_conversation_id: req.conversation_id ?? null, twilio_call_sid: req.call_sid ?? null, caller_hash: req.caller_id ? callerHash(String(req.caller_id)) : 'withheld',
      started_at: now.toISOString(), placed_at: now.toISOString(),
    }).then((r) => (r.ok && conversationId ? admin.from('si_calls_log').update({ conversation_id: conversationId }).eq('id', r.call.id) : null));
    return respond(vars, 'unknown');
  }

  const memberId = who.userId;
  const payer = await payerFor(memberId);
  const [perMin, balance, cardSent, last] = await Promise.all([
    callPencePerMinute(),
    getBalance(payer.payerId).catch(() => null),
    contactCardSent(admin, memberId),
    lastOutbound(admin, memberId, MISSED_WITHIN_MS, now),
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
  // R2-13: the credit a call may take, not what open reservations hold.
  const seconds = payer.suspended ? 60 : affordableSeconds(balance ? callablePence(balance, maxSpendRate(balance.rates)) : 0, perMin, settings.voice.maxCallSeconds, settings.voice.textsPerCallMax * settings.intelligence.siTextPence);
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
  const conversationId = await startConversation({ channel: 'call', userId: memberId, startedAt: now });
  const inserted = await insertCall(admin, {
    user_id: memberId, direction: 'inbound', call_type: 'callback', status: 'ringing', context, persona_version: PERSONA_VERSION,
    el_conversation_id: req.conversation_id ?? null, twilio_call_sid: who.callSid, started_at: now.toISOString(), placed_at: now.toISOString(),
  });
  if (!inserted.ok) {
    // R3-50: a second initiation for the same call (a replayed POST) gets no member data and no second live row.
    console.warn('[voice] inbound member row not written; answered as unknown:', inserted.message ?? inserted.reason);
    return respond(unknownVars(), 'unknown');
  }
  if (conversationId) await admin.from('si_calls_log').update({ conversation_id: conversationId }).eq('id', inserted.call.id);
  return respond(vars, context);
}
