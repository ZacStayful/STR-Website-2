import 'server-only';

/**
 * Batch 23: the server tools the agent may call during a call. Each request
 * is authenticated (the tool secret header, checked by the route), tied to
 * a live call in si_calls_log by ids ElevenLabs injects (never by anything
 * said on the call), logged in si_tool_calls and rate-limited per call.
 *
 *   lookup_caller(number)        first name, member status, why we last
 *                                called. Never a balance, an address or a
 *                                deal. The number argument is ignored: the
 *                                caller is the call's own member.
 *   send_template_text(template) contact_card | auto_topup_link | deal_link |
 *                                resend_last_link — a pre-written text, only
 *                                to the member's own verified number on
 *                                file, at most si_texts_per_call_max a call.
 *                                Batch 25: deal_link is the deal a deal call
 *                                is about (or, on a callback, the deal the
 *                                last missed deal call was about); it goes
 *                                only with the member's Texts switch on and
 *                                is recorded in sms_messages.
 *   handoff_to_team(summary, question)  emails the handoff address
 *                                (feedback_admin_email) once a call.
 *   log_question(question, outcome, knowledge_ref?)  the conversation log's
 *                                outcome per question (Batch 24 reads it).
 *   remember_fact(fact, asked, member_said_yes)  Batch 24: a fact the member
 *                                said yes to remembering, kept for their own
 *                                account (Account shows and deletes it).
 *
 * Answers are short instructions for the agent, never data to read out.
 */
import { createAdminClient } from '../supabase/admin';
import { siteUrl } from '../url';
import { sendSms } from '../sms/send';
import { maskPhone, ukMobile } from '../sms/phone';
import { getBillingSettings } from '../credit/unit-costs';
import { feedbackSettings } from '../feedback/settings-server';
import { handoffEmail } from '../email/si-calls';
import { recordQuestion } from '../conversations/log-server';
import { rememberFact } from '../knowledge/facts-server';
import { CALL_TEXT_TEMPLATES, QUESTION_OUTCOMES, TOOL_GRACE_MS, TOOL_LIMITS, callsDryRun, type CallTextTemplate, type QuestionOutcome, type ToolName } from './config';
import { callText } from './templates';
import { memberFacts } from './member-server';
import { claimCharge, releaseCharge, settleText } from './charge-server';
import { callByConversation, claimEvent, lastOutbound, lastTemplateSent, logTool, toolCount, updateCall, type CallRow } from './store-server';
import { dealCallFacts, type DealCallFacts } from '../standout/calls-server';
import { sendMemberText } from '../standout/texts-server';

/** How far back a callback looks for the deal call it follows (as the inbound opener does). */
const DEAL_CALL_WITHIN_MS = 7 * 24 * 60 * 60_000;

export interface ToolRequest {
  conversation_id?: unknown;
  call_sid?: unknown;
  caller_id?: unknown;
  called_number?: unknown;
  [k: string]: unknown;
}

export interface ToolAnswer {
  ok: boolean;
  /** What the agent should do or say next (no figures, no numbers). */
  say: string;
  [k: string]: unknown;
}

const str = (v: unknown, max = 500): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** The live call these ids belong to, or null (a forged, finished or unknown call). */
async function liveCall(req: ToolRequest, maxCallSeconds: number, now: Date): Promise<CallRow | null> {
  const call = await callByConversation(createAdminClient(), str(req.conversation_id, 200), str(req.call_sid, 64));
  if (!call || call.status !== 'ringing') return null;
  const since = Date.parse(call.placed_at ?? call.started_at ?? call.queued_at);
  if (!Number.isFinite(since) || now.getTime() - since > maxCallSeconds * 1000 + TOOL_GRACE_MS) return null;
  return call;
}

/** A per-call text slot (si_webhook_events as a once-only claim); its key, or null when taken. */
async function claimEventSlot(key: string): Promise<string | null> {
  return (await claimEvent(createAdminClient(), 'si_text_slot', key)) === 'new' ? key : null;
}

export async function runTool(tool: ToolName, req: ToolRequest, now: Date = new Date()): Promise<ToolAnswer> {
  const admin = createAdminClient();
  const settings = await getBillingSettings();
  const call = await liveCall(req, settings.voice.maxCallSeconds, now);
  if (!call) {
    await logTool(admin, null, tool, false, { reason: 'no_live_call' });
    return { ok: false, say: "I can't do that right now. Carry on without it." };
  }
  if ((await toolCount(admin, call.id, tool)) >= TOOL_LIMITS[tool]) {
    await logTool(admin, call.id, tool, false, { reason: 'rate_limited' });
    return { ok: false, say: tool === 'send_template_text' ? "That's the most texts for one call. Say they can find it in the app." : 'Not again on this call. Carry on.' };
  }
  const answer = await dispatch(tool, call, req, settings.voice.textsPerCallMax);
  await logTool(admin, call.id, tool, answer.ok, { ...(answer.detail as Record<string, unknown> | undefined) });
  delete answer.detail;
  return answer;
}

