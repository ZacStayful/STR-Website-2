import 'server-only';

/**
 * Batch 26: a quick answer (the box under the header eye). Haiku 4.5, one
 * call, knowledge and the member's account basics only, one or two
 * sentences. When the question needs the member's deals or a look-up the box
 * says "Ask in the full view (about 8p)" instead of guessing; with no approved
 * answer it says "I don't know that one yet". Charged actual tokens × markup,
 * once, only for an answer (src/lib/chat/turns-server.ts).
 */
import Anthropic from '@anthropic-ai/sdk';
import type { User } from '@supabase/supabase-js';
import { createAdminClient } from '../supabase/admin';
import { InsufficientCreditError } from '../credit/ledger';
import { SeatPausedError, type StartedAction } from '../credit/action';
import { getUnitCostTable } from '../credit/unit-costs';
import { logActivity } from '../activity/log';
import { MAX_QUESTION_CHARS, MODEL_UNITS, QUICK_MODEL, QUICK_TIMEOUT_MS, DONT_KNOW_LINE, FULL_VIEW_LINE } from './config';
import { approxTokens, budgetFor, roundMaxTokens, unitsPriced, usageOf, type RoundUsage } from './budget';
import { adviceIn, allowedFigures, checkFigures, clampWords, cleanQuestion } from './guard';
import { buildButtons } from './actions';
import { accountBlock, parseQuickReply, questionBlock, quickSystemPrompt, QUICK_SCHEMA } from './prompts';
import { chargeLabel } from './format';
import { stateReply, type ChatReply } from './reply';
import { chatMemberFor, chatOn, insertTurn, preflight, readChatSettings, settle, spendableFor, startHold, type ChatMember } from './turns-server';
import { logExchange, openConversation, replyForStored } from './log-server';
import { chatContext } from './context-server';
import { lookUpKnowledge } from './knowledge-server';
import type { QuestionOutcome } from '../voice/config';

/** Haiku 4.5's tool-less request overhead is nil; the JSON-schema instructions add a little: counted generously. */
const STRUCTURED_OVERHEAD_TOKENS = 300;

