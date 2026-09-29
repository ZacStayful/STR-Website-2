/**
 * The daily paid checks (Batch 16, Part B): the rules behind a deal's own
 * comparables check, shared by the nightly job (checks-run.ts), the one-off
 * re-check of live deals (recheck-comps-run.ts), the absorber and every
 * re-screen.
 *
 * A qualifying listing no longer goes live on the area's average. It waits
 * as `pending_check` (the shortlist, invisible to members) until its turn:
 * each UK day the job takes `perDay` deals from the shortlist by stream
 * (billing_settings.deal_checks split; spare slots pass top areas → low
 * entry → rent-to-rent), searches Airbtics for similar homes at the
 * listing's own location (search.ts), reads the figures through the
 * analyser's pipeline, and re-screens the deal on them. A deal with too few
 * similar homes within the widest radius is never shown (insufficient
 * data); one that no longer qualifies retires as unqualified; the rest go
 * on to their entry page read (pending_verify) or straight live.
 *
 * The check is stored on the deal's own screening (`screening.check`), so
 * a later re-screen — a reprice, a revival, the hourly page read, the paid
 * open, the daily picks — keeps the checked figure for `validDays` instead
 * of falling back to the area average. Nothing here is a new column: a
 * database that has not run the Batch 16 schema section takes every row.
 *
 * House spend, every call through the broker, within `dailyCapPence` a UK
 * day whichever job spends it.
 *
 * Pure: no network, no database, no server-only.
 */
import type { SourcingKind } from '../listing/sourcing.ts';
import type { Confidence } from '../listing/screen.ts';
import type { DataQuality, ShortLetData } from '../types.ts';
import { DEAL_COMPS_SOURCE } from '../market/quality.ts';
import { typeBucket, type SubjectKind } from './comps.ts';
import { DAY_STREAMS, perStream, STREAMS, type Stream } from './streams.ts';
import type { DealChecksSettings } from './config.ts';

export const DEAL_CHECKS_KIND = 'deal_checks';
export const DEAL_RECHECK_KIND = 'deal_recheck';
/** provider_calls.action for the nightly checks and the one-off re-check (house spend). */
export const DEAL_CHECKS_ACTION = 'cron:deal-checks';
export const DEAL_RECHECK_ACTION = 'cron:deal-recheck';
/** A shortlisted deal whose search fails this many times retires as unverifiable. */
export const MAX_CHECK_ATTEMPTS = 3;
/** Google's geocode of a full postcode, raw pence (unit_costs google/geocode). */
export const GEOCODE_PENCE = 0.395;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What a check found, kept on the deal's screening (screening.check). */
export interface StoredCheck {
  checkedAt: string;
  /** Which job made it. */
  via: 'daily' | 'recheck';
  gross: number;
  adr: number;
  /** 0–1. */
  occupancy: number;
  /** The comparables the pipeline kept. */
  compCount: number;
  spreadPct: number | null;
  confidence: Confidence;
  radiusKm: number;
  calls: number;
  pence: number;
  /** The listing as it was checked: a change in either makes the check stale. */
  bedrooms: number;
  kind: SourcingKind;
  locationClass: string | null;
  /** The flat/house test left too few, so every kind was used. */
  kindRelaxed: boolean;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

/** The check a stored screening carries, defensively: anything malformed reads as no check. */
export function checkOf(screening: unknown): StoredCheck | null {
  if (!screening || typeof screening !== 'object') return null;
  const raw = (screening as { check?: unknown }).check;
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const gross = num(c.gross);
  const bedrooms = num(c.bedrooms);
  const checkedAt = typeof c.checkedAt === 'string' ? c.checkedAt : null;
  const confidence = c.confidence === 'high' || c.confidence === 'medium' || c.confidence === 'low' ? c.confidence : null;
  const kind = c.kind === 'sale' || c.kind === 'rent' ? c.kind : null;
  if (gross === null || gross <= 0 || bedrooms === null || !checkedAt || !Number.isFinite(Date.parse(checkedAt)) || !confidence || !kind) return null;
  return {
    checkedAt,
    via: c.via === 'recheck' ? 'recheck' : 'daily',
    gross,
    adr: num(c.adr) ?? 0,
    occupancy: num(c.occupancy) ?? 0,
    compCount: num(c.compCount) ?? 0,
    spreadPct: num(c.spreadPct),
    confidence,
    radiusKm: num(c.radiusKm) ?? 0,
    calls: num(c.calls) ?? 0,
    pence: num(c.pence) ?? 0,
    bedrooms,
    kind,
    locationClass: typeof c.locationClass === 'string' ? c.locationClass : null,
    kindRelaxed: c.kindRelaxed === true,
  };
}

/**
 * The check a re-screen may build on: made within `validDays`, for the same
 * kind and the same bedroom count the listing now states. Null otherwise,
 * and the re-screen falls back to the area figures.
 */
export function validCheckFor(check: StoredCheck | null, listing: { bedrooms: number | null; kind: SourcingKind }, validDays: number, now: Date): StoredCheck | null {
  if (!check) return null;
  const at = Date.parse(check.checkedAt);
  if (!Number.isFinite(at) || now.getTime() - at > validDays * DAY_MS || at > now.getTime() + DAY_MS) return null;
  if (check.kind !== listing.kind) return null;
  if (listing.bedrooms !== null && check.bedrooms !== listing.bedrooms) return null;
  return check;
}

/** Midnight at the start of the UK day (Europe/London) `now` falls in, as an instant. */
export function ukDayStart(now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const utcMidnight = Date.UTC(get('year'), get('month') - 1, get('day'));
  // London is UTC in winter and UTC+1 in summer: midnight London is that many hours before midnight UTC.
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }).format(new Date(utcMidnight)));
  return new Date(utcMidnight - (hour % 24) * 60 * 60 * 1000);
}