async function dispatch(tool: ToolName, call: CallRow, req: ToolRequest, textsPerCallMax: number): Promise<ToolAnswer> {
  switch (tool) {
    case 'lookup_caller':
      return lookupCaller(call);
    case 'send_template_text':
      return sendTemplateText(call, req, textsPerCallMax);
    case 'handoff_to_team':
      return handoff(call, req);
    case 'log_question':
      return logQuestion(call, req);
    case 'remember_fact':
      return rememberFactTool(call, req);
  }
}

async function lookupCaller(call: CallRow): Promise<ToolAnswer> {
  if (!call.user_id) return { ok: true, say: 'Unknown caller: explain what Stayful Intelligence is and point them to stayful.co.uk. Nothing else.', member_status: 'unknown', detail: { member: false } };
  const m = await memberFacts(call.user_id);
  if (!m) return { ok: false, say: 'Treat them as an unknown caller.', member_status: 'unknown' };
  return {
    ok: true,
    say: 'Use their first name. Never mention balances, addresses or deal figures.',
    first_name: m.firstName ?? '',
    member_status: 'member',
    last_called_about: call.context ?? 'nothing',
    auto_topup: m.autoTopupOn ? 'on' : 'off',
    detail: { member: true },
  };
}

async function sendTemplateText(call: CallRow, req: ToolRequest, textsPerCallMax: number): Promise<ToolAnswer> {
  const raw = str(req.template, 40);
  const template = CALL_TEXT_TEMPLATES.find((t) => t === raw) as CallTextTemplate | undefined;
  if (!template) return { ok: false, say: 'I can only send the contact card, the auto top-up link, the deal link, or the last link again.', detail: { reason: 'bad_template' } };
  if (!call.user_id) return { ok: false, say: "I can't text an unknown caller. Point them to stayful.co.uk.", detail: { reason: 'unknown_caller' } };
  const admin = createAdminClient();
  if ((await toolCount(admin, call.id, 'send_template_text')) >= textsPerCallMax) return { ok: false, say: "That's the most texts for one call.", detail: { reason: 'limit' } };
  const m = await memberFacts(call.user_id);
  if (!m || !m.numberOk || !m.phone) return { ok: false, say: "I can't text them: there's no number on file that can take texts. Say it's in the app.", detail: { reason: 'no_number' } };
  // Only ever the number on file — and it must be the number on this call.
  const onCall = ukMobile(str(call.direction === 'inbound' ? req.caller_id : req.called_number, 32));
  if (onCall && onCall !== m.phone) return { ok: false, say: "I can only text the number on their account. Say it's in the app.", detail: { reason: 'number_mismatch' } };
  const settings = await getBillingSettings();
  const which = template === 'resend_last_link' ? ((await lastTemplateSent(admin, m.userId)) ?? 'contact_card') : template;
  let deal: DealCallFacts | null = null;
  if (which === 'deal_link') {
    deal = await dealForCall(call);
    if (!deal?.deal) return { ok: false, say: "I can't find that deal. Say it's saved in their deals in the app.", detail: { reason: 'no_deal' } };
  }
  const body = callText(which, { base: siteUrl(), topupAmountPence: settings.intelligence.revealAutoTopupAmountPence, topupThresholdPence: settings.intelligence.revealAutoTopupThresholdPence, deal: deal?.deal ?? null });
  // Each template at most once a call (a resend of one already sent here is the same text)…
  const key = `call:${call.id}:text:${which}`;
  const guard = await claimCharge(key, call.id, m.userId, 'text');
  if (!guard) return { ok: true, say: "It's already been sent on this call.", detail: { reason: 'already_sent' } };
  // …and never more than the per-call limit, however the requests race: one slot row each.
  let slot: string | null = null;
  for (let n = 0; n < textsPerCallMax && !slot; n++) slot = await claimEventSlot(`${call.id}:${n}`);
  if (!slot) {
    await releaseCharge(guard);
    return { ok: false, say: "That's the most texts for one call.", detail: { reason: 'limit' } };
  }
  const r =
    which === 'deal_link'
      ? await sendMemberText(admin, { userId: m.userId, body, kind: 'standout', purpose: `si_${which}`, dryRun: callsDryRun() })
      : await sendSms({ to: m.phone, body, purpose: `si_${which}`, dryRun: callsDryRun() });
  if (!r.sent && r.reason !== 'unknown') {
    await releaseCharge(guard);
    if (r.reason === 'texts_off') return { ok: false, say: "Their texts are switched off, so I won't text. Say it's saved in their deals in the app.", detail: { reason: 'texts_off' } };
    return { ok: false, say: "The text didn't go through. Say they'll find it in the app.", detail: { reason: r.reason ?? 'refused' } };
  }
  await settleText(guard, key, call.id, m.userId);
  await updateCall(admin, call.id, { texts_sent: call.texts_sent + 1 });
  return { ok: true, say: 'Sent. Tell them it is on its way.', detail: { template: which, to: maskPhone(m.phone) } };
}

