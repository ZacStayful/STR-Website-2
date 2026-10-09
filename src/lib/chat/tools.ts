/**
 * Batch 26: the full view's look-ups, as the model sees them. Every one is
 * read-only and about the signed-in member only: no tool takes a member, a
 * user or an account, so nothing the model or the member types can point a
 * look-up at someone else (the implementations, tools-server.ts, take the
 * member from the session). The one thing that "does" anything,
 * offer_action, only puts a button in front of the member.
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
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** Calls that only add to the answer (a button, a fact to offer to remember): never worth another round. */
export const ANSWER_EXTRAS: ReadonlySet<string> = new Set<ToolName>(['offer_action', 'propose_fact']);

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
    description: 'Put a button under the answer for the member to tap. It does nothing itself. target is a deal id (open_deal, full_analysis, show_me), a what-if key (use_this), a stage (my_deals), or null.',
    strict: true,
    input_schema: { type: 'object', properties: { kind: { type: 'string', enum: [...ACTION_KINDS] }, target: nullable({ type: 'string' }) }, required: ['kind', 'target'], additionalProperties: false },
  },
  {
    name: 'propose_fact',
    description: 'Offer to remember something the member told you about what they want ("Only wants 2-beds"). The page asks them "Want me to remember that?" and saves it only on their yes. At most once per answer; never anything sensitive or personal.',
    strict: true,
    input_schema: { type: 'object', properties: { fact: { type: 'string', description: 'The fact, short, in the third person.' } }, required: ['fact'], additionalProperties: false },
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
  | { tool: 'propose_fact'; fact: string };

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
    default:
      return { tool: name };
  }
}
