/**
 * Part B: when what a member keeps says something different from what they
 * answered. "You've kept 4 houses but said flats only. Update your profile?"
 *
 * Rules, all on Keeps in the signal window (60 days), per profile:
 *   type       they said flats (or houses) and kept at least 3 of the other
 *   bedrooms   they said N bedrooms and kept at least 3 of another size
 *   location   they look in chosen areas and kept at least 3 outside them
 *   budget     they gave a budget and kept at least 3 deals outside it
 *   kind       they buy (or rent) and kept at least 3 of the other kind
 * Accepting changes the answer (type, bedrooms, kind) or makes the check a
 * nice-to-have (location, budget: the answer itself still stands).
 *
 * Asking: one prompt a visit, the first that applies. A question shown on an
 * earlier day is not asked again for a week; one the member answered "keep
 * my answer" to is not asked again for 30 days. Shown today: still shown
 * until answered, so a reload does not lose it.
 *
 * Pure: no network, no database, no server-only.
 */
import type { MarketGoals } from '../market/goals.ts';
import { TAILORING } from './config.ts';
import { wantsFor } from './criteria.ts';
import type { CriterionKey, Signal, TailoringProfile } from './profile.ts';

export const PROMPT_QUESTIONS = ['type', 'bedrooms', 'location', 'budget', 'kind'] as const;
export type PromptQuestion = (typeof PROMPT_QUESTIONS)[number];

export function isPromptQuestion(v: unknown): v is PromptQuestion {
  return typeof v === 'string' && (PROMPT_QUESTIONS as readonly string[]).includes(v);
}

/** What accepting a prompt does. */
export type PromptChange = { kind: 'goals'; goals: MarketGoals } | { kind: 'mode'; criterion: CriterionKey };

export interface Prompt {
  question: PromptQuestion;
  /** How many Keeps say otherwise. */
  count: number;
  text: string;
  accept: string;
  keep: string;
  change: PromptChange;
}

export interface PromptState {
  question: PromptQuestion;
  lastShownAt: string | null;
  answeredAt: string | null;
  answer: 'accepted' | 'dismissed' | null;
}

const PLURAL = { flat: 'flats', house: 'houses' } as const;
const bedWord = (n: number) => (n >= 4 ? '4+ bed' : `${n}-bed`);
const bedAnswer = (n: number) => (n >= 4 ? '4 or more bedrooms' : `${n} bed`);

/** Every prompt this profile's Keeps call for, in the order they are asked. */
export function promptsFor(p: TailoringProfile): Prompt[] {
  const g = p.goals;
  if (!g) return [];
  const keeps: Signal[] = p.signals.filter((s) => s.source === 'keep');
  const min = TAILORING.prompts.minContradictions;
  const wants = wantsFor(p);
  const out: Prompt[] = [];

  if (wants.propertyType) {
    const want = wants.propertyType;
    const other = want === 'flat' ? 'house' : 'flat';
    const n = keeps.filter((s) => s.kind === 'sale' && s.propertyKind === other).length;
    if (n >= min) out.push({ question: 'type', count: n, text: `You’ve kept ${n} ${PLURAL[other]} but said ${PLURAL[want]} only. Update your profile?`, accept: `Include ${PLURAL[other]}`, keep: `Keep ${PLURAL[want]} only`, change: { kind: 'goals', goals: { ...g, buyer: { ...g.buyer, propertyType: 'either' } } } });
  }

  if (g.bedrooms !== null) {
    const want = g.bedrooms;
    const counts = new Map<number, number>();
    for (const s of keeps) {
      if (s.bedrooms === null) continue;
      const size = Math.min(4, s.bedrooms);
      if (size === want) continue;
      counts.set(size, (counts.get(size) ?? 0) + 1);
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    if (total >= min) {
      // The size they keep most, the smaller on a tie.
      const [size] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
      const bedrooms = size as 1 | 2 | 3 | 4;
      out.push({ question: 'bedrooms', count: total, text: `You’ve kept ${total} deals that aren’t ${bedWord(want)}, most of them ${bedWord(size)}. Update your profile?`, accept: `Switch to ${bedAnswer(size)}`, keep: `Keep ${bedAnswer(want)}`, change: { kind: 'goals', goals: { ...g, bedrooms } } });
    }
  }

  const modeOf = (key: CriterionKey) => p.modes[key] ?? 'must';
  if (wants.areas && modeOf('location') === 'must') {
    const n = keeps.filter((s) => s.area !== null && !wants.areas!.has(s.area)).length;
    if (n >= min) out.push({ question: 'location', count: n, text: `You’ve kept ${n} deals outside where you look. Show deals from further afield too?`, accept: 'Make location a nice-to-have', keep: 'Keep to my areas', change: { kind: 'mode', criterion: 'location' } });
  }

  if (wants.budget && modeOf('budget') === 'must') {
    const b = wants.budget;
    const n = keeps.filter((s) => s.kind === 'sale' && s.amount !== null && ((b.min !== null && s.amount < b.min) || (b.max !== null && s.amount > b.max))).length;
    if (n >= min) out.push({ question: 'budget', count: n, text: `You’ve kept ${n} deals outside your budget. Show deals outside it too?`, accept: 'Make budget a nice-to-have', keep: 'Keep to my budget', change: { kind: 'mode', criterion: 'budget' } });
  }

  if (g.sourcingKind !== 'both') {
    const other = g.sourcingKind === 'sale' ? 'rent' : 'sale';
    const n = keeps.filter((s) => s.kind === other).length;
    if (n >= min) {
      const text = other === 'rent' ? `You’ve kept ${n} rent-to-rent deals but this profile is for buying. Show rent-to-rent too?` : `You’ve kept ${n} deals to buy but this profile is for rent-to-rent. Show deals to buy too?`;
      out.push({ question: 'kind', count: n, text, accept: other === 'rent' ? 'Show rent-to-rent too' : 'Show deals to buy too', keep: other === 'rent' ? 'Buying only' : 'Rent-to-rent only', change: { kind: 'goals', goals: { ...g, sourcingKind: 'both' } } });
    }
  }
  return out;
}

const DAY_MS = 86_400_000;

/** Whether a question may be asked now, given what happened to it before. `today`: the start of the current Today-day. */
export function mayAsk(state: PromptState | undefined, now: Date, today: Date): boolean {
  if (!state) return true;
  if (state.answer === 'dismissed' && state.answeredAt && now.getTime() - Date.parse(state.answeredAt) < TAILORING.prompts.afterKeepDays * DAY_MS) return false;
  if (state.answeredAt && state.lastShownAt && Date.parse(state.answeredAt) >= Date.parse(state.lastShownAt) && now.getTime() - Date.parse(state.answeredAt) < TAILORING.prompts.repeatDays * DAY_MS) return false;
  if (!state.lastShownAt) return true;
  const shown = Date.parse(state.lastShownAt);
  // Shown earlier today: still today's prompt until answered.
  if (shown >= today.getTime()) return !(state.answeredAt && Date.parse(state.answeredAt) >= shown);
  return now.getTime() - shown >= TAILORING.prompts.repeatDays * DAY_MS;
}

/** The one prompt for this visit, or null. */
export function promptToShow(p: TailoringProfile | null | undefined, states: readonly PromptState[], now: Date, today: Date): Prompt | null {
  if (!p) return null;
  const byQuestion = new Map(states.map((s) => [s.question, s]));
  return promptsFor(p).find((x) => mayAsk(byQuestion.get(x.question), now, today)) ?? null;
}