/** Batch 25: the deal a deal_link text is about: this deal call's, or on a callback the last deal call's. */
async function dealForCall(call: CallRow): Promise<DealCallFacts | null> {
  const admin = createAdminClient();
  if (call.call_type === 'deal') return dealCallFacts(admin, call);
  if (call.direction !== 'inbound' || !call.user_id) return null;
  const last = await lastOutbound(admin, call.user_id, DEAL_CALL_WITHIN_MS);
  return last?.call_type === 'deal' ? dealCallFacts(admin, last) : null;
}

async function handoff(call: CallRow, req: ToolRequest): Promise<ToolAnswer> {
  const question = str(req.question, 300) ?? 'Not stated';
  const summary = str(req.summary, 2000) ?? '';
  const admin = createAdminClient();
  const m = call.user_id ? await memberFacts(call.user_id) : null;
  const { adminEmail } = await feedbackSettings();
  const sent = adminEmail
    ? await handoffEmail(adminEmail, {
        member: m ? `${m.firstName ?? 'Member'} (${m.email ?? call.user_id})` : 'Unknown caller',
        caller: m?.phone ? maskPhone(m.phone) : 'Unknown or withheld',
        question,
        summary,
        conversationId: call.conversation_id,
        callId: call.id,
      })
    : false;
  await updateCall(admin, call.id, { handoff: true });
  if (call.conversation_id) await recordQuestion(call.conversation_id, { question, outcome: 'handed_off' });
  return { ok: true, say: m ? "Say: I'll pass that to the team, they'll email you." : "Say: I've passed that to the team.", detail: { emailed: sent } };
}

/** Batch 24: a fact the member said yes to remembering, for their own account only. */
async function rememberFactTool(call: CallRow, req: ToolRequest): Promise<ToolAnswer> {
  if (!call.user_id) return { ok: false, say: "Don't remember anything for an unknown caller. Carry on.", detail: { reason: 'unknown_caller' } };
  const r = await rememberFact({
    userId: call.user_id,
    fact: str(req.fact, 300) ?? '',
    asked: str(req.asked, 300),
    confirmed: req.member_said_yes === true || req.member_said_yes === 'true',
    channel: 'call',
    confirmedVia: 'call_yes',
    conversationId: call.conversation_id,
  });
  if (r.ok) return { ok: true, say: 'Remembered. They can see or delete it in Account, under what Stayful Intelligence remembers.', detail: { remembered: true } };
  const say: Record<string, string> = {
    not_confirmed: "Only remember it if they clearly said yes. Carry on.",
    sensitive: "Don't remember that: it's personal. Carry on without it.",
    personal_details: "Don't remember contact or card details. Carry on.",
    duplicate: 'Already remembered. Carry on.',
    cap: "I can't remember any more: they can delete some in Account first. Carry on.",
  };
  return { ok: false, say: say[r.reason] ?? "Couldn't remember that just now. Carry on.", detail: { reason: r.reason } };
}

async function logQuestion(call: CallRow, req: ToolRequest): Promise<ToolAnswer> {
  const question = str(req.question, 500);
  const outcome = QUESTION_OUTCOMES.find((o) => o === req.outcome) as QuestionOutcome | undefined;
  if (!question || !outcome) return { ok: false, say: 'Carry on.', detail: { reason: 'bad_args' } };
  if (call.conversation_id) await recordQuestion(call.conversation_id, { question, outcome, knowledgeRef: str(req.knowledge_ref, 120) });
  return { ok: true, say: 'Logged. Carry on.', detail: { outcome } };
}
