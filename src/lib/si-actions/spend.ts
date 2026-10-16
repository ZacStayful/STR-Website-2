/**
 * Batch 27: what an instruction will spend, and whether the eye asks first.
 *
 * Zac (29 Sep): the eye does what it's told without asking, except
 *   - when the action charges would leave the balance under the low-credit
 *     line (Batch 20's low_credit_pence, £5): one confirm card with the
 *     total, the balance after and the top-up button. Not when auto top-up
 *     is on: that covers it.
 *   - when one instruction would spend more than the cap
 *     (si_action_instruction_cap_pence, £20) in action charges: it does up
 *     to the cap, then one confirm card for the rest.
 *   - when there isn't enough credit for what it would run now: nothing
 *     runs, and the pack / top-up offer shows.
 * The AI's own line (Batch 26's question charge) is never part of these: it
 * is charged by the chat whatever the actions do.
 *
 * Every price here is the step's own quote: exactly what its button would
 * charge this member now (base pence, and face pence: what comes off the
 * balance after the grants' spend rates). The cap and the £5 line are about
 * what the member sees (face); whether they can pay is about spendable base
 * pence, the same test the buttons' own code makes.
 *
 * Pure: no network, no database, no server-only.
 */
import { formatPence } from '../credit/deal-pricing.ts';
import type { StepKind } from './config.ts';

/** One charged step, priced, in the order it would run. */
export interface PricedStep {
  /** Its place in the instruction's steps. */
  index: number;
  kind: StepKind;
  basePence: number;
  facePence: number;
  /** The deal isn't open to the team yet: the price includes opening it (its ladder price). */
  opensDeal: boolean;
  /** A deep search: the price is its "up to"; `aboutFacePence` is the likely one. */
  aboutFacePence?: number | null;
}

export interface SpendInput {
  steps: readonly PricedStep[];
  spendableBasePence: number;
  /** What the header shows (every kind of credit, face pence). */
  balanceFacePence: number;
  capFacePence: number;
  lowCreditPence: number;
  autoTopupOn: boolean;
  /** Admins are never charged and never asked. */
  admin: boolean;
}