/** When a shortlisted deal is dropped if it has not been checked by then. */
export function shortlistExpiryAt(shortlistedAt: Date, s: Pick<DealChecksSettings, 'shortlistExpiryDays'>): string {
  return new Date(shortlistedAt.getTime() + s.shortlistExpiryDays * DAY_MS).toISOString();
}

/**
 * Today's check slots by stream: each stream's share of the day, no more
 * than it has waiting, and what a stream cannot use passes to the others in
 * the split's order (top areas, low entry, rent-to-rent). Never more than
 * `left`, the checks the day still allows.
 *
 * Batch 17: the Project stream is counted on its own (DAY_STREAMS): at most
 * `projectLeft` (its share of the day less what today's runs checked), never
 * from `left` and never sharing the spare.
 */
export function allocateSlots(split: DealChecksSettings['split'], waiting: Record<Stream, number>, left: number, projectLeft = 0): Record<Stream, number> {
  const out = perStream(() => 0);
  let spare = Math.max(0, Math.floor(left));
  for (const s of DAY_STREAMS) {
    out[s] = Math.max(0, Math.min(split[s], waiting[s] ?? 0, spare));
    spare -= out[s];
  }
  for (const s of DAY_STREAMS) {
    const more = Math.max(0, Math.min((waiting[s] ?? 0) - out[s], spare));
    out[s] += more;
    spare -= more;
  }
  out.project = Math.max(0, Math.min(split.project, waiting.project ?? 0, Math.floor(projectLeft)));
  return out;
}

/** The shortlist's order within a stream: the most profitable first, then the longest waiting. */
export function shortlistOrder<T extends { annual_profit: number | string | null; first_seen_at: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const pa = num(a.annual_profit) ?? Number.NEGATIVE_INFINITY;
    const pb = num(b.annual_profit) ?? Number.NEGATIVE_INFINITY;
    if (pa !== pb) return pb - pa;
    return a.first_seen_at.localeCompare(b.first_seen_at);
  });
}

/** What one run of a checking job did, as recorded in marketplace_runs. */
export interface CheckRunLike {
  startedAt: string;
  summary: unknown;
}

