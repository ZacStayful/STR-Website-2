/**
 * Part B: when what a member does says something different from what they
 * answered. "I've noticed you've kept 9 houses, but you said flats only.
 * Want me to include houses?"
 *
 * Batch 25, Part D: "I've noticed" — first person, and on Passes as well as
 * Keeps. Every answer counts: the member's Keeps (never a Keep Stayful
 * Intelligence made for them) and Passes, per profile, in the signal window
 * (60 days). Passes are read separately (src/lib/tailoring/server.ts
 * promptPassesFor) and used here only: they never join the profile's
 * signals, so nothing else (ordering, the type mix) leans on them silently.
 *
 * A prompt is asked only when the profile has at least
 * TAILORING.prompts.minAnswers answers in all, and the answers it is about
 * (its group) number at least minGroup with at least minAgreePct% of them
 * agreeing:
 *
 *   on Keeps (the group's Keeps agree)
 *     type        said flats (or houses); the other kind's answers kept
 *     bedrooms    said N bedrooms; other sizes' answers kept (the size kept most)
 *     location    a must-have where; answers outside it kept
 *     budget      a must-have budget; answers outside it kept
 *     kind        a deal type the profile doesn't show; its answers kept
 *   on Passes (the group's Passes agree)
 *     kind_drop   a deal type it shows; its answers passed, while another
 *                 shown type has Keeps ("kept 6 rent-to-rent deals and passed
 *                 every BRRR one"). Never offered when it would leave none.
 *     budget_band its budget band; answers in or above the band passed, while
 *                 something below was kept: the next band down
 *     max_rent    answers above a rent passed, at or below it mostly kept:
 *                 that rent (rounded up to £50) as the maximum
 *     type_pass   said either; flats (or houses) passed, the other kept: the
 *                 other only
 *     location_pass  where is a nice-to-have; answers outside it passed,
 *                 inside kept: make it a must-have
 *
 * Accepting changes the answer (type, bedrooms, the types, the budget, the
 * maximum rent) or how much an answer counts (location, budget). Nothing
 * changes until the member taps (acceptPromptAction works it out again).
 *
 * Asking: one prompt a visit, the first that applies. A question shown on an
 * earlier day is not asked again for a week; one the member answered "keep
 * my answer" to is not asked again for 30 days. Shown today: still shown
 * until answered, so a reload does not lose it.
 *
 * Pure: no network, no database, no server-only.
 */
import type { MarketGoals } from '../market/goals.ts';
import { BUDGET_CHOICES, BUDGET_LABELS } from '../market/filters.ts';
import { budgetBounds } from '../listing/sourcing.ts';
import { DEAL_TYPES, DEAL_TYPE_LABELS, availableTypes, kindsFor, typesShown, withAddedType, type DealType } from '../profile/deal-types.ts';
import { TAILORING } from './config.ts';
import { wantsFor } from './criteria.ts';
import { asked, type CriterionKey, type Mode, type Signal, type TailoringProfile } from './profile.ts';

export const PROMPT_QUESTIONS = ['type', 'bedrooms', 'location', 'budget', 'kind', 'kind_drop', 'budget_band', 'max_rent', 'type_pass', 'location_pass'] as const;
export type PromptQuestion = (typeof PROMPT_QUESTIONS)[number];

export function isPromptQuestion(v: unknown): v is PromptQuestion {
  return typeof v === 'string' && (PROMPT_QUESTIONS as readonly string[]).includes(v);
}

/** What accepting a prompt does. */
export type PromptChange = { kind: 'goals'; goals: MarketGoals } | { kind: 'mode'; criterion: CriterionKey; to: Mode };