export type SpendDecision =
  | { kind: 'free' }
  /** Run `now` after the Stop countdown; `later` (past the cap) gets one confirm once `now` is done. */
  | { kind: 'run'; now: number[]; later: number[]; nowFacePence: number; nowBasePence: number; laterFacePence: number; balanceAfterFacePence: number }
  /** Ask first: the balance would end under the low-credit line, or even the first step is past the cap. */
  | { kind: 'confirm'; reason: 'low_balance' | 'over_cap'; now: number[]; later: number[]; nowFacePence: number; nowBasePence: number; laterFacePence: number; balanceAfterFacePence: number }
  | { kind: 'insufficient'; requiredBasePence: number; availableBasePence: number; requiredFacePence: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Splits the steps at the cap (in order: a later, cheaper step never jumps the queue). */
export function splitAtCap(steps: readonly PricedStep[], capFacePence: number): { now: PricedStep[]; later: PricedStep[] } {
  const now: PricedStep[] = [];
  const later: PricedStep[] = [];
  let total = 0;
  for (const s of steps) {
    if (later.length === 0 && total + s.facePence <= capFacePence + 0.005) {
      now.push(s);
      total += s.facePence;
    } else later.push(s);
  }
  return { now, later };
}

export function decideSpend(input: SpendInput): SpendDecision {
  if (input.steps.length === 0) return { kind: 'free' };
  const sum = (list: readonly PricedStep[], k: 'basePence' | 'facePence') => round2(list.reduce((a, s) => a + s[k], 0));
  if (input.admin) {
    const all = input.steps.map((s) => s.index);
    return { kind: 'run', now: all, later: [], nowFacePence: 0, nowBasePence: 0, laterFacePence: 0, balanceAfterFacePence: input.balanceFacePence };
  }
  const { now, later } = splitAtCap(input.steps, input.capFacePence);
  const nowBase = sum(now, 'basePence');
  const nowFace = sum(now, 'facePence');
  const laterFace = sum(later, 'facePence');
  // Even the first step is past the cap: nothing runs until the member says yes.
  if (now.length === 0) {
    const first = sum(later, 'basePence');
    if (first > input.spendableBasePence + 0.005) return { kind: 'insufficient', requiredBasePence: first, availableBasePence: Math.max(0, input.spendableBasePence), requiredFacePence: laterFace };
    return { kind: 'confirm', reason: 'over_cap', now: [], later: later.map((s) => s.index), nowFacePence: 0, nowBasePence: 0, laterFacePence: laterFace, balanceAfterFacePence: round2(input.balanceFacePence - laterFace) };
  }
  if (nowBase > input.spendableBasePence + 0.005) return { kind: 'insufficient', requiredBasePence: nowBase, availableBasePence: Math.max(0, input.spendableBasePence), requiredFacePence: nowFace };
  const after = round2(input.balanceFacePence - nowFace);
  const base = { now: now.map((s) => s.index), later: later.map((s) => s.index), nowFacePence: nowFace, nowBasePence: nowBase, laterFacePence: laterFace, balanceAfterFacePence: after };
  if (!input.autoTopupOn && after < input.lowCreditPence) return { kind: 'confirm', reason: 'low_balance', ...base };
  return { kind: 'run', ...base };
}

/**
 * The rest past the cap, when the member is asked about it: affordable now,
 * and the balance it would leave. Asked as one confirm whatever the balance
 * (the card says the balance after), refused when it can't be paid.
 */
export function laterCheck(input: { steps: readonly PricedStep[]; spendableBasePence: number; balanceFacePence: number }): { ok: true; facePence: number; balanceAfterFacePence: number } | { ok: false; requiredBasePence: number; availableBasePence: number } {
  const base = round2(input.steps.reduce((a, s) => a + s.basePence, 0));
  const face = round2(input.steps.reduce((a, s) => a + s.facePence, 0));
  if (base > input.spendableBasePence + 0.005) return { ok: false, requiredBasePence: base, availableBasePence: Math.max(0, input.spendableBasePence) };
  return { ok: true, facePence: face, balanceAfterFacePence: round2(input.balanceFacePence - face) };
}

const COUNT_WORDS: Record<string, [string, string]> = {
  full_analysis: ['a full analysis', 'full analyses'],
  deep_report: ['a Deep report', 'Deep reports'],
  deep_search: ['a deep search', 'deep searches'],
  check_link: ['a listing check', 'listing checks'],
  btl_report: ['a buy-to-let report', 'buy-to-let reports'],
};

/** "3 full analyses and a deep search", in the order the kinds first appear. */
export function describeSteps(steps: readonly Pick<PricedStep, 'kind'>[]): string {
  const counts = new Map<string, number>();
  for (const s of steps) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  const parts = [...counts.entries()].map(([kind, n]) => {
    const words = COUNT_WORDS[kind] ?? [kind, kind];
    return n === 1 ? words[0] : `${n} ${words[1]}`;
  });
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The spend line (Zac, decision 3): one line before anything charged runs,
 * the same line in the chat history. "Running 3 full analyses — £12",
 * "Running a deep search — about £4.20, up to £7.50", with the opens it
 * includes named.
 */
export function spendLine(steps: readonly PricedStep[]): string {
  if (steps.length === 0) return '';
  const face = steps.reduce((a, s) => a + s.facePence, 0);
  const search = steps.find((s) => s.kind === 'deep_search');
  const opens = steps.filter((s) => s.opensDeal).length;
  const linksOnly = steps.every((s) => s.kind === 'check_link');
  const verb = linksOnly ? 'Checking' : 'Running';
  const what = linksOnly ? (steps.length === 1 ? 'the listing' : `${steps.length} listings`) : describeSteps(steps);
  let money: string;
  if (search) {
    const about = steps.reduce((a, s) => a + (s.kind === 'deep_search' ? (s.aboutFacePence ?? s.facePence) : s.facePence), 0);
    money = Math.abs(about - face) < 0.5 ? formatPence(face) : `about ${formatPence(about)}, up to ${formatPence(face)}`;
  } else money = formatPence(face);
  const openNote = opens > 0 ? ` (with opening ${opens === 1 ? '1 deal' : `${opens} deals`})` : '';
  return `${verb} ${what}${openNote} — ${money}`;
}