export interface DaySpend {
  runs: number;
  /** Checks completed today by stream (a figure written, or a deal retired on its figures). */
  checked: Record<Stream, number>;
  /** Raw pence the day's runs spent, calls and geocodes alike. */
  pence: number;
}

/** What today's runs (every checking job) have used of the day's budget. */
export function daySpend(runs: readonly CheckRunLike[], dayStart: Date): DaySpend {
  const out: DaySpend = { runs: 0, checked: perStream(() => 0), pence: 0 };
  const since = dayStart.getTime();
  for (const r of runs) {
    const at = Date.parse(r.startedAt);
    if (!Number.isFinite(at) || at < since) continue;
    const s = (r.summary && typeof r.summary === 'object' ? r.summary : {}) as Record<string, unknown>;
    out.runs += 1;
    out.pence += num(s.rawCostPence) ?? 0;
    const checked = s.checked && typeof s.checked === 'object' ? (s.checked as Record<string, unknown>) : {};
    for (const stream of STREAMS) out.checked[stream] += num(checked[stream]) ?? 0;
  }
  return out;
}

/** Whether one more call, at its worst-case price, fits under the day's cap. */
export function callAffordable(capPence: number, spentPence: number, worstPence: number): boolean {
  return spentPence + worstPence <= capPence + 1e-9;
}

/** The most one check can cost: its calls at the search's price, plus a geocode when the listing has no coordinates. */
export function worstCasePence(s: Pick<DealChecksSettings, 'maxCallsPerCheck'>, callPence: number, needsGeocode: boolean): number {
  return s.maxCallsPerCheck * callPence + (needsGeocode ? GEOCODE_PENCE : 0);
}

/** The comparables search's idea of the property, from the portal's type text. */
export function subjectKindFor(rawType: string | null | undefined): SubjectKind {
  const bucket = typeBucket({ property_type: rawType ?? null, room_and_property_type: null });
  return bucket === 'flat' || bucket === 'house' ? bucket : 'unknown';
}

export type CheckOutcome = 'shown' | 'insufficient' | 'unqualified';

/**
 * What a check means for the deal: no figure (too few similar homes within
 * the widest radius) → never shown; a figure that no longer clears the bar
 * → retired as unqualified; else shown.
 */
export function checkOutcome(hasFigure: boolean, qualifies: boolean): CheckOutcome {
  if (!hasFigure) return 'insufficient';
  return qualifies ? 'shown' : 'unqualified';
}

/** The figures a check found, as the pipeline gave them (search.ts CheckedFigures, without its data). */
export interface CheckFigures {
  gross: number;
  adr: number;
  /** 0–1. */
  occupancy: number;
  compCount: number;
  spreadPct: number | null;
  confidence: Confidence;
  locationClass: string | null;
}

export interface CheckSearchFacts {
  radiusKm: number;
  calls: number;
  pence: number;
  kindRelaxed: boolean;
}

/** The check as it is kept on the screening. */
export function storedCheckFrom(figures: CheckFigures, search: CheckSearchFacts, listing: { bedrooms: number; kind: SourcingKind }, via: StoredCheck['via'], checkedAt: Date): StoredCheck {
  return {
    checkedAt: checkedAt.toISOString(),
    via,
    gross: Math.round(figures.gross),
    adr: Math.round(figures.adr),
    occupancy: Math.round(figures.occupancy * 1000) / 1000,
    compCount: figures.compCount,
    spreadPct: figures.spreadPct === null ? null : Math.round(figures.spreadPct * 10) / 10,
    confidence: figures.confidence,
    radiusKm: search.radiusKm,
    calls: search.calls,
    pence: Math.round(search.pence * 100) / 100,
    bedrooms: listing.bedrooms,
    kind: listing.kind,
    locationClass: figures.locationClass,
    kindRelaxed: search.kindRelaxed,
  };
}

const mean = (values: number[]): number | null => {
  const ok = values.filter((v) => Number.isFinite(v) && v > 0);
  return ok.length === 0 ? null : Math.round((ok.reduce((s, v) => s + v, 0) / ok.length) * 100) / 100;
};

