/**
 * /admin/demand's figures: one row per postcode area × kind × type (house /
 * flat) with demand beside supply, and the plan as the dry run shows it.
 * Pure, so the rows, the gap and the sort are tested rather than trusted.
 *
 * A profile open to either type counts in both the house and the flat row.
 * A deal whose type the portal does not say (propertyKind 'unknown') is in
 * neither row; the page shows those as a count per area. The gap is the
 * profiles wanting a row minus its live deals: above 0, demand outstrips
 * supply.
 */
import { areaMetaForCode } from '../market/areas.ts';
import { BUDGET_LABELS } from '../market/filters.ts';
import { queryKey } from '../listing/sourcing.ts';
import { propertyKind } from '../listing/suitability.ts';
import { cellKey, DEMAND_KINDS, type Demand, type DemandCell, type DemandKind, type DemandPlan, type PlannedSearch, type Skipped } from './demand.ts';

export type RowType = 'house' | 'flat';
export const ROW_TYPES: readonly RowType[] = ['house', 'flat'];

/**
 * Where an area × kind stands:
 *   sweep_today / sweep_missed  on the sweep's list, searched today or not yet
 *   demand                      added by the demand-led searches (searched, or to be)
 *   cap_reached                 would be added, but this month's cap is spent
 *   below_threshold             wanted, by fewer members than the threshold
 *   no_data                     wanted, but the area cannot be screened
 *   none                        nobody wants it and the sweep does not cover it
 */
export type RowStatus = 'sweep_today' | 'sweep_missed' | 'demand' | 'cap_reached' | 'below_threshold' | 'no_data' | 'none';

export const STATUS_LABELS: Record<RowStatus, string> = {
  sweep_today: 'Sweep · searched today',
  sweep_missed: 'Sweep · not reached today',
  demand: 'Demand',
  cap_reached: 'Cap reached',
  below_threshold: 'Below threshold',
  no_data: 'No screening data',
  none: 'Not searched',
};

export interface DemandRow {
  area: string;
  areaName: string;
  kind: DemandKind;
  type: RowType;
  members: number;
  paying: number;
  profiles: number;
  liveDeals: number;
  newDeals: number;
  status: RowStatus;
  /** Searched on thin figures (1–4 analyser reports). */
  early: boolean;
  gap: number;
  /** The most common must-haves behind this area × kind, e.g. "£200k–£350k · 3 bed". */
  mustHaves: string | null;
}

/** One pool row as far as supply goes: area, kind and the portal's type, never an address. */
export interface SupplyRow {
  postcode_area: string | null;
  kind: string;
  raw_type: string | null;
}

export interface Supply {
  /** cellKey → type → count. */
  byCell: Map<string, Record<RowType, number>>;
  /** cellKey → deals the portal gives no type for. */
  unknown: Map<string, number>;
}

export function supplyFrom(rows: readonly SupplyRow[]): Supply {
  const byCell = new Map<string, Record<RowType, number>>();
  const unknown = new Map<string, number>();
  for (const r of rows) {
    if (!r.postcode_area || (r.kind !== 'sale' && r.kind !== 'rent')) continue;
    const key = cellKey(r.postcode_area.trim().toUpperCase(), r.kind);
    const t = propertyKind(r.raw_type, null);
    if (t === 'unknown') {
      unknown.set(key, (unknown.get(key) ?? 0) + 1);
      continue;
    }
    const c = byCell.get(key) ?? { house: 0, flat: 0 };
    c[t] += 1;
    byCell.set(key, c);
  }
  return { byCell, unknown };
}

