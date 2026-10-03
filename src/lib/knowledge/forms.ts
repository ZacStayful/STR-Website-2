/**
 * Batch 24: an entry's content from the admin form, and a slug from a
 * question. Structure only; the approval checks are render.ts checkContent.
 *
 * Pure: no network, no database, no server-only.
 */
import { KB_CATEGORIES, KB_CHANNELS, SLUG_PATTERN } from './config.ts';
import type { EntryContent } from './render.ts';

export type FormGet = (name: string) => string | null;
export type FormGetAll = (name: string) => string[];

export function contentFromForm(get: FormGet, getAll: FormGetAll): EntryContent {
  const variants = (get('variants') ?? '')
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean);
  const channels = getAll('channels').filter((c) => (KB_CHANNELS as readonly string[]).includes(c));
  const category = get('category') ?? '';
  const showWhen = (get('showWhen') ?? '').trim();
  return {
    question: (get('question') ?? '').trim(),
    variants: [...new Set(variants)],
    answer: (get('answer') ?? '').trim(),
    category: (KB_CATEGORIES as readonly string[]).includes(category) ? category : '',
    channels: [...new Set(channels)],
    showWhen: showWhen || null,
  };
}

/** "Can I pause my plan?" → "can_i_pause_my_plan", cut to fit; null when nothing usable is left. */
export function slugFrom(text: string): string | null {
  const s = text
    .toLowerCase()
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/, '');
  if (!/[a-z0-9]/.test(s)) return null;
  const slug = /^[a-z]/.test(s) ? s : `q_${s}`;
  return SLUG_PATTERN.test(slug) ? slug : null;
}