export interface ReportRowInput {
  dealId: string;
  checkedAt: string;
  /** The listing's outward code only: the row must not carry a full postcode or an address (see the module note). */
  outcode: string | null;
  postcodeArea: string | null;
  bedrooms: number;
  guests: number;
  lat: number;
  lng: number;
  check: StoredCheck;
  data: ShortLetData;
  quality: DataQuality;
}

/**
 * The analyser_reports row a check writes (source 'deal_comps', keyed on
 * the deal id so a re-check replaces it): the same shape the analyser
 * stores, so the area and district figures the free screening reads get
 * better as the checks run. It carries the outward code, never the full
 * postcode, the address or the listing: a deal's location stays behind
 * the paid open, and quality.ts keeps these rows out of the single-postcode
 * figure whatever they carry.
 */
export function reportRowFor(input: ReportRowInput): Record<string, unknown> {
  const comps = input.data.comparables ?? [];
  return {
    source: DEAL_COMPS_SOURCE,
    request_id: input.dealId,
    created_at: input.checkedAt,
    address: null,
    postcode: input.outcode ? input.outcode.trim().toUpperCase() : null,
    postcode_area: input.postcodeArea ? input.postcodeArea.trim().toUpperCase() : null,
    bedrooms: input.bedrooms,
    adr: input.check.adr,
    // The table mixes 0–1 and 0–100; the analyser writes a percentage.
    occupancy: Math.round(input.check.occupancy * 1000) / 10,
    gross_revenue: input.check.gross,
    net_revenue: null,
    comp_count: input.check.compCount,
    comp_radius_km: input.check.radiusKm,
    comp_avg_adr: mean(comps.map((c) => c.averageDailyRate)),
    comp_avg_occupancy: mean(comps.map((c) => (c.occupancyRate <= 1 ? c.occupancyRate * 100 : c.occupancyRate))),
    comp_avg_annual_revenue: mean(comps.map((c) => c.annualRevenue)),
    comp_avg_rating: mean(comps.map((c) => c.rating)),
    comp_avg_review_count: mean(comps.map((c) => c.reviewCount)),
    comp_avg_listing_age: mean(comps.map((c) => c.listingAge)),
    active_listings: input.data.activeListings > 0 ? input.data.activeListings : null,
    lat: input.lat,
    lng: input.lng,
    extraction_status: 'ok',
    raw_response: {
      shortLet: {
        annualRevenue: input.data.annualRevenue,
        monthlyRevenue: input.data.monthlyRevenue,
        occupancyRate: input.data.occupancyRate,
        averageDailyRate: input.data.averageDailyRate,
        activeListings: input.data.activeListings,
        comparables: comps,
        locationClass: input.data.locationClass ?? null,
        adrMultipliers: input.data.adrMultipliers ?? null,
        monthlyOccupancy: input.data.monthlyOccupancy ?? null,
      },
      dataQuality: input.quality,
      property: { bedrooms: input.bedrooms, guests: input.guests },
      dealCheck: { dealId: input.dealId, via: input.check.via, confidence: input.check.confidence, spreadPct: input.check.spreadPct, compCount: input.check.compCount, radiusKm: input.check.radiusKm, kindRelaxed: input.check.kindRelaxed },
    },
  };
}

/** One deal's result in a run's record and on the admin page: what it is and what happened, never where it is. */
export interface CheckResult {
  id: string;
  area: string | null;
  bedrooms: number | null;
  kind: SourcingKind;
  stream: Stream;
  /** Batch 17: 'held', a Project candidate checked and kept on the shortlist for the Project photo check. */
  outcome: 'pending_verify' | 'live' | 'held' | 'insufficient' | 'unqualified' | 'failed' | 'stopped';
  confidence: Confidence | null;
  comps: number | null;
  calls: number;
  pence: number;
  gross: number | null;
  /** The area figure it was screened on before the check, for the record. */
  areaGross: number | null;
  error?: string;
}
