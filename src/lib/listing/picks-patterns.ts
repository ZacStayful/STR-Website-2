/**
 * The admin store of pick responses: one row per answered pick with the
 * member, the listing and the answer, plus the pattern cuts the admin page
 * shows (reasons by kind, basis, price band, property type, size, area,
 * member and week). Pure; the rows are loaded by picks-server.ts.
 */
import type { PickBasis, PickReaction, PickReason, ReactionSource } from './picks.ts';
import { reasonLabel } from './picks.ts';
import type { SourcingKind } from './sourcing.ts';
import { propertyKind } from './suitability.ts';

export interface ResponseRow {
  id: string;
  userId: string;
  email: string | null;
  sentAt: string;
  respondedAt: string | null;
  reaction: PickReaction;
  reactionSource: ReactionSource;
  reasons: PickReason[];
  comment: string;
  kind: SourcingKind;
  basis: PickBasis;
  postcodeArea: string | null;
  areaName: string | null;
  title: string;
  address: string | null;
  url: string;
  bedrooms: number | null;
  rawType: string | null;
  tenure: string | null;
  /** Sale price or rent pcm. */
  amount: number | null;
  fit: number | null;
  /** Gross yield % (purchase) or monthly margin £ (rent-to-rent). */
  dealScore: number | null;
  savedAt: string | null;
}

export interface ResponseFilter {
  reaction?: PickReaction | null;
  reason?: PickReason | null;
  kind?: SourcingKind | null;
  basis?: PickBasis | null;
  area?: string | null;
  /** Case-insensitive match on the member's email, the address or the comment. */
  q?: string | null;
}

