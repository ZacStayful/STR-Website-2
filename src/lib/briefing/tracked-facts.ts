/**
 * Batch 23b: a member's own tracked deals, as briefing facts.
 *
 * Reads only structured fields: the stage, the deal's card (town, raw type,
 * price history) and the area code. A pipeline row's title, address and
 * snapshot are never read here, so they cannot reach the writer, opened or
 * not.
 *
 * Pure: no network, no database, no server-only.
 */
import { areaMetaForCode } from '../market/areas.ts';
import { placeName, propertyTypeOf, type KeptDrop, type PropertyType } from './facts.ts';
import { isNudgeStage, type StageEntry } from './nudges.ts';

/** The parts of a TrackedDeal (src/lib/listing/tracked.ts) this reads. */
export interface TrackedLite {
  key: string;
  stage: string;
  source: 'pipeline' | 'reaction' | 'open';
  dealId: string | null;
  area: string | null;
  lastChangedAt: string;
  userId: string;
}

/** The parts of a marketplace card this reads. */
export interface CardLite {
  town: string | null;
  raw_type: string | null;
  price_history?: unknown;
}

/** A stage move from activity_events (kind 'stage_move'): which item, to which stage, when. */
export interface StageMove {
  key: string;
  to: string;
  at: string;
}

/** 'kept' (how some paths log a Keep) is My deals' 'watching'. */
export function normaliseStage(s: string | null | undefined): string | null {
  if (!s) return null;
  return s === 'kept' ? 'watching' : s;
}

/** Where a deal is, said safely: its town, else its area's name; and its type from the fixed list. */
export function whereAndWhat(item: Pick<TrackedLite, 'dealId' | 'area'>, card: CardLite | undefined): { town: string | null; type: PropertyType | null } {
  const town = placeName(card?.town) ?? (item.area ? placeName(areaMetaForCode(item.area).name) : null);
  return { town, type: propertyTypeOf(card?.raw_type) };
}

interface HistoryEntry {
  at: string;
  amount: number | null;
  previousAmount: number | null;
  period: string | null;
}

function historyOf(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
  return raw
    .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object')
    .map((e) => ({ at: String(e.at ?? ''), amount: num(e.amount), previousAmount: num(e.previousAmount), period: typeof e.period === 'string' ? e.period : null }));
}

/** Price drops recorded since `since` on deals the member KEPT (their own Keep, stage Kept), newest first. */
export function keptDropsFrom(items: readonly TrackedLite[], cards: ReadonlyMap<string, CardLite>, memberId: string, since: Date, now: Date): KeptDrop[] {
  const out: (KeptDrop & { at: number })[] = [];
  for (const it of items) {
    if (it.userId !== memberId || normaliseStage(it.stage) !== 'watching' || !it.dealId) continue;
    const card = cards.get(it.dealId);
    if (!card) continue;
    for (const e of historyOf(card.price_history)) {
      const at = Date.parse(e.at);
      if (!Number.isFinite(at) || at < since.getTime() || at > now.getTime()) continue;
      if (e.amount === null || e.previousAmount === null || !(e.amount < e.previousAmount) || e.amount <= 0) continue;
      const { town, type } = whereAndWhat(it, card);
      out.push({ town, type, oldPrice: e.previousAmount, newPrice: e.amount, period: e.period === 'pcm' ? 'pcm' : 'total', at });
    }
  }
  out.sort((a, b) => b.at - a.at);
  return out.map(({ at: _at, ...d }) => {
    void _at;
    return d;
  });
}

/** Passes in the window, by property type, most first (types not on the fixed list are left out). */
export function passesByTypeFrom(items: readonly TrackedLite[], cards: ReadonlyMap<string, CardLite>, memberId: string, since: Date): { type: PropertyType; count: number }[] {
  const counts = new Map<PropertyType, number>();
  for (const it of items) {
    if (it.userId !== memberId || it.stage !== 'passed' || it.source !== 'reaction' || !it.dealId) continue;
    if (Date.parse(it.lastChangedAt) < since.getTime()) continue;
    const type = propertyTypeOf(cards.get(it.dealId)?.raw_type);
    if (type) counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

/** The member's own deals from Kept to Offer. */
export function pipelineOf(items: readonly TrackedLite[], memberId: string): TrackedLite[] {
  return items.filter((it) => it.userId === memberId && isNudgeStage(normaliseStage(it.stage)));
}

/**
 * When each pipeline deal entered its current stage: the latest recorded
 * move to that stage; for a Keep with no move recorded, the Keep itself
 * (the reaction's time). Anything else: unknown, so no nudge.
 */
export function stageEntriesFrom(items: readonly TrackedLite[], cards: ReadonlyMap<string, CardLite>, moves: readonly StageMove[], memberId: string): StageEntry[] {
  const latest = new Map<string, number>();
  for (const m of moves) {
    const to = normaliseStage(m.to);
    const at = Date.parse(m.at);
    if (!to || !Number.isFinite(at)) continue;
    const k = `${m.key}|${to}`;
    if (at > (latest.get(k) ?? -Infinity)) latest.set(k, at);
  }
  return pipelineOf(items, memberId).map((it) => {
    const stage = normaliseStage(it.stage)!;
    const moved = latest.get(`${it.key}|${stage}`);
    const enteredAt = moved !== undefined ? new Date(moved).toISOString() : it.source === 'reaction' && stage === 'watching' ? it.lastChangedAt : null;
    const { town, type } = whereAndWhat(it, it.dealId ? cards.get(it.dealId) : undefined);
    return { key: it.key, stage, enteredAt, town, type };
  });
}
