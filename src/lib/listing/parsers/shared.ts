import type { ListingSnapshot, ListingSource, ListingStatus } from '../types.ts';
import { needsWorkFrom } from '../../project/needs-work.ts';
import { exclusionFor } from '../../project/exclusions.ts';

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

/**
 * How many photo URLs a snapshot keeps (the listing's own, shown after an
 * open). Batch 17's photo check reads more from a fresh page instead
 * (photos.ts), so the stored snapshot never grows.
 */
export const SNAPSHOT_PHOTO_LIMIT = 6;

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

// ── Dates ──
// Portals hand out three shapes: "20260811" (Rightmove analytics), "11/08/2026"
// (UK day-first, everywhere else) and prose like "Added yesterday". Everything
// downstream wants one shape, so each of these answers an ISO date or null —
// never a guess, because a wrong listing date becomes a wrong days-on-market and
// then a wrong claim in a member's email.

function isoIfReal(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || y < 1990 || y > 2100) return null;
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  if (!Number.isInteger(d) || d < 1 || d > 31) return null;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // Rejects 31 February and friends: the round trip only survives a real date.
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
}

/** "20260811" → "2026-08-11". */
export function isoFromCompactDate(v: unknown): string | null {
  const s = toStr(v);
  if (!s || !/^\d{8}$/.test(s)) return null;
  return isoIfReal(Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6, 8)));
}

/** "11/08/2026" → "2026-08-11". UK order: day first, never month first. */
export function isoFromUkDate(v: unknown): string | null {
  const s = toStr(v);
  const m = s?.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!m) return null;
  return isoIfReal(Number(m[3]), Number(m[2]), Number(m[1]));
}

/**
 * Rightmove's `listingHistory.listingUpdateReason`: "Added on 11/08/2026",
 * "Reduced on 03/06/2026", "Added yesterday", "Reduced today". Returns what
 * happened and when, with the date left null when the wording is relative and
 * `today` was not supplied.
 */
export function parseListingUpdate(
  v: unknown,
  today?: string,
): { reason: 'added' | 'reduced' | 'increased'; on: string | null } | null {
  const s = toStr(v);
  if (!s) return null;
  const lower = s.toLowerCase();
  const reason = lower.startsWith('reduced') ? 'reduced' : lower.startsWith('increased') ? 'increased' : lower.startsWith('added') ? 'added' : null;
  if (!reason) return null;

  const exact = lower.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{4})\b/);
  if (exact) return { reason, on: isoFromUkDate(exact[1]) };

  const base = today && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : null;
  if (!base) return { reason, on: null };
  const shift = /\byesterday\b/.test(lower) ? -1 : /\btoday\b/.test(lower) ? 0 : null;
  if (shift === null) return { reason, on: null };
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + shift);
  return { reason, on: d.toISOString().slice(0, 10) };
}

// ── Batch 17: what a sale's page says about the work it needs ──

/**
 * Years left on a lease from the portal's wording: "976 yrs left" (an
 * OnTheMarket key-info line), "(975 years remaining)", "90 years remaining on
 * the lease". Null when no line says how many remain (a lease's original term
 * is not what is left).
 */
export function leaseYearsFrom(...texts: (string | null | undefined)[]): number | null {
  for (const t of texts) {
    const m = t ? /(\d{1,4}(?:,\d{3})?)\s*(?:yrs?|years?)\s*(?:left|remaining|unexpired)/i.exec(t) : null;
    if (!m) continue;
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isInteger(n) && n > 0 && n <= 9999) return n;
  }
  return null;
}

const SQ_M_TO_FT = 10.7639;

/**
 * The floor area the portal states, in square feet: "818 sq ft", "1,050 sq.
 * ft.", "76 sq m", "76m²". The first plausible one (150–20,000 sq ft); null
 * otherwise. Only ever used to scale the rewire estimate.
 */
export function floorAreaSqftFrom(...texts: (string | null | undefined)[]): number | null {
  for (const t of texts) {
    if (!t) continue;
    const ft = /(\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?\s*(?:sq\.?\s*ft|sqft|sq\.?\s*feet|square\s+f(?:ee|oo)t)\b/i.exec(t);
    const m = ft ? null : /(\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?\s*(?:sq\.?\s*m(?:etres?|eters?)?\b|sqm\b|m²|square\s+met(?:re|er)s?)/i.exec(t);
    const value = ft ? Number(ft[1].replace(/,/g, '')) : m ? Math.round(Number(m[1].replace(/,/g, '')) * SQ_M_TO_FT) : null;
    if (value !== null && Number.isFinite(value) && value >= 150 && value <= 20_000) return value;
  }
  return null;
}

/**
 * A sale's project facts, from the page's own words (the description is read
 * here and dropped, as the auction flag's is): our needs-work phrase keys and
 * the first reason it can never be a Project deal. Rentals get neither.
 */
export function addProjectFacts(snap: ListingSnapshot, description: string): void {
  if (snap.kind !== 'sale') return;
  const texts = [description, snap.title, snap.price?.qualifier ?? '', snap.tenure ?? '', ...snap.features];
  snap.needsWork = needsWorkFrom(...texts);
  snap.projectExclusion = exclusionFor({ texts, tenure: snap.tenure ?? null, yearsRemainingOnLease: snap.yearsRemainingOnLease ?? null, listedFlag: snap.listedBuilding ?? null });
}
