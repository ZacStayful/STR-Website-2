/**
 * Batch 26: what a question may cost and what it did cost.
 *
 * A question is charged its actual tokens × markup, once, through the meter
 * (src/lib/chat/turns-server.ts). These rules make sure that charge can never
 * pass the question's ceiling or the member's balance: the hold is the budget,
 * and every model round's max_tokens is set so its worst case fits what is
 * left of it. So nothing is ever capped after the fact.
 *
 * Pure: prices come from the live unit-cost table the caller passes in.
 */
import { priceFor, round4 } from '../credit/pricing.ts';
import type { UnitCostTable } from '../credit/costs.ts';
import { CHARS_PER_TOKEN, MIN_ROUND_OUTPUT_TOKENS, type ModelUnits } from './config.ts';

export const PROVIDER = 'anthropic';

/** Base pence kept back from every round for the meter's per-line rounding (≤ 0.0003p a line). */
export const ROUNDING_MARGIN = 0.01;

/** One model call's token usage, as the API reports it. input excludes cache reads and writes. */
export interface RoundUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const NO_USAGE: RoundUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** The SDK's usage object → RoundUsage (missing or bad fields count as 0). */
export function usageOf(u: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | null | undefined): RoundUsage {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  return { input: n(u?.input_tokens), output: n(u?.output_tokens), cacheRead: n(u?.cache_read_input_tokens), cacheWrite: n(u?.cache_creation_input_tokens) };
}

export function addUsage(a: RoundUsage, b: RoundUsage): RoundUsage {
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite };
}

/** Estimated tokens for prompt text not yet sent. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * The hold for one question: the ceiling, or the member's spendable balance
 * (less a hundredth of a penny for per-grant rounding) when that is lower.
 * Null when the balance is under the floor: "Top up to ask me more".
 * An admin is never charged; the ceiling still sizes the answer.
 */
export function budgetFor(p: { ceilingPence: number; floorPence: number; spendableBasePence: number; admin: boolean }): number | null {
  if (p.admin) return p.ceilingPence;
  const spendable = Number.isFinite(p.spendableBasePence) ? p.spendableBasePence : 0;
  if (spendable < p.floorPence || spendable <= 0) return null;
  const budget = round4(Math.min(p.ceilingPence, spendable - 0.01));
  return budget > 0 ? budget : null;
}

/** One meter line: what one token type of one round costs. */
export interface ChargeLine {
  unit: string;
  quantity: number;
  rawPence: number;
  basePence: number;
}

/** A round's usage as the meter will price it, line by line (zero lines left out). */
export function chargeLines(table: UnitCostTable, units: ModelUnits, usage: RoundUsage, markup: number): ChargeLine[] {
  const pairs: [string, number][] = [
    [units.output, usage.output],
    [units.input, usage.input],
    [units.cacheRead, usage.cacheRead],
    [units.cacheWrite, usage.cacheWrite],
  ];
  const out: ChargeLine[] = [];
  for (const [unit, quantity] of pairs) {
    if (quantity <= 0) continue;
    const p = priceFor(table, PROVIDER, unit, quantity, markup);
    out.push({ unit, quantity, rawPence: p.rawPence, basePence: p.basePence });
  }
  return out;
}

/** What the rounds cost us (raw) and the member (base), exactly as the meter will charge them. */
export function costOf(table: UnitCostTable, units: ModelUnits, rounds: readonly RoundUsage[], markup: number): { rawPence: number; basePence: number } {
  let raw = 0;
  let base = 0;
  for (const r of rounds) {
    for (const l of chargeLines(table, units, r, markup)) {
      raw += l.rawPence;
      base += l.basePence;
    }
  }
  return { rawPence: round4(raw), basePence: round4(base) };
}

/**
 * The most output tokens the next round may ask for, so its expected worst
 * case still fits the budget: the part of the prompt the last round already
 * sent (cachedTokens) at the cache-read price, everything new at the dearer
 * of input and cache write, and every output token at the output price. 0
 * when even MIN_ROUND_OUTPUT_TOKENS would not fit: the answer stops there.
 * (If the cache were somehow missed, settle() still caps the charge at the
 * budget, so a question can never cost more than its hold.)
 */
export function roundMaxTokens(p: { table: UnitCostTable; units: ModelUnits; markup: number; budgetPence: number; spentPence: number; promptTokens: number; cachedTokens?: number; cap: number }): number {
  // Per token, unrounded (priceFor rounds a line to 4dp, which would swamp a single token).
  const each = (u: string) => {
    const pr = priceFor(p.table, PROVIDER, u, 1, p.markup);
    return pr.found ? pr.unitCostPence * pr.markup : 0;
  };
  const inputEach = Math.max(each(p.units.input), each(p.units.cacheWrite));
  const readEach = each(p.units.cacheRead) || inputEach;
  const outputBase = each(p.units.output);
  // Without an output price the cost can't be bounded: don't run.
  if (!(outputBase > 0)) return 0;
  const prompt = Math.max(0, p.promptTokens);
  const cached = Math.min(prompt, Math.max(0, p.cachedTokens ?? 0));
  // ROUNDING_MARGIN covers the meter's 4dp rounding of each line, so the sum stays inside the budget.
  const left = p.budgetPence - p.spentPence - cached * readEach - (prompt - cached) * inputEach - ROUNDING_MARGIN;
  if (!(left > 0)) return 0;
  const tokens = Math.floor(left / outputBase);
  if (tokens < MIN_ROUND_OUTPUT_TOKENS) return 0;
  return Math.min(p.cap, tokens);
}

/** Every unit a surface is metered at has a price: without one a question can't be bounded, so it isn't asked. */
export function unitsPriced(table: UnitCostTable, units: ModelUnits): boolean {
  return [units.input, units.output, units.cacheRead, units.cacheWrite].every((u) => table.has(`${PROVIDER}:${u}`));
}

/** Every prompt token a round actually sent (uncached, read and written): what the next round finds in the cache. */
export function promptTokensOf(u: RoundUsage): number {
  return u.input + u.cacheRead + u.cacheWrite;
}

/**
 * Whether a round may look something up: only if, after its own worst case
 * and a full tool result, the round after it could still afford a short
 * final answer. Otherwise it answers now, so a look-up never leaves a member
 * near their floor with "I don't know".
 */
export function affordsLookUp(p: { table: UnitCostTable; units: ModelUnits; markup: number; budgetPence: number; spentPence: number; promptTokens: number; cachedTokens: number; room: number; resultTokens: number; finalTokens: number }): boolean {
  const each = (u: string) => {
    const pr = priceFor(p.table, PROVIDER, u, 1, p.markup);
    return pr.found ? pr.unitCostPence * pr.markup : 0;
  };
  const inputEach = Math.max(each(p.units.input), each(p.units.cacheWrite));
  const readEach = each(p.units.cacheRead) || inputEach;
  const cached = Math.min(p.promptTokens, p.cachedTokens);
  const worstThisRound = cached * readEach + (p.promptTokens - cached) * inputEach + p.room * each(p.units.output);
  const next = roundMaxTokens({ table: p.table, units: p.units, markup: p.markup, budgetPence: p.budgetPence, spentPence: p.spentPence + worstThisRound, promptTokens: p.promptTokens + p.room + p.resultTokens, cachedTokens: p.promptTokens, cap: p.finalTokens });
  return next >= p.finalTokens;
}
