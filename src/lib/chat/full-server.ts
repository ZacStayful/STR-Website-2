import 'server-only';

/**
 * Batch 26: a question in the full Stayful Intelligence view. Sonnet 5.5
 * with the read-only look-ups (tools-server.ts), streamed to the page.
 *
 *   prepareFull  everything that can refuse before a stream opens (switched
 *                off, a retry, too fast, the unanswered cap, under the floor,
 *                a paused seat, another question still running) and the hold
 *   runFull      the look-up loop: each round's max_tokens sized to what is
 *                left of the hold, so the charge can never pass the ceiling;
 *                text streamed as it comes (cleared if the round turns out to
 *                be a look-up); the answer checked (no figure it wasn't given,
 *                no advice) before it is charged
 *
 * A manual loop rather than the SDK's tool runner: every round is metered,
 * the budget is re-checked between rounds, the member is bound on the server
 * and the rounds are capped. Thinking stays between tools (Sonnet 5.5 can't
 * switch it off) at low effort; the model's progress notes are never shown.
 * Earlier questions go back as plain text, so no thinking block is ever
 * replayed across questions. Prompt caching: one breakpoint on the fixed
 * system prompt (tools + system are the same bytes for every member) and the
 * automatic one on the growing conversation.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createAdminClient } from '../supabase/admin';
import { InsufficientCreditError } from '../credit/ledger';
import { SeatPausedError, type StartedAction } from '../credit/action';
import { getUnitCostTable } from '../credit/unit-costs';
import type { UnitCostTable } from '../credit/costs';
import { recordActivity } from '../activity/log';
import { CAPPED_LINE, DONT_KNOW_LINE, FULL_MODEL, FULL_ROUND_MAX_TOKENS, FULL_ROUND_TIMEOUT_MS, MAX_QUESTION_CHARS, MODEL_UNITS } from './config';
import { approxTokens, budgetFor, costOf, roundMaxTokens, unitsPriced, usageOf, NO_USAGE, type RoundUsage } from './budget';
import { adviceIn, allowedFigures, checkFigures, clampWords, cleanQuestion } from './guard';
import { buildButtons } from './actions';
import { accountBlock, fullSystemPrompt, historyMessages, questionBlock } from './prompts';
import { CHAT_TOOLS, parseToolInput } from './tools';
import { chargeLabel } from './format';
import { stateReply, type ChatReply, type FullEvent } from './reply';
import { chatMemberFor, chatOn, insertTurn, preflight, readChatSettings, settle, spendableFor, startHold, type ChatMember, type TurnRow } from './turns-server';
import { logExchange, openConversation, replyForStored } from './log-server';
import type { ChatSettings } from './settings';
import { chatContext } from './context-server';
import { chatTools, newAnswerState } from './tools-server';
import type { QuestionOutcome } from '../voice/config';

/** A round with less room than this answers instead of looking anything else up. */
const FINAL_ROUND_MIN_TOKENS = 350;
/** Sonnet 5.5's tool-use system prompt (auto), per the pricing page. */
const TOOL_SYSTEM_TOKENS = 286;

export type { FullEvent };

export interface FullJob {
  user: Pick<User, 'id' | 'email'>;
  supabase: SupabaseClient;
  member: ChatMember;
  settings: ChatSettings;
  turn: TurnRow;
  hold: StartedAction;
  budget: number;
  table: UnitCostTable;
  question: string;
  conversationId: unknown;
  now: Date;
}

export type Prepared = { kind: 'reply'; reply: ChatReply } | { kind: 'run'; job: FullJob };

export async function prepareFull(user: Pick<User, 'id' | 'email'>, supabase: SupabaseClient, input: { clientTurnId: string; question: unknown; conversationId: unknown }, now: Date = new Date()): Promise<Prepared> {
  const admin = createAdminClient();
  const settings = await readChatSettings(admin);
  if (!chatOn(settings)) return { kind: 'reply', reply: stateReply('off') };
  const question = cleanQuestion(input.question, MAX_QUESTION_CHARS);
  if (!question) return { kind: 'reply', reply: stateReply('unknown') };
  const member = await chatMemberFor(user);
  if (member.seatPaused) return { kind: 'reply', reply: stateReply('seat_paused') };
  const pre = await preflight(admin, member, input.clientTurnId, settings, now);
  if (pre.kind === 'existing') return { kind: 'reply', reply: await replyForStored(admin, pre.turn, member) };
  if (pre.kind !== 'ok') return { kind: 'reply', reply: stateReply(pre.kind) };

  const table = await getUnitCostTable();
  if (!unitsPriced(table, MODEL_UNITS.full) || !process.env.ANTHROPIC_API_KEY) {
    console.error('[chat] full: no unit prices or no API key');
    return { kind: 'reply', reply: stateReply('failed') };
  }
  const budget = budgetFor({ ceilingPence: settings.fullCeilingPence, floorPence: settings.fullFloorPence, spendableBasePence: await spendableFor(member), admin: member.admin });
  if (budget === null) return { kind: 'reply', reply: topUp(member) };

  const inserted = await insertTurn(admin, member, input.clientTurnId, 'full');
  if (inserted.kind === 'existing') return { kind: 'reply', reply: await replyForStored(admin, inserted.turn, member) };
  if (inserted.kind === 'busy') return { kind: 'reply', reply: stateReply('busy') };
  try {
    const hold = await startHold(member, inserted.turn, budget, settings);
    return { kind: 'run', job: { user, supabase, member, settings, turn: inserted.turn, hold, budget, table, question, conversationId: input.conversationId, now } };
  } catch (err) {
    await settle(admin, inserted.turn, member, null, { status: 'failed', outcome: null, rounds: [] }, settings);
    if (err instanceof SeatPausedError) return { kind: 'reply', reply: stateReply('seat_paused') };
    if (err instanceof InsufficientCreditError) return { kind: 'reply', reply: topUp(member) };
    throw err;
  }
}

