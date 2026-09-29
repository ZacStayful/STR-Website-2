/**
 * The photo check's usage, hop by hop, and its cost (Batch 17): the requested
 * model's attempt and, after a refusal, the fallback that answered, each
 * metered at its own model's unit_costs rows. A model without rows of its
 * own is metered at Opus 4.8's, the dearest, so spend is never
 * under-counted.
 *
 * Pure: no network, no database, no server-only.
 */
import { UNIT_COST_SEED } from '../credit/costs.ts';

export const PHOTO_CHECK_MODEL = 'claude-opus-5-5';

export interface PhotoCheckUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** The API's usage object, as far as the metering reads it. */
export type UsageLike = { input_tokens?: number; output_tokens?: number; iterations?: { type?: string; model?: string; input_tokens?: number; output_tokens?: number }[] | null };

/** Each model's token rows in unit_costs. */
export function unitsFor(model: string): { input: string; output: string } {
  if (model.startsWith('claude-opus-5-5')) return { input: 'opus55_input_token', output: 'opus55_output_token' };
  if (model.startsWith('claude-sonnet-5-5')) return { input: 'sonnet55_input_token', output: 'sonnet55_output_token' };
  return { input: 'input_token', output: 'output_token' };
}

/** Each hop's tokens, at the model that ran it: the requested model's attempt, then any fallback. */
export function hopsOf(usage: UsageLike | undefined, requested: string, answered: string): PhotoCheckUsage[] {
  const iterations = usage?.iterations ?? null;
  if (iterations && iterations.length > 0) {
    return iterations.map((it) => ({ model: it.type === 'fallback_message' && it.model ? String(it.model) : requested, inputTokens: it.input_tokens ?? 0, outputTokens: it.output_tokens ?? 0 }));
  }
  return [{ model: answered || requested, inputTokens: usage?.input_tokens ?? 0, outputTokens: usage?.output_tokens ?? 0 }];
}

const SEED_PENCE = new Map(UNIT_COST_SEED.map((r) => [`${r.provider}:${r.unit}`, r.unitCostPence]));

/** Our raw cost of these hops, pence, at the seed rates (the admin spend line reads the metered rows). */
export function photoCheckCostPence(usage: readonly PhotoCheckUsage[]): number {
  let pence = 0;
  for (const u of usage) {
    const units = unitsFor(u.model);
    pence += u.inputTokens * (SEED_PENCE.get(`anthropic:${units.input}`) ?? 0) + u.outputTokens * (SEED_PENCE.get(`anthropic:${units.output}`) ?? 0);
  }
  return Math.round(pence * 100) / 100;
}
