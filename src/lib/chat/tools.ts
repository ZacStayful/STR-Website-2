/**
 * Batch 26: the full view's look-ups, as the model sees them. Every one is
 * about the signed-in member only: no tool takes a member, a user or an
 * account, so nothing the model or the member types can point a look-up at
 * someone else (the implementations, tools-server.ts, take the member from
 * the session). offer_action only puts a button in front of the member.
 *
 * Batch 27: the eye can also act for the member, through four more tools.
 * propose_actions hands a plan to src/lib/si-actions, which checks every
 * step on the server (only the eight kinds of step exist, only deals this
 * answer's look-ups returned, the buttons' own prices and rules) before
 * anything runs; draft_message fills a next-step template for the member to
 * send themselves; report_issue files a bug for them (or puts a feature
 * request in front of them to send); ask_which gives tap choices when it's
 * unclear what they mean. Nothing on the "never" list (paying, plans,
 * cancelling, deleting, sharing, notifications, contacting anyone) has a
 * tool, so no text can make one happen.
 *
 * Strict schemas (additionalProperties false, every field required, null for
 * "not given"): the API guarantees the shape. The list is fixed and in a
 * fixed order, so it is part of the cached prompt prefix. Eager input
 * streaming is off: the inputs are a few bytes.
 *
 * Pure.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { ACTION_KINDS } from './actions.ts';
import { CRITERIA_QUESTIONS, DRAFT_KINDS, STEP_KINDS } from '../si-actions/config.ts';
import type { ProposedStep } from '../si-actions/validate.ts';
import { parseAmount } from '../pipeline/offer-amount.ts';

export const TOOL_NAMES = [
  'search_knowledge',
  'my_profile_summary',
  'todays_picks',
  'my_deals',
  'deal_facts',
  'what_if_suggestions',
  'deals_checked_count',
  'credit_state',
  'why_called',
  'offer_action',
  'propose_fact',
  'propose_actions',
  'draft_message',
  'report_issue',
  'ask_which',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** Calls that only add to the answer (a button, a fact to offer to remember, tap choices): never worth another round. */
export const ANSWER_EXTRAS: ReadonlySet<string> = new Set<ToolName>(['offer_action', 'propose_fact', 'ask_which']);

/** What the member sees while a look-up runs, so the wait is never blank. */
export const TOOL_STATUS: Record<ToolName, string> = {
  search_knowledge: 'Checking how Stayful works…',
  my_profile_summary: 'Looking at your profile…',
  todays_picks: 'Looking at today’s picks…',
  my_deals: 'Looking at your deals…',
  deal_facts: 'Looking at that deal…',
  what_if_suggestions: 'Working out what would find you more…',
  deals_checked_count: 'Counting what I checked today…',
  credit_state: 'Checking your credit…',
  why_called: 'Looking at my calls…',
  offer_action: 'Getting that ready…',
  propose_fact: 'Getting that ready…',
  propose_actions: 'Getting that ready…',
  draft_message: 'Writing your message…',
  report_issue: 'Passing that to the team…',
  ask_which: 'Getting that ready…',
};

/** The line for a round's look-ups: the first real look-up's, or null for an unknown name. */
export function statusFor(names: readonly string[]): string | null {
  const lookUp = names.find((n) => !ANSWER_EXTRAS.has(n) && n in TOOL_STATUS) ?? names.find((n) => n in TOOL_STATUS);
  return lookUp ? TOOL_STATUS[lookUp as ToolName] : null;
}

export const STAGE_VALUES = ['watching', 'contacted', 'viewing', 'offer', 'secured', 'passed'] as const;

const none: Anthropic.Tool.InputSchema = { type: 'object', properties: {}, required: [], additionalProperties: false };
const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });

export const CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_knowledge',
    description: 'Look up Stayful\'s approved answers about the service: prices, credit, plans, how picks and reports work, calls, texts, privacy. Returns an approved answer with today\'s figures, or found:false. Use it for any question about how Stayful works; never answer those from your own knowledge.',
    strict: true,
    input_schema: { type: 'object', properties: { question: { type: 'string', description: 'The member\'s question, in their words.' } }, required: ['question'], additionalProperties: false },
  },
  {
    name: 'my_profile_summary',
    description: 'The member\'s active search profile: the deal types they chose, budget, areas, minimum profit, and the names of their other saved profiles.',
    strict: true,
    input_schema: none,
  },
  {
    name: 'todays_picks',
    description: 'The member\'s deals for today (Today\'s list), in order, with the figures the app shows on each card. Use it for "what should I look at today?" — describe them, never advise.',
    strict: true,
    input_schema: none,
  },
  {
    name: 'my_deals',
    description: 'Deals the member is tracking in My deals, with their stage and the card figures. stage filters to one stage (watching = Kept); null for all.',
    strict: true,
    input_schema: { type: 'object', properties: { stage: nullable({ type: 'string', enum: [...STAGE_VALUES] }) }, required: ['stage'], additionalProperties: false },
  },
  {
    name: 'deal_facts',
    description: 'One deal\'s figures by its id (from todays_picks or my_deals): the card figures, and the full report\'s figures if the member has opened or analysed it. A deal the member can\'t see comes back not available.',
    strict: true,
    input_schema: { type: 'object', properties: { deal_id: { type: 'string', description: 'The deal id from another look-up.' } }, required: ['deal_id'], additionalProperties: false },
  },
  {
    name: 'what_if_suggestions',
    description: 'Why nothing (or little) matches the member\'s profile, as one-change suggestions with real counts ("if you raise your budget to …, I\'d have 6 matches"). Each can carry a Show me deal and a Use this key for offer_action.',
    strict: true,
    input_schema: none,
  },
  {
    name: 'deals_checked_count',
    description: 'How many live deals Stayful Intelligence checked for the member today, as the app says it.',
    strict: true,
    input_schema: none,
  },
  {
    name: 'credit_state',
    description: 'The member\'s credit balance, plan, auto top-up, and today\'s prices for the things they can buy.',
    strict: true,
    input_schema: none,
  },
  {
    name: 'why_called',
    description: 'Why Stayful Intelligence called the member, or why it didn\'t, on a day: its standout-deal decisions and the calls it placed. date is YYYY-MM-DD (UK); null for the most recent.',
    strict: true,
    input_schema: { type: 'object', properties: { date: nullable({ type: 'string', description: 'YYYY-MM-DD' }) }, required: ['date'], additionalProperties: false },
  },
  {
    name: 'offer_action',
    description: 'Put a button under the answer for the member to tap. It does nothing itself. target is a deal id (open_deal, full_analysis, btl_report, show_me), a what-if key (use_this), a stage (my_deals), or null.',
    strict: true,
    input_schema: { type: 'object', properties: { kind: { type: 'string', enum: [...ACTION_KINDS] }, target: nullable({ type: 'string' }) }, required: ['kind', 'target'], additionalProperties: false },
  },
  {
    name: 'propose_fact',
    description: 'Offer to remember something the member told you about what they want ("Only wants 2-beds"). The page asks them "Want me to remember that?" and saves it only on their yes. At most once per answer; never anything sensitive or personal.',
    strict: true,
    input_schema: { type: 'object', properties: { fact: { type: 'string', description: 'The fact, short, with no subject, as in "Only wants 2-beds" or "Looking in Leeds and York".' } }, required: ['fact'], additionalProperties: false },
  },
  {
    name: 'propose_actions',
    description:
      "Do what the member asks, for them, once per answer: keep or pass deals, move a deal to a stage, run full analyses or Deep reports, run the deep search, check a pasted listing link, or change their active profile's search criteria. Name deals only by a deal_id your look-ups returned in this answer (look them up first). Free changes happen as soon as your answer is shown; anything that costs credit costs exactly what its button costs, shows its price with a Stop countdown first, and asks them first when it would leave them low on credit or is over the limit for one go. The result says what will happen, the price line to quote, and what was dropped and why. Never for paying, topping up, plans, auto top-up, cancelling, deleting, sharing, notifications or contacting anyone: offer the button instead.",
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          description: 'In the order to do them (charged ones are run, and capped, in this order).',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: [...STEP_KINDS], description: 'keep, pass, stage_move (needs stage), full_analysis, deep_report, deep_search, check_link (needs url), change_criteria (needs question and value), btl_report (the £2 buy-to-let report, on a deal whose type is buy to let).' },
              deal_id: nullable({ type: 'string', description: 'For keep, pass, stage_move, full_analysis, deep_report and btl_report: a deal_id from a look-up in this answer.' }),
              stage: nullable({ type: 'string', enum: [...STAGE_VALUES], description: 'For stage_move (watching = Kept).' }),
              url: nullable({ type: 'string', description: 'For check_link: the link they pasted, exactly.' }),
              question: nullable({ type: 'string', enum: [...CRITERIA_QUESTIONS], description: 'For change_criteria.' }),
              value: nullable({
                type: 'string',
                description:
                  'For change_criteria: bedrooms "1" to "4" (4 = 4 or more); budget one of u100, 100-200, 200-350, 350-500, 500+ (pick the band their figure falls in); max_rent, min_profit, r2r_min_profit pounds a month like "900"; property_type flat, house or either; add_deal_type / remove_deal_type short-let, brrr or rent-to-rent (remove only when they asked to in plain words); add_areas postcode areas like "BD, LS".',
              }),
            },
            required: ['action', 'deal_id', 'stage', 'url', 'question', 'value'],
            additionalProperties: false,
          },
        },
      },
      required: ['steps'],
      additionalProperties: false,
    },
  },
  {
    name: 'draft_message',
    description: "Write the message to the agent or landlord for a deal in their My deals that has been opened, from Stayful's own template for it, with the deal's real facts. It appears under your answer with a Copy button; the member sends it themselves (you never send anything). message: enquiry (first contact), follow_up, or offer (with offer_amount when they gave one); null picks the one for the deal's stage. The result never shows you the message.",
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'The deal id from a look-up in this answer.' },
        message: nullable({ type: 'string', enum: [...DRAFT_KINDS] }),
        offer_amount: nullable({ type: 'string', description: 'The amount they said, as they said it ("£140k").' }),
      },
      required: ['deal_id', 'message', 'offer_amount'],
      additionalProperties: false,
    },
  },
  {
    name: 'report_issue',
    description:
      "Pass something to the Stayful team. kind bug: they say something is wrong or broken, or asked you to report it: it is filed for them now and you get its reference to tell them. kind feature: they want something you can't do (or you couldn't help): a filled-in request appears under your answer for them to send. Once per answer.",
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['bug', 'feature'] },
        summary: { type: 'string', description: 'One line: what is wrong, or what they want.' },
        their_words: { type: 'string', description: 'What they said about it, in their words.' },
      },
      required: ['kind', 'summary', 'their_words'],
      additionalProperties: false,
    },
  },
  {
    name: 'ask_which',
    description: 'When it is unclear which deal or what they mean, ask one short question in your answer and give up to four tap choices here (short, in their words, naming deals by area and type). The one they tap is sent as their next message. Never guess instead.',
    strict: true,
    input_schema: { type: 'object', properties: { options: { type: 'array', items: { type: 'string' }, description: 'Two to four short choices.' } }, required: ['options'], additionalProperties: false },
  },
];

