/**
 * Batch 22, Part H: resuming after payment. The member ticked reports, was
 * short of credit and went to top up; the intent (resume_intents) holds what
 * they ticked and the prices they were shown. On return everything is quoted
 * again: the reports start only if every plan and face price still matches
 * what they saw; otherwise they confirm the new total. An intent lasts
 * RESUME_INTENT_MS and is used once.
 *
 * Pure: no network, no database, no server-only.
 */
import { safeInternalPath } from '../safe-path.ts';

export interface ResumeItem {
  dealId: string;
  withPmi: boolean;
  /** The plan price and the face price (what their credit pays) they were shown. */
  quotedBasePence: number;
  quotedFacePence: number;
}

export interface Requote {
  dealId: string;
  withPmi: boolean;
  basePence: number;
  facePence: number;
  /** The member's credit covers it now. */
  affordable: boolean;
  /** The deal can still be analysed (live, visible, not already running). */
  available: boolean;
}

export type ResumeDecision =
  | { kind: 'start'; items: Requote[] }
  | { kind: 'confirm'; items: Requote[]; totalFacePence: number; dropped: string[] }
  | { kind: 'short'; items: Requote[]; totalFacePence: number }
  | { kind: 'expired' }
  | { kind: 'nothing' };

const same = (a: number, b: number, tol: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < tol;

export function parseResumeItems(raw: unknown): ResumeItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ResumeItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const x = r as Record<string, unknown>;
    if (typeof x.dealId !== 'string' || !x.dealId) continue;
    const base = Number(x.quotedBasePence);
    const face = Number(x.quotedFacePence);
    if (!Number.isFinite(base) || !Number.isFinite(face)) continue;
    out.push({ dealId: x.dealId, withPmi: x.withPmi === true, quotedBasePence: base, quotedFacePence: face });
  }
  return out.slice(0, 3);
}

export function decideResume(p: { status: string; expiresAt: string; now: Date; items: readonly ResumeItem[]; requotes: readonly Requote[] }): ResumeDecision {
  const exp = Date.parse(p.expiresAt);
  if (p.status !== 'open' || !Number.isFinite(exp) || p.now.getTime() > exp) return { kind: 'expired' };
  const byKey = new Map(p.requotes.map((r) => [`${r.dealId}:${r.withPmi}`, r]));
  const items: Requote[] = [];
  const dropped: string[] = [];
  let changed = false;
  for (const it of p.items) {
    const r = byKey.get(`${it.dealId}:${it.withPmi}`);
    if (!r || !r.available) {
      dropped.push(it.dealId);
      continue;
    }
    items.push(r);
    if (!same(r.basePence, it.quotedBasePence, 0.005) || !same(r.facePence, it.quotedFacePence, 0.5)) changed = true;
  }
  if (items.length === 0) return { kind: 'nothing' };
  const total = Math.round(items.reduce((s, r) => s + r.facePence, 0));
  if (!items.every((r) => r.affordable)) return { kind: 'short', items, totalFacePence: total };
  if (changed || dropped.length > 0) return { kind: 'confirm', items, totalFacePence: total, dropped };
  return { kind: 'start', items };
}

/** Where a checkout may send the member back to: an internal path, or the fallback. */
export function resumeReturnPath(raw: string | null | undefined, fallback = '/today'): string {
  return safeInternalPath(raw, fallback);
}