function topUp(member: ChatMember): ChatReply {
  return { ...stateReply('top_up', { teamMember: member.teamMember }), buttons: buildButtons([{ kind: 'top_up' }], { surface: 'full', teamMember: member.teamMember, allowedDeals: new Set(), allowedWhatIfs: new Set(), allowedShowMe: new Set(), deepSearchOffered: false }) };
}

/** Is the page still there? Set by the route when the stream is cancelled. */
export interface Liveness {
  gone(): boolean;
  /** Called once with the abort for the model stream in flight. */
  onGone(abort: () => void): void;
}

export async function runFull(job: FullJob, send: (e: FullEvent) => void, live: Liveness): Promise<ChatReply> {
  const { member, settings, turn, hold, table, question, now } = job;
  const admin = createAdminClient();
  const units = MODEL_UNITS.full;
  const rounds: RoundUsage[] = [];
  let settled = false;
  const fail = async (state: 'failed' | 'did_not_finish'): Promise<ChatReply> => {
    if (!settled) {
      settled = true;
      await settle(admin, turn, member, hold, { status: 'failed', outcome: null, rounds }, settings).catch((e) => console.error('[chat] settle failed:', e));
    }
    return stateReply(state, { turnId: turn.id });
  };

  try {
    send({ type: 'start', turnId: turn.id });
    send({ type: 'thinking' });
    const ctx = await chatContext(job.user, member.admin, now);
    const conv = await openConversation(admin, member, 'full', job.conversationId, { idleMinutes: settings.sessionIdleMinutes, historyTurns: settings.historyTurns, now });
    if (!conv) return await fail('failed');
    const tools = chatTools(member, ctx, job.supabase, now);
    const state = newAnswerState();

    const account = accountBlock({
      now,
      freeMember: ctx.values.freeMember,
      balancePence: ctx.credit?.totalPence ?? null,
      planName: ctx.credit?.cycle?.planName ?? null,
      autoTopup: ctx.credit ? ctx.credit.autoTopup : null,
      profileName: ctx.profile?.name ?? null,
      teamMember: member.teamMember,
    });
    const messages: Anthropic.MessageParam[] = historyMessages(conv.history);
    messages.push({ role: 'user', content: [{ type: 'text', text: `<account>\n${account}\n</account>` }, { type: 'text', text: questionBlock(question) }] });
    const system: Anthropic.TextBlockParam[] = [{ type: 'text', text: fullSystemPrompt(settings.fullMaxWords), cache_control: { type: 'ephemeral' } }];
    const fixedTokens = approxTokens(system[0].text + JSON.stringify(CHAT_TOOLS)) + TOOL_SYSTEM_TOKENS;

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: FULL_ROUND_TIMEOUT_MS, maxRetries: 0 });
    let answer = '';
    let stop: string | null = null;
    let capped = false;
    let spent = 0;

    for (let round = 0; ; round++) {
      if (live.gone()) return await fail('did_not_finish');
      const promptTokens = fixedTokens + approxTokens(JSON.stringify(messages));
      const room = roundMaxTokens({ table, units, markup: settings.markup, budgetPence: job.budget, spentPence: spent, promptTokens, cap: FULL_ROUND_MAX_TOKENS });
      if (room === 0) {
        // Nothing left in the hold for another round: stop with what was said.
        capped = true;
        break;
      }
      const mayLookUp = round < settings.fullMaxToolRounds && room >= FINAL_ROUND_MIN_TOKENS;
      let text = '';
      let usage: RoundUsage = NO_USAGE;
      let final: Anthropic.Message;
      const stream = client.messages.stream({
        model: FULL_MODEL,
        max_tokens: room,
        system,
        tools: CHAT_TOOLS,
        tool_choice: mayLookUp ? { type: 'auto' } : { type: 'none' },
        messages,
        output_config: { effort: 'low' },
        // Sonnet 5.5 can't switch thinking off; between_tools keeps it to short notes between look-ups (as the gap job does).
        thinking: { type: 'between_tools' } as never,
        cache_control: { type: 'ephemeral' },
      });
      live.onGone(() => stream.abort());
      try {
        for await (const event of stream) {
          if (event.type === 'message_start') usage = usageOf(event.message.usage);
          else if (event.type === 'message_delta') usage = { ...usage, output: usageOf(event.usage).output || usage.output };
          else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            text += event.delta.text;
            send({ type: 'delta', text: event.delta.text });
          }
        }
        final = await stream.finalMessage();
        usage = usageOf(final.usage);
        rounds.push(usage);
      } catch (err) {
        // A dropped or aborted stream: what it used so far is still our cost (house spend), and nothing is charged.
        rounds.push(usage);
        if (live.gone() || err instanceof Anthropic.APIUserAbortError) return await fail('did_not_finish');
        console.error('[chat] full round failed:', (err as Error)?.message ?? err);
        return await fail('failed');
      }
      spent = costOf(table, units, rounds, settings.markup).basePence;
      stop = final.stop_reason ?? null;

      if (stop === 'tool_use' && mayLookUp) {
        if (text) send({ type: 'clear' });
        send({ type: 'thinking' });
        messages.push({ role: 'assistant', content: final.content });
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const block of final.content) {
          if (block.type !== 'tool_use') continue;
          const input = parseToolInput(block.name, block.input);
          if (!input) {
            results.push({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: `Unknown look-up or bad input. The look-ups are: ${CHAT_TOOLS.map((t) => t.name).join(', ')}.` });
            continue;
          }
          results.push({ type: 'tool_result', tool_use_id: block.id, content: await tools.run(input, state) });
        }
        // All results in one user message, in the order asked.
        messages.push({ role: 'user', content: results });
        continue;
      }
      answer = text.trim();
      if (stop === 'max_tokens') capped = true;
      break;
    }

    if (live.gone()) return await fail('did_not_finish');

    // ── Check the answer before it is shown for good, and before it is charged ──
    let outcome: QuestionOutcome;
    let replyState: ChatReply['state'];
    let shown: string;
    const refused = stop === 'refusal';
    const dontKnow = !answer || refused || answer.includes("I don't know that one yet") || answer.includes('I don’t know that one yet');
    if (dontKnow) {
      replyState = 'unknown';
      outcome = 'could_not_answer';
      shown = DONT_KNOW_LINE;
      if (answer !== DONT_KNOW_LINE) send({ type: 'replace', text: shown });
    } else {
      const allowed = allowedFigures([account, question, ...state.sources, ...conv.history.map((h) => h.text)]);
      const figures = checkFigures(answer, allowed);
      const advice = adviceIn(answer);
      if (!figures.ok || advice.length > 0) {
        console.warn(`[chat] full answer refused: ${!figures.ok ? `figures ${figures.figures.join(', ')}` : `advice ${advice.join(', ')}`}`);
        replyState = 'unknown';
        outcome = 'low_confidence';
        shown = DONT_KNOW_LINE;
        send({ type: 'replace', text: shown });
      } else {
        replyState = 'answer';
        outcome = 'answered';
        shown = clampWords(answer, settings.fullMaxWords);
        if (capped) shown = `${shown} ${CAPPED_LINE}`;
        if (shown !== answer) send({ type: 'replace', text: shown });
      }
    }
    const buttons = replyState === 'answer' ? state.buttons : [];
    const factProposal = replyState === 'answer' ? state.factProposal : null;

    const logged = await logExchange(conv, { question, answer: shown, outcome, knowledgeRef: replyState === 'answer' ? state.knowledgeSlug : null, surface: 'full', at: now });
    settled = true;
    const s = await settle(
      admin,
      turn,
      member,
      hold,
      {
        status: replyState === 'answer' ? 'answered' : 'no_answer',
        outcome,
        rounds,
        toolsUsed: state.toolsUsed,
        knowledgeSlug: replyState === 'answer' ? state.knowledgeSlug : null,
        matchConfidence: state.matchConfidence,
        conversationId: conv.id,
        questionId: logged.questionId,
        logSeq: logged.agentSeq,
        capped,
        factProposal: factProposal ? { fact: factProposal, asked: question } : null,
        buttons,
      },
      settings,
    );
    // A full-view question counts towards weekly active (Zac, 29 Sep). Extras: the outcome only.
    await recordActivity(job.user.id, 'si_chat_full', { extras: { outcome } });
    const reply: ChatReply = {
      state: replyState,
      turnId: turn.id,
      text: shown,
      buttons,
      charged: s.chargedFacePence > 0 ? chargeLabel(s.chargedFacePence) : null,
      conversationId: conv.id,
      factProposal,
      capped,
    };
    send({ type: 'done', reply });
    return reply;
  } catch (err) {
    console.error('[chat] full failed:', (err as Error)?.message ?? err);
    const r = await fail(live.gone() ? 'did_not_finish' : 'failed');
    send({ type: 'done', reply: r });
    return r;
  } finally {
    await hold.finish().catch(() => {});
  }
}