export function isToolName(v: unknown): v is ToolName {
  return typeof v === 'string' && (TOOL_NAMES as readonly string[]).includes(v);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type ToolInput =
  | { tool: 'search_knowledge'; question: string }
  | { tool: 'my_profile_summary' | 'todays_picks' | 'what_if_suggestions' | 'deals_checked_count' | 'credit_state' }
  | { tool: 'my_deals'; stage: (typeof STAGE_VALUES)[number] | null }
  | { tool: 'deal_facts'; dealId: string }
  | { tool: 'why_called'; date: string | null }
  | { tool: 'offer_action'; kind: string; target: string | null }
  | { tool: 'propose_fact'; fact: string }
  | { tool: 'propose_actions'; steps: ProposedStep[] }
  | { tool: 'draft_message'; dealId: string; message: (typeof DRAFT_KINDS)[number] | null; offerAmount: number | null }
  | { tool: 'report_issue'; kind: 'bug' | 'feature'; summary: string; theirWords: string }
  | { tool: 'ask_which'; options: string[] };

/** A tool call's input, checked again here (strict mode guarantees the shape; this guards the values). Null: refuse the call. */
export function parseToolInput(name: unknown, input: unknown): ToolInput | null {
  if (!isToolName(name)) return null;
  const o = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  switch (name) {
    case 'search_knowledge': {
      const question = str(o.question, 500);
      return question ? { tool: name, question } : null;
    }
    case 'my_deals': {
      const stage = o.stage === null || o.stage === undefined ? null : (STAGE_VALUES as readonly unknown[]).includes(o.stage) ? (o.stage as (typeof STAGE_VALUES)[number]) : undefined;
      return stage === undefined ? null : { tool: name, stage };
    }
    case 'deal_facts': {
      const dealId = str(o.deal_id, 40);
      return UUID.test(dealId) ? { tool: name, dealId } : null;
    }
    case 'why_called': {
      const date = o.date === null || o.date === undefined ? null : str(o.date, 10);
      return date === null || DAY.test(date) ? { tool: name, date } : null;
    }
    case 'offer_action':
      return { tool: name, kind: str(o.kind, 40), target: o.target === null || o.target === undefined ? null : str(o.target, 80) };
    case 'propose_fact': {
      const fact = str(o.fact, 160);
      return fact ? { tool: name, fact } : null;
    }
    case 'propose_actions': {
      if (!Array.isArray(o.steps) || o.steps.length === 0) return null;
      const opt = (v: unknown, max: number) => (v === null || v === undefined ? null : str(v, max) || null);
      const steps = o.steps.slice(0, 60).map((raw): ProposedStep => {
        const x = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        return { action: str(x.action, 40), dealId: opt(x.deal_id, 40), stage: opt(x.stage, 20), url: opt(x.url, 2048), question: opt(x.question, 40), value: opt(x.value, 80) };
      });
      return { tool: name, steps };
    }
    case 'draft_message': {
      const dealId = str(o.deal_id, 40);
      if (!UUID.test(dealId)) return null;
      const message = o.message === null || o.message === undefined ? null : (DRAFT_KINDS as readonly unknown[]).includes(o.message) ? (o.message as (typeof DRAFT_KINDS)[number]) : undefined;
      if (message === undefined) return null;
      const amount = typeof o.offer_amount === 'string' ? parseAmount(o.offer_amount.slice(0, 30)) : null;
      return { tool: name, dealId, message, offerAmount: amount };
    }
    case 'report_issue': {
      if (o.kind !== 'bug' && o.kind !== 'feature') return null;
      const summary = str(o.summary, 300);
      return summary ? { tool: name, kind: o.kind, summary, theirWords: str(o.their_words, 1200) } : null;
    }
    case 'ask_which': {
      if (!Array.isArray(o.options)) return null;
      const options = [...new Set(o.options.map((v) => str(v, 80)).filter(Boolean))].slice(0, 4);
      return options.length >= 2 ? { tool: name, options } : null;
    }
    default:
      return { tool: name };
  }
}