export async function askQuick(user: Pick<User, 'id' | 'email'>, input: { clientTurnId: string; question: unknown }, now: Date = new Date()): Promise<ChatReply> {
  const admin = createAdminClient();
  const settings = await readChatSettings(admin);
  if (!chatOn(settings)) return stateReply('off');
  const question = cleanQuestion(input.question, MAX_QUESTION_CHARS);
  if (!question) return stateReply('unknown');

  const member = await chatMemberFor(user);
  if (member.seatPaused) return stateReply('seat_paused');
  const pre = await preflight(admin, member, input.clientTurnId, settings, now);
  if (pre.kind === 'existing') return replyForStored(admin, pre.turn, member);
  if (pre.kind !== 'ok') return stateReply(pre.kind);

  const table = await getUnitCostTable();
  if (!unitsPriced(table, MODEL_UNITS.quick) || !process.env.ANTHROPIC_API_KEY) {
    console.error('[chat] quick: no unit prices or no API key');
    return stateReply('failed');
  }
  const budget = budgetFor({ ceilingPence: settings.quickCeilingPence, floorPence: settings.quickFloorPence, spendableBasePence: await spendableFor(member), admin: member.admin });
  if (budget === null) return { ...stateReply('top_up', { teamMember: member.teamMember }), buttons: topUpButtons(member) };

  const inserted = await insertTurn(admin, member, input.clientTurnId, 'quick');
  if (inserted.kind === 'existing') return replyForStored(admin, inserted.turn, member);
  if (inserted.kind === 'busy') return stateReply('busy');
  const turn = inserted.turn;

  let hold: StartedAction | null = null;
  const rounds: RoundUsage[] = [];
  try {
    try {
      hold = await startHold(member, turn, budget, settings);
    } catch (err) {
      await settle(admin, turn, member, null, { status: 'failed', outcome: null, rounds: [] }, settings);
      if (err instanceof SeatPausedError) return stateReply('seat_paused');
      if (err instanceof InsufficientCreditError) return { ...stateReply('top_up', { teamMember: member.teamMember }), buttons: topUpButtons(member) };
      throw err;
    }

    const ctx = await chatContext(user, member.admin, now);
    const known = await lookUpKnowledge(question, ctx.values, admin);
    const account = accountBlock({
      now,
      freeMember: ctx.values.freeMember,
      balancePence: ctx.credit?.totalPence ?? null,
      planName: ctx.credit?.cycle?.planName ?? null,
      autoTopup: ctx.credit ? ctx.credit.autoTopup : null,
      profileName: ctx.profile?.name ?? null,
      teamMember: member.teamMember,
    });
    const approved = known.answers.map((a) => `<approved_answer slug="${a.slug}">\nQ: ${a.question}\nA: ${a.answer}\n</approved_answer>`).join('\n');
    const userText = [`<account>\n${account}\n</account>`, approved || 'There is no approved answer for this question.', questionBlock(question)].join('\n\n');
    const system = quickSystemPrompt();

    const maxTokens = roundMaxTokens({ table, units: MODEL_UNITS.quick, markup: settings.markup, budgetPence: budget, spentPence: 0, promptTokens: approxTokens(system + userText) + STRUCTURED_OVERHEAD_TOKENS, cap: settings.quickMaxOutputTokens });
    if (maxTokens === 0) {
      await settle(admin, turn, member, hold, { status: 'failed', outcome: null, rounds }, settings);
      return { ...stateReply('top_up', { teamMember: member.teamMember }), buttons: topUpButtons(member) };
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: QUICK_TIMEOUT_MS, maxRetries: 0 });
    let raw: string | null = null;
    let stop: string | null = null;
    try {
      const msg = await client.messages.create({
        model: QUICK_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: userText }],
        output_config: { format: { type: 'json_schema', schema: QUICK_SCHEMA as unknown as Record<string, unknown> } },
      });
      rounds.push(usageOf(msg.usage));
      stop = msg.stop_reason ?? null;
      raw = stop === 'refusal' ? null : msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
    } catch (err) {
      console.error('[chat] quick model call failed:', (err as Error)?.message ?? err);
      await settle(admin, turn, member, hold, { status: 'failed', outcome: null, rounds }, settings);
      return stateReply('failed', { turnId: turn.id });
    }

    const reply = stop === 'max_tokens' ? null : parseQuickReply(raw);
    const slugs = new Set(known.answers.map((a) => a.slug));
    let outcome: QuestionOutcome;
    let state: ChatReply['state'];
    let text: string;
    let slug: string | null = null;
    if (reply?.outcome === 'answer' && reply.text) {
      const allowed = allowedFigures([account, ...known.answers.map((a) => a.answer), ...known.answers.map((a) => a.question), question]);
      const okSlug = reply.slug === null || slugs.has(reply.slug);
      const figures = checkFigures(reply.text, allowed);
      const advice = adviceIn(reply.text);
      if (okSlug && figures.ok && advice.length === 0) {
        state = 'answer';
        outcome = 'answered';
        text = clampWords(reply.text, 60);
        slug = reply.slug;
      } else {
        console.warn(`[chat] quick answer refused: ${!okSlug ? 'unknown slug' : !figures.ok ? `figures ${figures.figures.join(', ')}` : `advice ${advice.join(', ')}`}`);
        state = 'unknown';
        outcome = 'low_confidence';
        text = DONT_KNOW_LINE;
      }
    } else if (reply?.outcome === 'needs_full_view') {
      state = 'full_view';
      outcome = 'low_confidence';
      text = FULL_VIEW_LINE;
    } else {
      state = 'unknown';
      outcome = stop === 'refusal' || !reply ? 'could_not_answer' : known.outcome === 'low_confidence' ? 'low_confidence' : 'could_not_answer';
      text = DONT_KNOW_LINE;
    }

    const buttons =
      state === 'answer'
        ? buildButtons(reply?.action ? [{ kind: reply.action }] : [], { surface: 'quick', teamMember: member.teamMember, allowedDeals: new Set(), allowedWhatIfs: new Set(), allowedShowMe: new Set(), deepSearchOffered: false })
        : state === 'full_view'
          ? buildButtons([{ kind: 'open_full_view' }], { surface: 'quick', teamMember: member.teamMember, allowedDeals: new Set(), allowedWhatIfs: new Set(), allowedShowMe: new Set(), deepSearchOffered: false })
          : [];

    const conv = await openConversation(admin, member, 'quick', null, { idleMinutes: settings.sessionIdleMinutes, historyTurns: 0, now });
    const logged = conv ? await logExchange(conv, { question, answer: text, outcome, knowledgeRef: slug, surface: 'quick', at: now }) : { questionId: null, agentSeq: null };
    const settled = await settle(
      admin,
      turn,
      member,
      hold,
      { status: state === 'answer' ? 'answered' : 'no_answer', outcome, rounds, knowledgeSlug: slug, conversationId: conv?.id ?? null, questionId: logged.questionId, logSeq: logged.agentSeq, buttons },
      settings,
    );
    // Record only: a quick answer never counts towards weekly active (Zac, 29 Sep).
    logActivity(user.id, 'si_chat_quick', { extras: { outcome } });
    return {
      state,
      turnId: turn.id,
      text,
      buttons,
      charged: settled.chargedFacePence > 0 ? chargeLabel(settled.chargedFacePence) : null,
    };
  } catch (err) {
    console.error('[chat] quick failed:', (err as Error)?.message ?? err);
    await settle(admin, turn, member, hold, { status: 'failed', outcome: null, rounds }, settings).catch(() => {});
    return stateReply('failed', { turnId: turn.id });
  } finally {
    await hold?.finish().catch(() => {});
  }
}

function topUpButtons(member: ChatMember) {
  return buildButtons([{ kind: 'top_up' }], { surface: 'quick', teamMember: member.teamMember, allowedDeals: new Set(), allowedWhatIfs: new Set(), allowedShowMe: new Set(), deepSearchOffered: false });
}

