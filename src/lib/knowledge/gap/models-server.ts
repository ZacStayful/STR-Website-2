import 'server-only';

/**
 * Batch 24: one model call for the nightly gap job, metered as house spend.
 *
 * Every call logs its input, output and prompt-cache tokens to provider_calls
 * under the job's action (userId null: logged, never charged to a member), so
 * the spend shows on /admin and /admin/billing, and returns what it cost so
 * the run can hold itself to the month's cap. Structured output (a JSON
 * schema) on both models; Sonnet 5.5 runs with thinking only between tools
 * and low effort (a one-shot draft), Haiku 4.5 takes neither setting.
 */
import Anthropic from '@anthropic-ai/sdk';
import { meter } from '../../credit/meter';
import type { MeterContext } from '../../credit/context';
import { GAP_DRAFT_MODEL, GAP_MODEL_TIMEOUT_MS } from '../config';
import { MODEL_UNITS, usagePence, type UnitPence, type Usage } from './plan';

export interface ModelReply {
  /** The JSON text, or null when the call failed or was refused. */
  text: string | null;
  usage: Usage;
  /** Raw pence, from the usage the API reported. */
  costPence: number;
  stopReason: string | null;
  error: string | null;
}

export function modelsConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function callModel(o: {
  model: string;
  system: string;
  /** Mark the system prompt for the prompt cache (the drafting prefix is the same for every gap in a night). */
  cacheSystem: boolean;
  user: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  ctx: MeterContext;
  label: string;
  price: UnitPence;
}): Promise<ModelReply> {
  const units = MODEL_UNITS[o.model];
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const empty: Usage = {};
  if (!units) return { text: null, usage: empty, costPence: 0, stopReason: null, error: `no unit rows for ${o.model}` };
  if (!apiKey) return { text: null, usage: empty, costPence: 0, stopReason: null, error: 'no_api_key' };
  const client = new Anthropic({ apiKey, timeout: GAP_MODEL_TIMEOUT_MS, maxRetries: 1 });
  const sonnet = o.model === GAP_DRAFT_MODEL;
  let msg: Anthropic.Message;
  try {
    msg = await client.messages.create({
      model: o.model,
      max_tokens: o.maxTokens,
      system: o.cacheSystem ? [{ type: 'text', text: o.system, cache_control: { type: 'ephemeral' } }] : o.system,
      messages: [{ role: 'user', content: o.user }],
      output_config: { format: { type: 'json_schema', schema: o.schema }, ...(sonnet ? { effort: 'low' as const } : {}) },
      // Sonnet 5.5 can't switch thinking off; between_tools keeps it out of a one-shot reply (as the briefing writer does).
      ...(sonnet ? { thinking: { type: 'between_tools' } as never } : {}),
    });
  } catch (err) {
    const timeout = err instanceof Anthropic.APIConnectionTimeoutError;
    return { text: null, usage: empty, costPence: 0, stopReason: null, error: timeout ? 'timeout' : `api_error: ${(err as Error)?.message ?? err}`.slice(0, 300) };
  }
  const u = msg.usage;
  const usage: Usage = { input_tokens: u.input_tokens, output_tokens: u.output_tokens, cache_read_input_tokens: u.cache_read_input_tokens ?? 0, cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0 };
  // House spend: logged against the job's action, never a member's credit.
  const lines: [string, number][] = [
    [units.output, usage.output_tokens ?? 0],
    [units.input, usage.input_tokens ?? 0],
    [units.cacheRead, usage.cache_read_input_tokens ?? 0],
    [units.cacheWrite, usage.cache_creation_input_tokens ?? 0],
  ];
  for (const [unit, quantity] of lines) {
    if (quantity > 0) await meter({ provider: 'anthropic', unit, quantity, skipPreflight: true, description: `Knowledge gap job: ${o.label}` }, async () => null, o.ctx);
  }
  const text = msg.stop_reason === 'refusal' ? null : msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
  return { text, usage, costPence: usagePence(units, usage, o.price), stopReason: msg.stop_reason ?? null, error: msg.stop_reason === 'refusal' ? 'refused' : msg.stop_reason === 'max_tokens' ? 'max_tokens' : null };
}
