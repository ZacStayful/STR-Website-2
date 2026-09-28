/**
 * The Monday backfill clean-up (Batch 16, Part D): 409 analyser_reports rows
 * read out of past Stayful analysis PDFs on 16 July, with no postcode, no
 * location and none of the comp_* columns filled, and some rows twice.
 *
 * RECOVERY. The full postcode is in the Monday item's address (every row
 * carries it); the comparables' figures are in raw_response. A lead's item
 * can hold several PDFs, and not all of them are for the item's own
 * address (one lead sent York, Clifton and Bradford), so where an item has
 * more than one file only a file whose name matches the address is given
 * the address's postcode; the rest are flagged and keep their area only.
 *
 * DUPLICATES. Two kinds are removed, each after being archived whole in
 * analyser_reports_removed:
 *   - exact duplicates: the same item with the same figures (bedrooms,
 *     revenue, ADR, occupancy) — the same analysis stored twice, whatever
 *     the file was called; the newest stays;
 *   - re-analyses: the same item and file with different figures; the last
 *     one inserted stays.
 * Different properties under one item stay.
 *
 * Pure: no network, no database, no server-only.
 */

export interface BackfillRow {
  id: string;
  created_at: string;
  item: string | null;
  filename: string | null;
  /** The Monday item's address (the analyser_reports.address column, or raw_response.address). */
  address: string | null;
  bedrooms: number | null;
  gross_revenue: number | null;
  adr: number | null;
  occupancy: number | null;
}

export type RemovalReason = 'exact_duplicate' | 'reanalysed';

export interface Removal {
  id: string;
  reason: RemovalReason;
  /** The row that stays in its place. */
  keptId: string;
}

const newestFirst = (a: BackfillRow, b: BackfillRow) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
const figuresKey = (r: BackfillRow) => [r.item ?? '', r.bedrooms ?? '', r.gross_revenue ?? '', r.adr ?? '', r.occupancy ?? ''].join('|');

/** Which rows go, and which row each one gives way to. */
export function planRemovals(rows: readonly BackfillRow[]): Removal[] {
  const out = new Map<string, Removal>();
  const group = (key: (r: BackfillRow) => string | null) => {
    const groups = new Map<string, BackfillRow[]>();
    for (const r of rows) {
      if (out.has(r.id)) continue;
      const k = key(r);
      if (k === null) continue;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    return [...groups.values()].filter((g) => g.length > 1).map((g) => [...g].sort(newestFirst));
  };
  // A row with no revenue (a failed extraction) is never anyone's duplicate.
  for (const [keep, ...rest] of group((r) => (r.item && r.gross_revenue !== null ? figuresKey(r) : null))) for (const r of rest) out.set(r.id, { id: r.id, reason: 'exact_duplicate', keptId: keep.id });
  for (const [keep, ...rest] of group((r) => (r.item && r.filename ? `${r.item}|${r.filename}` : null))) for (const r of rest) out.set(r.id, { id: r.id, reason: 'reanalysed', keptId: keep.id });
  return [...out.values()];
}

const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

/** The full postcode in an address, spaced and upper case; null when there is none. */
export function postcodeFromAddress(address: string | null | undefined): string | null {
  const m = POSTCODE.exec(address ?? '');
  return m ? `${m[1].toUpperCase()} ${m[2].toUpperCase()}` : null;
}

const GENERIC = new Set(['stayful', 'property', 'analysis', 'report', 'pdf', 'final', 'copy', 'version', 'flat', 'apartment', 'house', 'the', 'and', 'road', 'street', 'lane', 'avenue', 'close', 'drive', 'way', 'place', 'court', 'united', 'kingdom', 'england', 'uk']);

function words(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/\.pdf$/i, '')
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 3 && !GENERIC.has(w)),
  );
}

/** A file is for the item's address when its name shares at least two place words with it ("City_Walk__Holbeck__Leeds" and "5 City Walk, Leeds"). */
export function fileMatchesAddress(filename: string | null | undefined, address: string | null | undefined): boolean {
  if (!filename || !address) return false;
  const a = words(address);
  let shared = 0;
  for (const w of words(filename)) if (a.has(w)) shared += 1;
  return shared >= 2;
}

export type LocationPlan = { postcode: string } | { skip: 'no_postcode' | 'file_not_for_address' };

/**
 * Where a row can be put: the address's postcode, unless the item holds
 * several files and this one's name does not match the address.
 */
export function locationFor(row: BackfillRow, filesInItem: number): LocationPlan {
  const postcode = postcodeFromAddress(row.address);
  if (!postcode) return { skip: 'no_postcode' };
  if (filesInItem > 1 && !fileMatchesAddress(row.filename, row.address)) return { skip: 'file_not_for_address' };
  return { postcode };
}

export interface CompFields {
  comp_count: number | null;
  comp_radius_km: number | null;
  comp_avg_adr: number | null;
  /** A percentage, as the live analyser stores it. */
  comp_avg_occupancy: number | null;
  comp_avg_annual_revenue: number | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

/** The comparables' figures the PDF carried, in the live analyser's units. */
export function compFieldsFrom(raw: Record<string, unknown> | null | undefined): CompFields {
  const occ = num(raw?.comp_avg_occupancy);
  return {
    comp_count: num(raw?.comp_count),
    comp_radius_km: num(raw?.comp_radius_km),
    comp_avg_adr: num(raw?.comp_avg_adr),
    comp_avg_occupancy: occ === null ? null : occ > 0 && occ <= 1 ? Math.round(occ * 1000) / 10 : occ,
    comp_avg_annual_revenue: num(raw?.comp_avg_annual_revenue),
  };
}
