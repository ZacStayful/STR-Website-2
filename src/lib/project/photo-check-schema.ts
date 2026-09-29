/**
 * The Project photo check's question and answer (Batch 17, Part C): what the
 * model is shown and asked, the JSON schema its answer must follow
 * (structured outputs), and the validator every answer goes through before
 * anything is costed. An answer that fails validation is never guessed at:
 * the listing is skipped for the day.
 *
 * The model sees the photos (and floorplan) by number, the bedrooms,
 * bathrooms and type, and the line catalogue. Never the description, the
 * address or the price. For each line it says needed / not needed / can't
 * tell, with a reason of at most 120 characters and the photo numbers it
 * rests on; plus the condition, the kitchen's size and any counts the
 * photos make plain. Wiring, the water tank and pipework are hidden: always
 * "can't tell", whatever the model says.
 *
 * Pure: no network, no database, no server-only.
 */

import type { KitchenSize } from './config.ts';
import { LINE_SPECS, type LineFinding, type LineKey, type PhotoCondition, type PhotoFindings } from './costing.ts';

export const PHOTO_CHECK_VERSION = 1;
export const REASON_MAX = 120;
/** The counts the photos may lower (never raise) a quantity to. */
const COUNT_KEYS = ['rooms', 'radiators', 'windows', 'outsideDoors', 'internalDoors', 'bathrooms'] as const;
const COUNT_MAX = 40;

/** What each line means, for the model: plain words, no prices. */
const LINE_HELP: Record<LineKey, string> = {
  waste: 'Clearing rubbish, old furniture or fittings left in the property',
  rewire: 'Electrical rewire (hidden: always can’t tell)',
  boiler: 'Replacing the boiler: needed only when a photo shows an old or failed boiler',
  radiators: 'Replacing radiators: old, rusty, missing or mismatched ones',
  water_tank: 'Hot water tank or cylinder (hidden: always can’t tell)',
  pipework: 'Bathroom pipework and drainage (hidden: always can’t tell)',
  bathroom: 'A new bathroom suite',
  plaster: 'Replastering: cracked, blown, bare or patched walls and ceilings',
  skirting: 'Skirting boards and architraves',
  paint: 'Redecorating',
  kitchen: 'A new kitchen',
  carpet: 'New carpets or flooring',
  roof: 'Roof repairs: needed only when a photo shows slipped or missing tiles, sagging or a failing roof',
  windows: 'Replacing windows (old single glazing, rotten frames)',
  outside_doors: 'Replacing outside doors',
  internal_doors: 'Replacing internal doors',
  damp: 'Damp proofing: needed only when a photo shows damp staining, mould or tide marks',
};

export const HIDDEN_LINES: readonly LineKey[] = LINE_SPECS.filter((s) => s.sight === 'hidden').map((s) => s.key);

/** The system prompt: the job, the rules, and what never to do. */
export const PHOTO_CHECK_SYSTEM = [
  'You look at the photos of a UK property for sale and judge the works it needs before it can be let as a furnished short let.',
  'Judge only from what the photos show. When a photo does not show enough to judge a line, answer cant_tell: never guess.',
  'The rewire, water tank and pipework lines are hidden behind walls: always answer cant_tell for them.',
  'A line is needed only when a photo shows it plainly. Dated but sound and clean is not_needed unless it would put guests off.',
  `Each reason is at most ${REASON_MAX} characters, about the property itself (never people, names, addresses or anything written on a sign).`,
  'Photo numbers refer to the numbered images you are given, starting at 1. List only the photos a line rests on.',
  'condition: ready (could be let as it is, perhaps with a clean), light (a refresh: decorating, carpets, perhaps a kitchen or bathroom), full (a strip-out and refit, or anything structural).',
  'kitchenSize: small (a galley or a few units), big (a normal family kitchen), extra_big (a large kitchen-diner or open-plan), or unknown when no photo shows the kitchen.',
  'counts: whole-property counts only where the photos make them plain (every room shown); null otherwise.',
].join('\n');

/** The user message's text, after the images. */
export function photoCheckPrompt(facts: { bedrooms: number; bathrooms: number | null; propertyType: string | null; photos: number; floorplans: number }): string {
  const lines = LINE_SPECS.map((s) => `- ${s.key}: ${LINE_HELP[s.key]}`).join('\n');
  const images = facts.floorplans > 0 ? `Images 1–${facts.photos} are photos; the last ${facts.floorplans === 1 ? 'image is the floorplan' : `${facts.floorplans} images are floorplans`}.` : `Images 1–${facts.photos} are photos.`;
  return [
    `The property: ${facts.bedrooms} bedrooms, ${facts.bathrooms ?? 'unknown'} bathrooms, ${facts.propertyType ?? 'type unknown'}.`,
    images,
    'Judge every line below (needed, not_needed or cant_tell), with a short reason and the photo numbers:',
    lines,
  ].join('\n');
}

