import 'server-only';

/**
 * Batch 27: a message that is only a listing link. It needs no model: the
 * link is checked at the listing check's own price (with the same countdown,
 * Stop and confirms as any charged step), and the question itself costs
 * nothing (no AI ran). A link to a site the check can't read gets the list
 * of sites that work, free. Recorded as an ordinary full-view question
 * (Batch 26's turn and conversation log), so a retry, the history and the
 * one-question-at-a-time rule all behave as for a typed question.
 */
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createAdminClient } from '../supabase/admin';
import { logActivity } from '../activity/log';
import { detectListingUrl, SERVER_FETCHABLE } from '../listing/detect';
import { insertTurn, settle, type ChatMember } from '../chat/turns-server';
import { logExchange, openConversation, replyForStored } from '../chat/log-server';
import { stateReply, type ChatReply } from '../chat/reply';
import type { ChatSettings } from '../chat/settings';
import { DROP_REASONS } from './config';
import { proposeActions } from './plan-server';
import { finaliseInstruction, withStoredCard } from './run-server';
import { actionsOn, readActionConfig } from './store-server';
import type { ActingMember } from './steps-server';

/** Only a link: one word that is a web address. */
export function isLinkOnly(question: string): boolean {
  const q = question.trim();
  return /^\S+$/.test(q) && (/^https?:\/\//i.test(q) || /^www\./i.test(q) || detectListingUrl(q) !== null);
}

export async function linkOnlyReply(input: { user: Pick<User, 'id' | 'email'>; supabase: SupabaseClient; member: ChatMember; settings: ChatSettings; clientTurnId: string; question: string; conversationId: unknown; now: Date }): Promise<ChatReply | null> {
  const admin = createAdminClient();
  const config = await readActionConfig(admin);
  if (!actionsOn(config)) return null;
  const { member, now } = input;
  const inserted = await insertTurn(admin, member, input.clientTurnId, 'full');
  if (inserted.kind === 'existing') return withStoredCard(await replyForStored(admin, inserted.turn, member), { userId: member.userId, email: input.user.email ?? null, payerId: member.payerId, admin: member.admin, teamMember: member.teamMember });
  if (inserted.kind === 'busy') return stateReply('busy');
  const turn = inserted.turn;
  logActivity(member.userId, 'si_chat_full', { extras: { outcome: 'asked' }, dedupeKey: `si_chat_full:${turn.id}` });
  const conv = await openConversation(admin, member, 'full', input.conversationId, { idleMinutes: input.settings.sessionIdleMinutes, historyTurns: 0, now });
  const acting: ActingMember = { userId: member.userId, email: input.user.email ?? null, payerId: member.payerId, admin: member.admin, teamMember: member.teamMember };

  const detected = detectListingUrl(input.question);
  let text: string;
  let card = null;
  if (!detected) text = `${DROP_REASONS.unsupported_site} Paste one of those and I’ll check it.`;
  else if (!SERVER_FETCHABLE.has(detected.source)) text = `${DROP_REASONS.needs_extension} ${DROP_REASONS.unsupported_site}`;
  else {
    const plan = await proposeActions({ member: acting, supabase: input.supabase, turnId: turn.id, question: input.question, seenDeals: new Set(), steps: [{ action: 'check_link', dealId: null, stage: null, url: detected.canonicalUrl, question: null, value: null }], holdPence: 0, now });
    if (plan.ok === true) {
      const fin = await finaliseInstruction(acting, input.supabase, turn.id, { delivered: true, conversationId: null });
      card = fin.card;
      text = typeof plan.spend_line === 'string' && plan.spend_line ? `${plan.spend_line}.` : typeof plan.not_enough_credit === 'string' ? plan.not_enough_credit : 'Here it is.';
      if (Array.isArray(plan.dropped) && plan.dropped.length > 0) text = String((plan.dropped[0] as { why?: string }).why ?? text);
    } else text = typeof plan.note === 'string' ? plan.note : 'I can’t check that just now.';
  }
  const logged = conv ? await logExchange(conv, { question: input.question, answer: text, outcome: 'answered', knowledgeRef: null, surface: 'full', at: now }) : { questionId: null, agentSeq: null };
  // No model ran: nothing to charge for the question (the check itself is charged by its own code).
  await settle(admin, turn, member, null, { status: 'answered', outcome: 'answered', rounds: [], conversationId: conv?.id ?? null, questionId: logged.questionId, logSeq: logged.agentSeq }, input.settings);
  return { state: 'answer', turnId: turn.id, text, buttons: [], charged: null, conversationId: conv?.id ?? null, actions: card };
}
