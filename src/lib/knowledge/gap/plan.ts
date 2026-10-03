/**
 * Batch 24: the nightly gap job's arithmetic and choices: what each model
 * call may cost at worst, what it did cost, whether it fits the month's cap,
 * which gaps to draft, and the text the drafting model is given.
 *
 * Pure: no network, no database, no server-only.
 */
import { GAP_DRAFT_MODEL, GAP_GROUP_MODEL } from '../config.ts';
import { slugFrom } from '../forms.ts';
import { PLACEHOLDERS, type GlobalSnapshot } from '../placeholders.ts';
import type { LiveEntry } from '../render.ts';

/** The unit rows (src/lib/credit/costs.ts) each model's tokens are metered at. */
export interface ModelUnits {
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
}

export const MODEL_UNITS: Readonly<Record<string, ModelUnits>> = {
  [GAP_GROUP_MODEL]: { input: 'haiku45_input_token', output: 'haiku45_output_token', cacheRead: 'haiku45_cache_read_token', cacheWrite: 'haiku45_cache_write_token' },
  [GAP_DRAFT_MODEL]: { input: 'sonnet55_input_token', output: 'sonnet55_output_token', cacheRead: 'sonnet55_cache_read_token', cacheWrite: 'sonnet55_cache_write_token' },
};

/** A cautious token count for a budget check: 3 characters a token (English runs nearer 4), rounded up. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3);

/** Raw pence per unit (house spend: the provider's price, no markup). */
export type UnitPence = (unit: string) => number;

/** The most a call can cost: every input token at the dearer of input and cache-write, plus every output token. */
export function worstCasePence(units: ModelUnits, inputTokens: number, maxOutputTokens: number, price: UnitPence): number {
  return inputTokens * Math.max(price(units.input), price(units.cacheWrite)) + maxOutputTokens * price(units.output);
}

export interface Usage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** What a call cost, from the usage the API reported. */
export function usagePence(units: ModelUnits, u: Usage, price: UnitPence): number {
  return (u.input_tokens ?? 0) * price(units.input) + (u.output_tokens ?? 0) * price(units.output) + (u.cache_read_input_tokens ?? 0) * price(units.cacheRead) + (u.cache_creation_input_tokens ?? 0) * price(units.cacheWrite);
}

/** Room under the month's cap for a call that may cost `worst`. A cap of 0 switches the job's model calls off. */
export function fitsCap(spentPence: number, worstPence: number, capPence: number): boolean {
  return capPence > 0 && spentPence + worstPence <= capPence;
}

export interface GapRow {
  id: string;
  label: string;
  status: 'open' | 'drafted' | 'covered' | 'rejected' | 'dismissed' | 'failed';
  entry_id: string | null;
  asked: number;
  draft_attempts: number;
  last_asked_at: string | null;
}

/** A gap is drafted at most twice (a model refusal or a bad reply twice and it is left for Zac). */
export const MAX_DRAFT_ATTEMPTS = 2;

/** The open gaps without an answer, most asked first, at most `max`. */
export function draftCandidates(gaps: readonly GapRow[], max: number): GapRow[] {
  return gaps
    .filter((g) => g.status === 'open' && !g.entry_id && g.draft_attempts < MAX_DRAFT_ATTEMPTS)
    .sort((a, b) => b.asked - a.asked || (b.last_asked_at ?? '').localeCompare(a.last_asked_at ?? ''))
    .slice(0, Math.max(0, max));
}

/** The approved knowledge as the drafting model sees it: templates, so it learns the placeholders in use. */
export function knowledgeForDrafting(entries: readonly LiveEntry[]): string {
  return [...entries]
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((e) => `[${e.slug}] ${e.question} → ${e.answer}`)
    .join('\n');
}

/** The placeholders a drafted answer may use (global only: a draft goes to calls and the chat), with their values now. */
export function catalogueForDrafting(g: GlobalSnapshot): string {
  return Object.entries(PLACEHOLDERS)
    .filter(([, d]) => d.scope === 'global')
    .map(([name, d]) => `{${name}}: ${d.label} (now: ${d.resolve(g, null) ?? 'not available — do not use'})`)
    .join('\n');
}

/** A slug for a drafted entry, unique among those taken. */
export function uniqueSlug(label: string, taken: ReadonlySet<string>): string {
  const base = (slugFrom(label) ?? 'gap_answer').slice(0, 40);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const s = `${base}_${i}`;
    if (!taken.has(s)) return s;
  }
  return `${base}_${Date.now() % 100000}`;
}
