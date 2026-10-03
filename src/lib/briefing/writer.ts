import 'server-only';

/**
 * Batch 23b: the writer. One model call per member per morning, with the
 * persona's email channel and the briefing task (./ai-input.ts), and the
 * fact sheet as its only input. The reply is parsed here and checked by the
 * validator before anything is used or charged.
 *
 * The call itself is not metered here: the runner charges it only once the
 * text has passed (./runner.ts), so a rejected briefing costs the member
 * nothing.
 */
import Anthropic from '@anthropic-ai/sdk';
import { briefingSystemPrompt, briefingUserMessage, type AiInput } from './ai-input';
import type { WriterOutput } from './validator';

/** The model (Zac's default: Haiku 4.5 unless Sonnet 5.5 is clearly better on real sheets). */
export const BRIEFING_MODEL = 'claude-haiku-4-5';
/** Room for the JSON reply: opener, subject and two nudges come to about 200 tokens. */
export const BRIEFING_MAX_TOKENS = 400;
/** Inside the pass's time budget; a slow call gives the template, not a held reservation. */
const TIMEOUT_MS = 15_000;

/** The unit rows (src/lib/credit/costs.ts) each model is metered at. */
export function unitsFor(model: string): { input: string; output: string } | null {
  if (model.startsWith('claude-haiku-4-5')) return { input: 'haiku45_input_token', output: 'haiku45_output_token' };
  if (model.startsWith('claude-sonnet-5-5')) return { input: 'sonnet55_input_token', output: 'sonnet55_output_token' };
  return null;
}

export interface WriterResult {
  output: WriterOutput | null;
  /** Why there is no output: the call failed, timed out, or the reply was not the JSON asked for. */
  error: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** The JSON object in a reply, tolerating a code fence or a sentence around it. */
export function parseReply(text: string): WriterOutput | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const opener = typeof raw.opener === 'string' ? raw.opener : null;
    const subject = typeof raw.subject === 'string' ? raw.subject : null;
    const nudges = Array.isArray(raw.nudges) ? raw.nudges.filter((x): x is string => typeof x === 'string') : [];
    if (!opener || !subject) return null;
    return { opener: opener.trim(), subject: subject.trim(), nudges: nudges.map((x) => x.trim()).filter(Boolean) };
  } catch {
    return null;
  }
}

export function writerConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function writeBriefing(input: AiInput, model: string = BRIEFING_MODEL): Promise<WriterResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { output: null, error: 'no_api_key', model, inputTokens: 0, outputTokens: 0 };
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 0 });
  try {
    const msg = await client.messages.create({
      model,
      max_tokens: BRIEFING_MAX_TOKENS,
      // Sonnet 5.5 cannot switch thinking off; between_tools keeps it out of a one-shot reply.
      ...(model.startsWith('claude-sonnet-5-5') ? { thinking: { type: 'between_tools' } as never, output_config: { effort: 'low' } } : {}),
      system: briefingSystemPrompt(),
      messages: [{ role: 'user', content: briefingUserMessage(input) }],
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const output = msg.stop_reason === 'refusal' ? null : parseReply(text);
    return { output, error: output ? null : msg.stop_reason === 'refusal' ? 'refusal' : 'unparseable', model: msg.model || model, inputTokens: msg.usage.input_tokens ?? 0, outputTokens: msg.usage.output_tokens ?? 0 };
  } catch (err) {
    const timeout = err instanceof Anthropic.APIConnectionTimeoutError;
    return { output: null, error: timeout ? 'timeout' : `api_error: ${(err as Error)?.message ?? err}`.slice(0, 200), model, inputTokens: 0, outputTokens: 0 };
  }
}
