import type { ListingSnapshot, ListingSource, ListingStatus } from '../types.ts';

export interface ParseContext {
  id: string;
  canonicalUrl: string;
  /** ISO timestamp for `fetchedAt` (injected for deterministic tests). */
  now?: string;
}

export function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function toStr(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s === '' ? null : s;
}

export function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter((s) => s.length > 0);
}

export function statusFromText(text: string | null | undefined): ListingStatus | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/sold\s*stc|sold subject|under offer|offer accepted/.test(t)) return 'under_offer';
  if (/let agreed|let\s*stc|tenancy agreed/.test(t)) return 'let_agreed';
  if (/\bsold\b/.test(t)) return 'sold';
  return null;
}

export function baseSnapshot(source: ListingSource, ctx: ParseContext, parserVersion: number): ListingSnapshot {
  return {
    source,
    id: ctx.id,
    canonicalUrl: ctx.canonicalUrl,
    fetchedAt: ctx.now ?? new Date().toISOString(),
    parserVersion,
    kind: 'sale',
    title: '',
    features: [],
    photos: [],
    locationConfidence: 'none',
  };
}
