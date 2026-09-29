import 'server-only';

/**
 * The Project photo check's call (Batch 17, Part C): up to ten photos and the
 * floorplan, by URL, to PHOTO_CHECK_MODEL with the line catalogue, answered as
 * structured output (photo-check-schema.ts) and validated before anything is
 * costed. House spend, metered as the question `projectPhotoCheck` at the
 * model that answered; never a member's credit.
 *
 *   - The model always thinks: no `thinking` field; `output_config.effort`
 *     (a setting, medium to start) is the control, and max_tokens (16,000)
 *     leaves room for the thinking as well as the answer.
 *   - No forced tool_choice (the model rejects it): structured output instead.
 *   - A policy refusal is re-run once, in the same call, on the model the API
 *     picks (`fallbacks: "default"`, beta server-side-fallback-2026-07-01).
 *     The installed SDK types only know the array form, so the scalar is sent
 *     as a body field they do not describe. If the whole chain refuses, the
 *     listing is skipped for the day.
 *   - A 45-second timeout (less when the caller's deadline is nearer), no
 *     automatic retries: one call per cron fire.
 *   - A reply cut at max_tokens, or one that fails validation, is skipped for
 *     the day; never guessed at.
 *   - When Anthropic cannot fetch a photo URL, the server fetches the images
 *     in memory and sends them inline, once; nothing is stored.
 */
import Anthropic from '@anthropic-ai/sdk';
import { meter } from '../credit/meter';
import type { PhotoFindings } from './costing';
import { PHOTO_CHECK_SYSTEM, photoCheckPrompt, photoCheckSchema, validatePhotoAnswer } from './photo-check-schema';
import { hopsOf, MAX_OUTPUT_TOKENS, PHOTO_CHECK_MODEL, photoCheckCostPence, unitsFor, type PhotoCheckUsage, type UsageLike } from './photo-check-usage';

export { PHOTO_CHECK_MODEL };

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const TIMEOUT_MS = 45_000;
const MAX_TOKENS = MAX_OUTPUT_TOKENS;
const IMAGE_FETCH_MS = 8_000;
/** Time kept back from the caller's deadline, for writing the outcome. */
const DEADLINE_MARGIN_MS = 2_000;
/** Below this, a call is not started: it could not finish in time. */
const MIN_CALL_MS = 15_000;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const INLINE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
type InlineType = (typeof INLINE_TYPES)[number];

export type PhotoCheckEffort = 'low' | 'medium' | 'high';

export interface PhotoCheckInput {
  photos: readonly string[];
  floorplans: readonly string[];
  bedrooms: number;
  bathrooms: number | null;
  propertyType: string | null;
  effort: PhotoCheckEffort;
  /** When the caller must be done (epoch ms): each call's timeout ends before it. */
  deadline?: number;
}

export type PhotoCheckOutcome =
  | {
      ok: true;
      findings: PhotoFindings;
      model: string;
      fellBack: boolean;
      inline: boolean;
      /** The photos and floorplans actually sent, in order: the numbers in the findings refer to these. */
      used: { photos: string[]; floorplans: string[] };
      usage: PhotoCheckUsage[];
      costPence: number;
    }
  | { ok: false; reason: 'not_configured' | 'no_photos' | 'unavailable' | 'refused' | 'max_tokens' | 'invalid'; detail: string | null; usage: PhotoCheckUsage[]; costPence: number };

async function meterHops(hops: readonly PhotoCheckUsage[]): Promise<void> {
  for (const h of hops) {
    const units = unitsFor(h.model);
    if (h.inputTokens > 0) await meter({ provider: 'anthropic', unit: units.input, quantity: h.inputTokens, question: 'projectPhotoCheck', description: `Project photo check (${h.model}, input)`, skipPreflight: true }, async () => null);
    if (h.outputTokens > 0) await meter({ provider: 'anthropic', unit: units.output, quantity: h.outputTokens, question: 'projectPhotoCheck', description: `Project photo check (${h.model}, output incl. thinking)`, skipPreflight: true }, async () => null);
  }
}