export function filterResponses(rows: ResponseRow[], f: ResponseFilter): ResponseRow[] {
  const q = f.q?.trim().toLowerCase() || null;
  const area = f.area?.trim().toUpperCase() || null;
  return rows.filter((r) => {
    if (f.reaction && r.reaction !== f.reaction) return false;
    if (f.reason && !r.reasons.includes(f.reason)) return false;
    if (f.kind && r.kind !== f.kind) return false;
    if (f.basis && r.basis !== f.basis) return false;
    if (area && (r.postcodeArea ?? '').toUpperCase() !== area) return false;
    if (q && !`${r.email ?? ''} ${r.address ?? ''} ${r.title} ${r.comment}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export interface ReasonCount {
  key: PickReason;
  label: string;
  count: number;
}

export interface Cut {
  label: string;
  yes: number;
  no: number;
  /** Share of answers that were a no, 0–100. */
  noRate: number;
  topReasons: ReasonCount[];
}

export interface MemberCut {
  userId: string;
  email: string | null;
  yes: number;
  no: number;
  reasons: ReasonCount[];
  lastAt: string;
}

export interface ResponsePatterns {
  total: number;
  yes: number;
  no: number;
  withReasons: number;
  withComment: number;
  linkOnly: number;
  reasons: (ReasonCount & { share: number })[];
  byKind: Cut[];
  byBasis: Cut[];
  byPrice: Cut[];
  byType: Cut[];
  bySize: Cut[];
  byArea: Cut[];
  members: MemberCut[];
  weekly: { week: string; yes: number; no: number; withReasons: number }[];
}

export function priceBand(kind: SourcingKind, amount: number | null): string {
  if (amount === null) return 'Price unknown';
  if (kind === 'rent') return amount < 800 ? 'Under £800 pcm' : amount < 1200 ? '£800–1,200 pcm' : amount < 2000 ? '£1,200–2,000 pcm' : '£2,000+ pcm';
  return amount < 150_000 ? 'Under £150k' : amount < 250_000 ? '£150–250k' : amount < 400_000 ? '£250–400k' : '£400k+';
}

export function typeBand(rawType: string | null, title: string): string {
  const kind = propertyKind(rawType, title);
  return kind === 'flat' ? 'Flats' : kind === 'house' ? 'Houses' : 'Other / unknown';
}

export function sizeBand(bedrooms: number | null): string {
  if (bedrooms === null) return 'Size unknown';
  return bedrooms >= 4 ? '4+ bed' : `${bedrooms} bed`;
}

/** ISO week key: the Monday of the week the response landed. */
export function weekOf(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

/** Below this an area's no rate is noise, so it sorts after the ones with real evidence. */
export const MIN_AREA_ANSWERS = 3;

function tally() {
  return { yes: 0, no: 0, reasons: new Map<PickReason, number>() };
}
type Tally = ReturnType<typeof tally>;

function bump(t: Tally, r: ResponseRow) {
  if (r.reaction === 'yes') {
    t.yes += 1;
    // Reasons belong to a no. A yes carrying them (an old row, or a member who
    // clicked yes after answering no) would push a share above 100%.
    return;
  }
  t.no += 1;
  for (const k of r.reasons) t.reasons.set(k, (t.reasons.get(k) ?? 0) + 1);
}

function topReasons(m: Map<PickReason, number>, limit = 3): ReasonCount[] {
  return [...m.entries()]
    .map(([key, count]) => ({ key, label: reasonLabel(key), count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

function cuts(groups: Map<string, Tally>, order?: string[]): Cut[] {
  const out = [...groups.entries()].map(([label, t]) => ({ label, yes: t.yes, no: t.no, noRate: t.yes + t.no > 0 ? Math.round((t.no / (t.yes + t.no)) * 100) : 0, topReasons: topReasons(t.reasons) }));
  if (order) return out.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
  return out.sort((a, b) => b.no - a.no || b.yes - a.yes || a.label.localeCompare(b.label));
}

export function patternsFromResponses(rows: ResponseRow[]): ResponsePatterns {
  const all = tally();
  const byKind = new Map<string, Tally>();
  const byBasis = new Map<string, Tally>();
  const byPrice = new Map<string, Tally>();
  const byType = new Map<string, Tally>();
  const bySize = new Map<string, Tally>();
  const byArea = new Map<string, Tally>();
  const byMember = new Map<string, MemberCut & { tally: Tally }>();
  const byWeek = new Map<string, { week: string; yes: number; no: number; withReasons: number }>();
  const get = (m: Map<string, Tally>, k: string) => {
    const t = m.get(k) ?? tally();
    m.set(k, t);
    return t;
  };
  let withReasons = 0;
  let withComment = 0;
  let linkOnly = 0;
  for (const r of rows) {
    bump(all, r);
    if (r.reasons.length > 0) withReasons += 1;
    if (r.comment.trim()) withComment += 1;
    if (r.reactionSource === 'link' && r.reasons.length === 0) linkOnly += 1;
    bump(get(byKind, r.kind === 'rent' ? 'Rent-to-rent' : 'To buy'), r);
    bump(get(byBasis, r.basis === 'house' ? 'House picks' : 'From a filter'), r);
    bump(get(byPrice, priceBand(r.kind, r.amount)), r);
    bump(get(byType, typeBand(r.rawType, r.title)), r);
    bump(get(bySize, sizeBand(r.bedrooms)), r);
    bump(get(byArea, r.areaName ? `${r.areaName} (${r.postcodeArea})` : (r.postcodeArea ?? 'Area unknown')), r);
    const at = r.respondedAt ?? r.sentAt;
    const m = byMember.get(r.userId) ?? { userId: r.userId, email: r.email, yes: 0, no: 0, reasons: [], lastAt: at, tally: tally() };
    bump(m.tally, r);
    if (at > m.lastAt) m.lastAt = at;
    byMember.set(r.userId, m);
    const wk = weekOf(at);
    const w = byWeek.get(wk) ?? { week: wk, yes: 0, no: 0, withReasons: 0 };
    if (r.reaction === 'yes') w.yes += 1;
    else w.no += 1;
    if (r.reasons.length > 0) w.withReasons += 1;
    byWeek.set(wk, w);
  }
  const total = rows.length;
  return {
    total,
    yes: all.yes,
    no: all.no,
    withReasons,
    withComment,
    linkOnly,
    reasons: topReasons(all.reasons, 50).map((r) => ({ ...r, share: all.no > 0 ? Math.round((r.count / all.no) * 100) : 0 })),
    byKind: cuts(byKind, ['To buy', 'Rent-to-rent']),
    byBasis: cuts(byBasis, ['From a filter', 'House picks']),
    byPrice: cuts(byPrice, ['Under £150k', '£150–250k', '£250–400k', '£400k+', 'Under £800 pcm', '£800–1,200 pcm', '£1,200–2,000 pcm', '£2,000+ pcm', 'Price unknown']),
    byType: cuts(byType, ['Houses', 'Flats', 'Other / unknown']),
    bySize: cuts(bySize, ['1 bed', '2 bed', '3 bed', '4+ bed', 'Size unknown']),
    // Worst first means worst RATE, with a floor on answers so one bad week
    // for a busy area does not outrank an area nobody ever wants.
    byArea: cuts(byArea)
      .sort((a, b) => (b.yes + b.no >= MIN_AREA_ANSWERS ? b.noRate : -1) - (a.yes + a.no >= MIN_AREA_ANSWERS ? a.noRate : -1) || b.no - a.no)
      .slice(0, 15),
    members: [...byMember.values()]
      .map(({ tally: t, ...m }) => ({ ...m, yes: t.yes, no: t.no, reasons: topReasons(t.reasons) }))
      .filter((m) => m.yes + m.no >= 2)
      .sort((a, b) => b.no - a.no || b.yes - a.yes)
      .slice(0, 25),
    weekly: [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week)).slice(-12),
  };
}

function csvCell(v: string | number | null): string {
  if (v === null) return '';
  let s = String(v);
  // Excel runs a cell beginning =, +, - or @ as a formula. Members type the
  // comment column, so prefix those with an apostrophe before quoting.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The store as a spreadsheet: one row per response, newest first as given. */
export function responsesCsv(rows: ResponseRow[]): string {
  const head = ['responded_at', 'sent_at', 'email', 'reaction', 'source', 'reasons', 'comment', 'kind', 'basis', 'area', 'address', 'title', 'bedrooms', 'type', 'tenure', 'amount', 'fit', 'deal_score', 'saved', 'url'];
  const lines = rows.map((r) =>
    [r.respondedAt, r.sentAt, r.email, r.reaction, r.reactionSource, r.reasons.map(reasonLabel).join('; '), r.comment, r.kind, r.basis, r.postcodeArea, r.address, r.title, r.bedrooms, r.rawType, r.tenure, r.amount, r.fit, r.dealScore, r.savedAt ? 'yes' : 'no', r.url]
      .map(csvCell)
      .join(','),
  );
  return [head.join(','), ...lines].join('\r\n') + '\r\n';
}