/** The answer's JSON schema (structured outputs: supported keywords only). */
export function photoCheckSchema(): Record<string, unknown> {
  const status = { type: 'string', enum: ['needed', 'not_needed', 'cant_tell'] };
  const lineProps: Record<string, unknown> = {};
  for (const s of LINE_SPECS) {
    lineProps[s.key] = {
      type: 'object',
      properties: { status, reason: { type: 'string' }, photos: { type: 'array', items: { type: 'integer' } } },
      required: ['status', 'reason', 'photos'],
      additionalProperties: false,
    };
  }
  const countProps: Record<string, unknown> = {};
  for (const k of COUNT_KEYS) countProps[k] = { type: ['integer', 'null'] };
  return {
    type: 'object',
    properties: {
      condition: { type: 'string', enum: ['ready', 'light', 'full'] },
      kitchenSize: { type: 'string', enum: ['small', 'big', 'extra_big', 'unknown'] },
      lines: { type: 'object', properties: lineProps, required: LINE_SPECS.map((s) => s.key), additionalProperties: false },
      counts: { type: 'object', properties: countProps, required: [...COUNT_KEYS], additionalProperties: false },
    },
    required: ['condition', 'kitchenSize', 'lines', 'counts'],
    additionalProperties: false,
  };
}

export type ValidatedAnswer = { ok: true; findings: PhotoFindings } | { ok: false; error: string };

const CONDITIONS: readonly PhotoCondition[] = ['ready', 'light', 'full'];
const KITCHENS: readonly KitchenSize[] = ['small', 'big', 'extra_big'];

/** Squash a reason to one plain line of at most REASON_MAX characters. */
export function cleanReason(v: unknown): string {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  if (s.length <= REASON_MAX) return s;
  return `${s.slice(0, REASON_MAX - 1).trimEnd()}…`;
}

/**
 * Every answer goes through here. It must be the whole shape: a missing
 * line, an unknown status or a condition outside the three is a failure
 * (skipped for the day, never guessed). Within it, the small things are
 * made safe rather than failed: a hidden line is always can't tell, reasons
 * are cut to 120 characters, photo numbers outside the images given are
 * dropped, and a count outside 0–40 is unknown.
 */
export function validatePhotoAnswer(raw: unknown, imageCount: number): ValidatedAnswer {
  let o: unknown = raw;
  if (typeof raw === 'string') {
    try {
      o = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'not_json' };
    }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, error: 'not_an_object' };
  const r = o as Record<string, unknown>;
  if (!CONDITIONS.includes(r.condition as PhotoCondition)) return { ok: false, error: 'bad_condition' };
  const kitchen = r.kitchenSize === 'unknown' ? null : KITCHENS.includes(r.kitchenSize as KitchenSize) ? (r.kitchenSize as KitchenSize) : undefined;
  if (kitchen === undefined) return { ok: false, error: 'bad_kitchen' };
  const rawLines = r.lines && typeof r.lines === 'object' && !Array.isArray(r.lines) ? (r.lines as Record<string, unknown>) : null;
  if (!rawLines) return { ok: false, error: 'no_lines' };
  const lines: Partial<Record<LineKey, LineFinding>> = {};
  for (const spec of LINE_SPECS) {
    const l = rawLines[spec.key];
    if (!l || typeof l !== 'object' || Array.isArray(l)) return { ok: false, error: `missing_line:${spec.key}` };
    const x = l as Record<string, unknown>;
    if (x.status !== 'needed' && x.status !== 'not_needed' && x.status !== 'cant_tell') return { ok: false, error: `bad_status:${spec.key}` };
    const photos = Array.isArray(x.photos) ? [...new Set(x.photos.filter((n): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= imageCount))].sort((a, b) => a - b) : [];
    const hidden = HIDDEN_LINES.includes(spec.key);
    lines[spec.key] = { status: hidden ? 'cant_tell' : x.status, reason: hidden ? 'Hidden behind walls: can’t tell from photos.' : cleanReason(x.reason), photos: hidden ? [] : photos };
  }
  // Keys the schema never asked for are simply not read.
  const rawCounts = r.counts && typeof r.counts === 'object' && !Array.isArray(r.counts) ? (r.counts as Record<string, unknown>) : {};
  const count = (v: unknown): number | null => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= COUNT_MAX ? (v as number) : null);
  const counts = { rooms: count(rawCounts.rooms), radiators: count(rawCounts.radiators), windows: count(rawCounts.windows), outsideDoors: count(rawCounts.outsideDoors), internalDoors: count(rawCounts.internalDoors), bathrooms: count(rawCounts.bathrooms) };
  return { ok: true, findings: { condition: r.condition as PhotoCondition, kitchenSize: kitchen, lines, counts } };
}