export interface Prompt {
  question: PromptQuestion;
  /** How many answers agree. */
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

/** A Pass, for the prompts only (a Signal's facts; never one of the profile's signals). */
export type PassAnswer = Omit<Signal, 'source'>;

/** The second button, always. */
export const KEEP_MY_ANSWER = 'Keep my answer';

const PLURAL = { flat: 'flats', house: 'houses' } as const;
/** "4 BRRR projects". */
const TYPE_PLURAL: Record<DealType, string> = { buy_str: 'short-let deals', brrr: 'BRRR projects', r2r: 'rent-to-rent deals', btl: 'buy-to-let deals' };
const bedWord = (n: number) => (n >= 4 ? '4+ bed' : `${n}-bed`);
const bedAnswer = (n: number) => (n >= 4 ? '4 or more bedrooms' : `${n} bed`);
const thousands = (n: number) => n.toLocaleString('en-GB');
const money = (n: number) => (n >= 1_000_000 ? `£${thousands(n / 1_000_000)}m` : n >= 10_000 ? `£${thousands(Math.round(n / 1_000))}k` : `£${thousands(n)}`);

type Answer = PassAnswer & { verdict: 'keep' | 'pass' };

/** Whether a group of answers is big enough and agrees enough to ask about. */
export function agrees(group: readonly Answer[], verdict: 'keep' | 'pass'): { n: number; agreeing: number; all: boolean } | null {
  const n = group.length;
  const agreeing = group.filter((a) => a.verdict === verdict).length;
  if (n < TAILORING.prompts.minGroup || agreeing * 100 < TAILORING.prompts.minAgreePct * n) return null;
  return { n, agreeing, all: agreeing === n };
}

const typeOf = (a: Pick<Answer, 'dealType' | 'kind'>): DealType => a.dealType ?? (a.kind === 'rent' ? 'r2r' : 'buy_str');

/** Round up to £50: a maximum rent the member would recognise, that still takes the rent it came from. */
export function roundUpToFifty(pcm: number): number {
  return Math.ceil(pcm / 50) * 50;
}

/** The budget band one step below this one, or null at the bottom (the legacy "under £200k" steps to "under £100k"). */
export function bandBelow(band: Exclude<MarketGoals['budget'], null>): Exclude<MarketGoals['budget'], null> | null {
  if (band === 'u200') return 'u100';
  const i = (BUDGET_CHOICES as readonly string[]).indexOf(band);
  return i > 0 ? BUDGET_CHOICES[i - 1] : null;
}

/** Every prompt this profile's answers call for, in the order they are asked. `passes`: the profile's Passes in the window. */
export function promptsFor(p: TailoringProfile, passes: readonly PassAnswer[] = []): Prompt[] {
  const g = p.goals;
  if (!g) return [];
  const keeps: Answer[] = p.signals.filter((s) => s.source === 'keep').map((s) => ({ dealId: s.dealId, at: s.at, kind: s.kind, propertyKind: s.propertyKind, bedrooms: s.bedrooms, area: s.area, amount: s.amount, dealType: s.dealType, verdict: 'keep' as const }));
  const answers: Answer[] = [...keeps, ...passes.map((x) => ({ ...x, verdict: 'pass' as const }))];
  if (answers.length < TAILORING.prompts.minAnswers) return [];
  const wants = wantsFor(p);
  const modeOf = (key: CriterionKey) => p.modes[key] ?? 'must';
  const sales = answers.filter((a) => a.kind === 'sale');
  const out: Prompt[] = [];
  /** "every flat" when all of them agree, "most flats" at 80–99%. */
  const share = (all: boolean, one: string, many: string) => (all ? `every ${one}` : `most ${many}`);

  // ── On Keeps ──

  if (wants.propertyType) {
    const want = wants.propertyType;
    const other = want === 'flat' ? 'house' : 'flat';
    const a = agrees(sales.filter((s) => s.propertyKind === other), 'keep');
    if (a) out.push({ question: 'type', count: a.agreeing, text: `I’ve noticed you’ve kept ${a.agreeing} ${PLURAL[other]}, but you said ${PLURAL[want]} only. Want me to include ${PLURAL[other]}?`, accept: `Include ${PLURAL[other]}`, keep: KEEP_MY_ANSWER, change: { kind: 'goals', goals: { ...g, buyer: { ...g.buyer, propertyType: 'either' } } } });
  }

  if (g.bedrooms !== null) {
    const want = g.bedrooms;
    const others = answers.filter((s) => s.bedrooms !== null && Math.min(4, s.bedrooms) !== want);
    const a = agrees(others, 'keep');
    if (a) {
      const counts = new Map<number, number>();
      for (const s of others) if (s.verdict === 'keep') counts.set(Math.min(4, s.bedrooms!), (counts.get(Math.min(4, s.bedrooms!)) ?? 0) + 1);
      // The size they keep most, the smaller on a tie.
      const [size] = [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0];
      const bedrooms = size as 1 | 2 | 3 | 4;
      out.push({ question: 'bedrooms', count: a.agreeing, text: `I’ve noticed you’ve kept ${a.agreeing} deals that aren’t ${bedWord(want)}, most of them ${bedWord(size)}. Want me to switch to ${bedAnswer(size)}?`, accept: `Switch to ${bedAnswer(size)}`, keep: KEEP_MY_ANSWER, change: { kind: 'goals', goals: { ...g, bedrooms } } });
    }
  }

  if (wants.areas && modeOf('location') === 'must') {
    const a = agrees(answers.filter((s) => s.area !== null && !wants.areas!.has(s.area)), 'keep');
    if (a) out.push({ question: 'location', count: a.agreeing, text: `I’ve noticed you’ve kept ${a.agreeing} deals outside where you look. Want me to show deals from further afield too?`, accept: 'Make location a nice-to-have', keep: KEEP_MY_ANSWER, change: { kind: 'mode', criterion: 'location', to: 'nice' } });
  }

  if (wants.budget && modeOf('budget') === 'must') {
    const b = wants.budget;
    const a = agrees(sales.filter((s) => typeOf(s) !== 'brrr' && s.amount !== null && ((b.min !== null && s.amount < b.min) || (b.max !== null && s.amount > b.max))), 'keep');
    if (a) out.push({ question: 'budget', count: a.agreeing, text: `I’ve noticed you’ve kept ${a.agreeing} deals outside your budget. Want me to show deals outside it too?`, accept: 'Make budget a nice-to-have', keep: KEEP_MY_ANSWER, change: { kind: 'mode', criterion: 'budget', to: 'nice' } });
  }

  // Batch 17: a deal type they keep that the profile does not show; accepting adds the one kept most.
  const shown = typesShown({ goals: g, about: p.about });
  const unshown = DEAL_TYPES.filter((t) => !shown.includes(t))
    .map((t) => ({ t, a: agrees(answers.filter((s) => typeOf(s) === t), 'keep') }))
    .filter((x): x is { t: DealType; a: NonNullable<ReturnType<typeof agrees>> } => x.a !== null)
    .sort((x, y) => y.a.agreeing - x.a.agreeing || DEAL_TYPES.indexOf(x.t) - DEAL_TYPES.indexOf(y.t));
  if (unshown[0]) {
    const { t: type, a } = unshown[0];
    const next = withAddedType({ goals: g, about: p.about }, type);
    if (next) out.push({ question: 'kind', count: a.agreeing, text: `I’ve noticed you’ve kept ${a.agreeing} ${TYPE_PLURAL[type]}, but this profile doesn’t show them. Want me to show ${DEAL_TYPE_LABELS[type]} too?`, accept: `Show ${DEAL_TYPE_LABELS[type]} too`, keep: KEEP_MY_ANSWER, change: { kind: 'goals', goals: next } });
  }

  // ── On Passes ──

  // A deal type it shows, passed, while another shown type is kept: stop showing it (never the last one).
  const chosen = availableTypes(shown);
  if (chosen.length >= 2) {
    const drops = chosen
      .map((t) => ({ t, a: agrees(answers.filter((s) => typeOf(s) === t), 'pass') }))
      .filter((x): x is { t: DealType; a: NonNullable<ReturnType<typeof agrees>> } => x.a !== null)
      .sort((x, y) => y.a.agreeing - x.a.agreeing || DEAL_TYPES.indexOf(x.t) - DEAL_TYPES.indexOf(y.t));
    for (const { t, a } of drops) {
      const rest = chosen.filter((x) => x !== t);
      const kept = rest.map((x) => ({ x, n: keeps.filter((s) => typeOf(s) === x).length })).sort((u, v) => v.n - u.n)[0];
      if (!kept || kept.n === 0 || rest.length === 0) continue;
      out.push({
        question: 'kind_drop',
        count: a.agreeing,
        text: `I’ve noticed you’ve kept ${kept.n} ${TYPE_PLURAL[kept.x]} and passed ${share(a.all, `${DEAL_TYPE_LABELS[t]} one`, `${DEAL_TYPE_LABELS[t]} ones`)}. Want me to stop showing ${DEAL_TYPE_LABELS[t]}?`,
        accept: `Stop showing ${DEAL_TYPE_LABELS[t]}`,
        keep: KEEP_MY_ANSWER,
        change: { kind: 'goals', goals: { ...g, dealTypes: rest, sourcingKind: kindsFor(rest) } },
      });
      break;
    }
  }

  // The budget band: deals in or above it passed, something below it kept → the next band down.
  if (g.budget) {
    const lower = bandBelow(g.budget);
    const floor = lower ? budgetBounds(lower).max : null;
    if (lower && floor !== null) {
      const priced = sales.filter((s) => typeOf(s) !== 'brrr' && s.amount !== null);
      const a = agrees(priced.filter((s) => s.amount! >= floor), 'pass');
      if (a && priced.some((s) => s.amount! < floor && s.verdict === 'keep')) {
        out.push({ question: 'budget_band', count: a.agreeing, text: `I’ve noticed you pass on ${share(a.all, 'deal', 'deals')} over ${money(floor)}. Want me to change your budget to ${BUDGET_LABELS[lower].replace(/^Under/, 'under')}?`, accept: 'Change my budget', keep: KEEP_MY_ANSWER, change: { kind: 'goals', goals: { ...g, budget: lower } } });
      }
    }
  }

  // Rent: places above a rent passed, at or below it mostly kept → that rent as the maximum.
  const rents = answers.filter((s) => s.kind === 'rent' && s.amount !== null);
  if (rents.length > 0) {
    const steps = [...new Set(rents.map((s) => roundUpToFifty(s.amount!)))].filter((x) => x > 0 && (wants.rentMax === null || x < wants.rentMax)).sort((x, y) => x - y);
    for (const cap of steps) {
      const a = agrees(rents.filter((s) => s.amount! > cap), 'pass');
      const under = rents.filter((s) => s.amount! <= cap);
      const keptUnder = under.filter((s) => s.verdict === 'keep').length;
      if (!a || keptUnder === 0 || keptUnder * 2 < under.length) continue;
      out.push({ question: 'max_rent', count: a.agreeing, text: `I’ve noticed you pass on ${share(a.all, 'place', 'places')} over ${money(cap)} a month. Want me to lower your maximum rent to ${money(cap)}?`, accept: 'Lower it', keep: KEEP_MY_ANSWER, change: { kind: 'goals', goals: { ...g, maxRentPcm: cap } } });
      break;
    }
  }

  // Flat or house, when they said either: one passed, the other kept → the other only.
  if (asked(p, 'property_type') && wants.propertyType === null) {
    for (const passed of ['flat', 'house'] as const) {
      const other = passed === 'flat' ? 'house' : 'flat';
      const a = agrees(sales.filter((s) => s.propertyKind === passed), 'pass');
      if (!a || !sales.some((s) => s.propertyKind === other && s.verdict === 'keep')) continue;
      out.push({ question: 'type_pass', count: a.agreeing, text: `I’ve noticed you pass on ${share(a.all, passed, PLURAL[passed])}. Want me to show ${PLURAL[other]} only?`, accept: `${other === 'house' ? 'Houses' : 'Flats'} only`, keep: KEEP_MY_ANSWER, change: { kind: 'goals', goals: { ...g, buyer: { ...g.buyer, propertyType: other } } } });
      break;
    }
  }

  // Where they look is a nice-to-have: outside passed, inside kept → a must-have.
  if (wants.areas && p.modes.location === 'nice') {
    const a = agrees(answers.filter((s) => s.area !== null && !wants.areas!.has(s.area)), 'pass');
    if (a && answers.some((s) => s.area !== null && wants.areas!.has(s.area) && s.verdict === 'keep')) {
      out.push({ question: 'location_pass', count: a.agreeing, text: `I’ve noticed you pass on ${share(a.all, 'deal', 'deals')} outside your areas. Want me to show only deals inside them?`, accept: 'Only my areas', keep: KEEP_MY_ANSWER, change: { kind: 'mode', criterion: 'location', to: 'must' } });
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
export function promptToShow(p: TailoringProfile | null | undefined, states: readonly PromptState[], now: Date, today: Date, passes: readonly PassAnswer[] = []): Prompt | null {
  if (!p) return null;
  const byQuestion = new Map(states.map((s) => [s.question, s]));
  return promptsFor(p, passes).find((x) => mayAsk(byQuestion.get(x.question), now, today)) ?? null;
}