function mostCommon<K>(counts: ReadonlyMap<K, number>): K | null {
  let best: K | null = null;
  let n = 0;
  for (const [k, v] of counts) if (v > n) [best, n] = [k, v];
  return best;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export function mustHavesOf(cell: Pick<DemandCell, 'kind' | 'budgets' | 'maxRents' | 'bedrooms'>): string | null {
  const parts: string[] = [];
  if (cell.kind === 'sale') {
    const b = mostCommon(cell.budgets);
    if (b) parts.push(BUDGET_LABELS[b as keyof typeof BUDGET_LABELS] ?? b);
  } else {
    const rent = median(cell.maxRents);
    if (rent) parts.push(`up to £${rent.toLocaleString('en-GB')} pcm`);
  }
  const beds = mostCommon(cell.bedrooms);
  if (beds) parts.push(`${beds === 4 ? '4+' : beds} bed`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export interface RowInputs {
  demand: Demand;
  plan: DemandPlan;
  /** Areas on the sweep's list, and the sweep's searches finished today (query keys). */
  sweepAreas: ReadonlySet<string>;
  sweepDoneToday: ReadonlySet<string>;
  live: Supply;
  added: Supply;
  /** This month's cap is spent: planned searches wait for the 1st. */
  capReached: boolean;
  /** Include area × kinds nobody wants (supply only). */
  includeUnwanted: boolean;
}

export function demandRows(input: RowInputs): DemandRow[] {
  const planned = new Map<string, PlannedSearch>(input.plan.searches.map((s) => [cellKey(s.area, s.kind), s]));
  const skipped = new Map<string, Skipped>(input.plan.skipped.map((s) => [cellKey(s.area, s.kind), s]));
  const keys = new Set<string>(input.demand.cells.keys());
  if (input.includeUnwanted) {
    for (const k of input.live.byCell.keys()) keys.add(k);
    for (const k of input.added.byCell.keys()) keys.add(k);
  }
  const rows: DemandRow[] = [];
  for (const key of keys) {
    const [area, kindRaw] = key.split('|');
    const kind = kindRaw as DemandKind;
    if (!DEMAND_KINDS.includes(kind)) continue;
    const cell = input.demand.cells.get(key);
    let status: RowStatus;
    if (input.sweepAreas.has(area)) status = input.sweepDoneToday.has(queryKey(kind, area, null, null, null)) ? 'sweep_today' : 'sweep_missed';
    else if (planned.has(key)) status = input.capReached ? 'cap_reached' : 'demand';
    else {
      const why = skipped.get(key)?.reason;
      status = why === 'searched_today' ? 'demand' : why === 'below_threshold' ? 'below_threshold' : why === 'no_data' ? 'no_data' : 'none';
    }
    for (const type of ROW_TYPES) {
      const wanted = cell ? [cell.byType[type], cell.byType.any] : [];
      const members = new Set(wanted.flatMap((t) => [...t.members]));
      const paying = new Set(wanted.flatMap((t) => [...t.paying]));
      const profiles = wanted.reduce((a, t) => a + t.profiles, 0);
      const liveDeals = input.live.byCell.get(key)?.[type] ?? 0;
      const newDeals = input.added.byCell.get(key)?.[type] ?? 0;
      if (profiles === 0 && !input.includeUnwanted) continue;
      if (profiles === 0 && liveDeals === 0 && newDeals === 0) continue;
      rows.push({
        area,
        areaName: areaMetaForCode(area).name,
        kind,
        type,
        members: members.size,
        paying: paying.size,
        profiles,
        liveDeals,
        newDeals,
        status,
        early: planned.get(key)?.early ?? false,
        gap: profiles - liveDeals,
        mustHaves: cell ? mustHavesOf(cell) : null,
      });
    }
  }
  return rows;
}

// ── Sorting (the /admin/activity pattern: through the URL, stable ties) ──

export const SORT_KEYS = ['gap', 'area', 'kind', 'type', 'members', 'paying', 'profiles', 'live', 'new', 'status'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = 'asc' | 'desc';

export function isSortKey(v: unknown): v is SortKey {
  return typeof v === 'string' && (SORT_KEYS as readonly string[]).includes(v);
}

/** Text columns start A→Z; numbers start highest first. */
export function defaultDir(key: SortKey): SortDir {
  return key === 'area' || key === 'kind' || key === 'type' || key === 'status' ? 'asc' : 'desc';
}

const STATUS_ORDER: RowStatus[] = ['cap_reached', 'demand', 'below_threshold', 'no_data', 'sweep_missed', 'sweep_today', 'none'];

function compare(a: DemandRow, b: DemandRow, key: SortKey): number {
  switch (key) {
    case 'gap':
      return a.gap - b.gap;
    case 'area':
      return a.area.localeCompare(b.area);
    case 'kind':
      return a.kind.localeCompare(b.kind);
    case 'type':
      return a.type.localeCompare(b.type);
    case 'members':
      return a.members - b.members;
    case 'paying':
      return a.paying - b.paying;
    case 'profiles':
      return a.profiles - b.profiles;
    case 'live':
      return a.liveDeals - b.liveDeals;
    case 'new':
      return a.newDeals - b.newDeals;
    case 'status':
      return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
  }
}

/** A sorted copy. Ties fall back to the biggest gap, then more profiles, then area, kind and type. */
export function sortRows(rows: readonly DemandRow[], key: SortKey, dir: SortDir): DemandRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => compare(a, b, key) * sign || b.gap - a.gap || b.profiles - a.profiles || a.area.localeCompare(b.area) || a.kind.localeCompare(b.kind) || a.type.localeCompare(b.type));
}

// ── The plan, as the dry run and the admin page show it ──

export interface PlannedView {
  key: string;
  area: string;
  kind: DemandKind;
  members: number;
  paying: number;
  profiles: number;
  score: number;
  /** Screened on thin figures (1–4 analyser reports in the area). */
  early: boolean;
  /** The worst case this search would claim against the cap; 0 when a fresh answer is already cached. */
  estPence: number;
  /** Within the next pass's limit. */
  thisPass: boolean;
}

export function planView(plan: DemandPlan, reservePence: number, cached: ReadonlySet<string>, maxPerPass: number): { wouldSearch: PlannedView[]; skipped: Skipped[] } {
  return {
    wouldSearch: plan.searches.map((s, i) => ({ key: s.key, area: s.area, kind: s.kind, members: s.members, paying: s.paying, profiles: s.profiles, score: s.score, early: s.early, estPence: cached.has(s.key) ? 0 : reservePence, thisPass: i < maxPerPass })),
    skipped: plan.skipped,
  };
}