/** An image fetched into memory for an inline send; null when it cannot be (never stored). */
async function inlineImage(url: string): Promise<{ media_type: InlineType; data: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!(INLINE_TYPES as readonly string[]).includes(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > IMAGE_MAX_BYTES) return null;
    return { media_type: type as InlineType, data: buf.toString('base64') };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The API could not fetch an image by URL (a 400 naming the image): worth one inline retry. */
function imageFetchError(err: unknown): boolean {
  if (!(err instanceof Anthropic.APIError) || err.status !== 400) return false;
  return /image|url|download|fetch/i.test(err.message ?? '');
}

type ImageBlock = { type: 'image'; source: { type: 'url'; url: string } | { type: 'base64'; media_type: InlineType; data: string } };

/** The time a call may take: the timeout, or less when the caller's deadline is nearer; 0 when too little is left to start one. */
function callTimeout(deadline: number | undefined): number {
  if (deadline === undefined) return TIMEOUT_MS;
  const left = deadline - Date.now() - DEADLINE_MARGIN_MS;
  return left >= MIN_CALL_MS ? Math.min(TIMEOUT_MS, left) : 0;
}

async function ask(client: Anthropic, images: ImageBlock[], input: PhotoCheckInput, counts: { photos: number; floorplans: number }, timeout: number) {
  const params = {
    model: PHOTO_CHECK_MODEL,
    max_tokens: MAX_TOKENS,
    betas: [FALLBACK_BETA],
    system: PHOTO_CHECK_SYSTEM,
    output_config: { effort: input.effort, format: { type: 'json_schema' as const, schema: photoCheckSchema() } },
    messages: [
      {
        role: 'user' as const,
        content: [...images, { type: 'text' as const, text: photoCheckPrompt({ bedrooms: input.bedrooms, bathrooms: input.bathrooms, propertyType: input.propertyType, photos: counts.photos, floorplans: counts.floorplans }) }],
      },
    ],
    // The scalar form (Anthropic picks the fallback by refusal category); see the header.
    fallbacks: 'default',
  };
  return client.beta.messages.create(params as unknown as Parameters<typeof client.beta.messages.create>[0], { timeout, maxRetries: 0 }) as Promise<Anthropic.Beta.Messages.BetaMessage>;
}

export function photoCheckConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function runPhotoCheck(input: PhotoCheckInput): Promise<PhotoCheckOutcome> {
  const none = { usage: [] as PhotoCheckUsage[], costPence: 0 };
  if (!photoCheckConfigured()) return { ok: false, reason: 'not_configured', detail: null, ...none };
  const urls = [...input.photos, ...input.floorplans];
  if (input.photos.length === 0) return { ok: false, reason: 'no_photos', detail: null, ...none };
  const first = callTimeout(input.deadline);
  if (first === 0) return { ok: false, reason: 'unavailable', detail: 'no_time', ...none };
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: TIMEOUT_MS, maxRetries: 0 });

  let inline = false;
  let used = { photos: [...input.photos], floorplans: [...input.floorplans] };
  let message: Anthropic.Beta.Messages.BetaMessage;
  try {
    message = await ask(client, urls.map((url) => ({ type: 'image', source: { type: 'url', url } })), input, { photos: used.photos.length, floorplans: used.floorplans.length }, first);
  } catch (err) {
    if (!imageFetchError(err)) return { ok: false, reason: 'unavailable', detail: err instanceof Error ? err.message.slice(0, 200) : null, ...none };
    // Anthropic could not fetch a photo: fetch them here, in memory, and send them inline once.
    // An image that cannot be fetched here either is left out, and the numbering follows what was sent.
    const fetched = await Promise.all(urls.map(async (url) => ({ url, img: await inlineImage(url) })));
    const photos = fetched.slice(0, input.photos.length).filter((x) => x.img !== null);
    const plans = fetched.slice(input.photos.length).filter((x) => x.img !== null);
    if (photos.length === 0) return { ok: false, reason: 'unavailable', detail: 'images_unreachable', ...none };
    const again = callTimeout(input.deadline);
    if (again === 0) return { ok: false, reason: 'unavailable', detail: 'no_time', ...none };
    inline = true;
    used = { photos: photos.map((x) => x.url), floorplans: plans.map((x) => x.url) };
    try {
      message = await ask(client, [...photos, ...plans].map((x) => ({ type: 'image', source: { type: 'base64', ...x.img! } })), input, { photos: used.photos.length, floorplans: used.floorplans.length }, again);
    } catch (retryErr) {
      return { ok: false, reason: 'unavailable', detail: retryErr instanceof Error ? retryErr.message.slice(0, 200) : null, ...none };
    }
  }

  const hops = hopsOf(message.usage as unknown as UsageLike, PHOTO_CHECK_MODEL, String(message.model ?? PHOTO_CHECK_MODEL));
  await meterHops(hops);
  const costPence = photoCheckCostPence(hops);
  const fellBack = hops.some((h) => h.model !== PHOTO_CHECK_MODEL) || String(message.model ?? PHOTO_CHECK_MODEL) !== PHOTO_CHECK_MODEL;
  const stop = String(message.stop_reason ?? '');
  if (stop === 'refusal') return { ok: false, reason: 'refused', detail: null, usage: hops, costPence };
  if (stop === 'max_tokens') return { ok: false, reason: 'max_tokens', detail: null, usage: hops, costPence };
  // Read by block type, never position: thinking (and a fallback marker) can come first.
  const text = message.content.filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text').map((b) => b.text).join('');
  const checked = validatePhotoAnswer(text, used.photos.length + used.floorplans.length);
  if (!checked.ok) return { ok: false, reason: 'invalid', detail: checked.error, usage: hops, costPence };
  return { ok: true, findings: checked.findings, model: String(message.model ?? PHOTO_CHECK_MODEL), fellBack, inline, used, usage: hops, costPence };
}
