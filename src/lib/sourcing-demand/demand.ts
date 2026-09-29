/**
 * The demand list: which postcode areas, and which kind (buy / rent-to-rent),
 * the members' running saved profiles want, and which of those the
 * demand-led searches should take on.
 *
 * Who counts: members not left out by Batch 9's rule (admin emails,
 * @stayful.co.uk, the manual switch-off list) and seen in the app within
 * `activeDays`. A team counts once, as the account that pays, and "paying"
 * means that account is paying now.
 *
 * What a profile wants follows its "where should we look?" answer:
 *   anywhere        nothing at all (the brief: "most profitable anywhere"
 *                   adds no areas)
 *   areas           the areas it chose
 *   near, near + best elsewhere
 *                   the home area plus up to `radiusAreas` of the nearest
 *                   areas inside the radius (the "best elsewhere" part adds
 *                   nothing: it is not a place)
 *   not answered    older profiles: the areas chosen, plus home and radius
 *                   when both are set; neither means anywhere
 * A profile that adds anything also adds the member's existing units
 * (about_you.unitAreas) and a company's operating areas, and never more than
 * `maxAreasPerProfile` in all (chosen and unit areas first).
 *
 * An area × kind is added once at least `minMembers` members want it and
 * the marketplace sweep does not already cover it. Order: free members plus
 * paying members × `payingWeight`, then more profiles, then fewer live
 * deals, then the area code.
 *
 * Pure: no network, no database, no server-only.
 */
import { AREA_META } from '../market/areas.ts';
import { areaCentroid } from '../market/area-centroids.ts';
import { haversineMiles } from '../market/geo.ts';
import { areaCodeFrom } from '../market/lead-goals.ts';
import { areaCodeList, type MarketGoals } from '../market/goals.ts';
import { queryKey } from '../listing/sourcing.ts';
import { exclusionFor } from '../activity/metrics.ts';
import { emailKey } from '../supabase/email-key.ts';
import { DEFAULT_ABOUT, type AboutYou } from '../profile/about.ts';
import { dealTypesFor, kindsFor } from '../profile/deal-types.ts';

export type DemandKind = 'sale' | 'rent';
export type DemandType = 'house' | 'flat' | 'any';

export const DEMAND_KINDS: readonly DemandKind[] = ['sale', 'rent'];
export const DEMAND_TYPES: readonly DemandType[] = ['house', 'flat', 'any'];

/** One member, as the demand list sees them. */
export interface DemandMember {
  id: string;
  email: string | null;
  lastSeenAt: string | null;
  /** The account that pays: the team owner for a team member, else the member. Teams count once, by this. */
  payerId: string;
  /** The paying account is paying now (src/lib/access.ts isPaid). */
  paying: boolean;
  /** Postcode areas of the units they run now (Batch 12's about_you.unitAreas). */
  unitAreas: string[];
  /** Batch 17: the roles they ticked (about_you.roles), for a profile not yet on deal types. */
  roles?: AboutYou['roles'];
  /** On Batch 9's manual switch-off list (activity_excluded_accounts). */
  switchedOff: boolean;
}

/** One running profile, or the one set of answers a member with no profile rows has. */
export interface DemandProfile {
  memberId: string;
  profileId: string | null;
  goals: MarketGoals | null;
  /** The areas it chose: search_profiles.areas, or saved_areas for a member with no profile rows. */
  areas: string[];
}

export interface EligibilityOptions {
  adminEmails: readonly string[];
  activeDays: number;
  now: Date;
}

export type LeftOut = 'staff' | 'inactive';

/** Why a member is left out of the demand list, or null when they count. */
export function leftOut(m: Pick<DemandMember, 'email' | 'lastSeenAt' | 'switchedOff'>, opts: EligibilityOptions): LeftOut | null {
  const admins = new Set(opts.adminEmails.map(emailKey));
  if (exclusionFor(m.email, m.switchedOff ? null : undefined, admins) !== null) return 'staff';
  const seen = m.lastSeenAt ? Date.parse(m.lastSeenAt) : Number.NaN;
  if (!Number.isFinite(seen) || opts.now.getTime() - seen > opts.activeDays * 24 * 60 * 60 * 1000) return 'inactive';
  return null;
}

/** The home area plus up to `radiusAreas` of the nearest areas whose centre is inside the radius. */
export function nearAreas(goals: MarketGoals, radiusAreas: number): string[] {
  if (!goals.home) return [];
  const homeArea = areaCodeFrom(goals.home.postcode);
  const out: string[] = homeArea ? [homeArea] : [];
  // A home not yet placed on the map stands in at its postcode area's centre, as the quiz preview does.
  const point = goals.home.lat !== null && goals.home.lng !== null ? { lat: goals.home.lat, lng: goals.home.lng } : homeArea ? areaCentroid(homeArea) : null;
  const miles = goals.maxDistanceMiles;
  if (!point || !miles || radiusAreas <= 0) return out;
  const near = AREA_META.map((a) => a.code)
    .filter((code) => code !== homeArea)
    .map((code) => ({ code, centre: areaCentroid(code) }))
    .filter((x): x is { code: string; centre: { lat: number; lng: number } } => x.centre !== null)
    .map((x) => ({ code: x.code, miles: haversineMiles(point, x.centre) }))
    .filter((x) => x.miles <= miles)
    .sort((a, b) => a.miles - b.miles || a.code.localeCompare(b.code))
    .slice(0, radiusAreas)
    .map((x) => x.code);
  return [...out, ...near];
}

export interface AreaOptions {
  radiusAreas: number;
  maxAreasPerProfile: number;
}

/** The postcode areas one profile wants (see the header for the rules). Empty for "anywhere" and for no answers yet. */
export function profileAreas(profile: Pick<DemandProfile, 'goals' | 'areas'>, unitAreas: readonly string[], opts: AreaOptions): string[] {
  const g = profile.goals;
  if (!g || g.where === 'anywhere') return [];
  const chosen = areaCodeList(profile.areas);
  let base: string[];
  if (g.where === 'areas') base = chosen;
  else if (g.where === 'near' || g.where === 'near_plus_best') base = nearAreas(g, opts.radiusAreas);
  else base = [...chosen, ...(g.home && g.maxDistanceMiles ? nearAreas(g, opts.radiusAreas) : [])];
  if (base.length === 0) return [];
  const ordered = [...chosen.filter((a) => base.includes(a)), ...areaCodeList(unitAreas), ...areaCodeList(g.manager.operatingAreas), ...base];
  return [...new Set(ordered)].slice(0, Math.max(0, opts.maxAreasPerProfile));
}

/**
 * The kinds a profile's deal types search (Batch 17, the one helper every
 * "which deal types" decision goes through): Short-let and BRRR are sales,
 * Rent-to-rent a rental. A profile with no types yet: Short-let +
 * Rent-to-rent, what it is shown (Q22).
 */
export function kindsOf(goals: MarketGoals, roles: AboutYou['roles'] = []): DemandKind[] {
  const kind = kindsFor(dealTypesFor({ goals, about: roles.length > 0 ? { ...DEFAULT_ABOUT, roles } : null }));
  return kind === 'both' ? ['sale', 'rent'] : [kind];
}

/** House, flat or either. Only buyers answer it; a rent-to-rent search takes either. */
export function typeOf(goals: MarketGoals, kind: DemandKind): DemandType {
  if (kind !== 'sale') return 'any';
  const t = goals.buyer.propertyType;
  return t === 'house' || t === 'flat' ? t : 'any';
}

interface Tally {
  members: Set<string>;
  paying: Set<string>;
  profiles: number;
}

const tally = (): Tally => ({ members: new Set(), paying: new Set(), profiles: 0 });

/** What members want of one area × kind. Members are counted by the account that pays. */
export interface DemandCell {
  area: string;
  kind: DemandKind;
  members: Set<string>;
  paying: Set<string>;
  profiles: number;
  /** The same, split by the property type the profile wants. */
  byType: Record<DemandType, Tally>;
  /** The must-haves behind it, for the admin page: budget band (buying), rent ceiling (rent-to-rent), bedrooms. */
  budgets: Map<string, number>;
  maxRents: number[];
  bedrooms: Map<number, number>;
}

export interface DemandSummary {
  /** Members whose profiles were read (seen in the window, not staff). */
  members: number;
  /** Running profiles read, and how many of them add no areas (anywhere, or no answers yet). */
  profiles: number;
  profilesWithoutAreas: number;
  leftOut: Record<LeftOut, number>;
}

export interface Demand {
  cells: Map<string, DemandCell>;
  summary: DemandSummary;
}

export function cellKey(area: string, kind: DemandKind): string {
  return `${area}|${kind}`;
}

export function buildDemand(members: readonly DemandMember[], profiles: readonly DemandProfile[], opts: EligibilityOptions & AreaOptions): Demand {
  const counted = new Map<string, DemandMember>();
  const summary: DemandSummary = { members: 0, profiles: 0, profilesWithoutAreas: 0, leftOut: { staff: 0, inactive: 0 } };
  for (const m of members) {
    const why = leftOut(m, opts);
    if (why) summary.leftOut[why] += 1;
    else counted.set(m.id, m);
  }
  summary.members = counted.size;
  const cells = new Map<string, DemandCell>();
  for (const p of profiles) {
    const m = counted.get(p.memberId);
    if (!m) continue;
    summary.profiles += 1;
    const areas = profileAreas(p, m.unitAreas, opts);
    if (areas.length === 0 || !p.goals) {
      summary.profilesWithoutAreas += 1;
      continue;
    }
    for (const kind of kindsOf(p.goals, m.roles ?? [])) {
      const type = typeOf(p.goals, kind);
      for (const area of areas) {
        const key = cellKey(area, kind);
        let c = cells.get(key);
        if (!c) {
          c = { area, kind, members: new Set(), paying: new Set(), profiles: 0, byType: { house: tally(), flat: tally(), any: tally() }, budgets: new Map(), maxRents: [], bedrooms: new Map() };
          cells.set(key, c);
        }
        c.members.add(m.payerId);
        if (m.paying) c.paying.add(m.payerId);
        c.profiles += 1;
        const t = c.byType[type];
        t.members.add(m.payerId);
        if (m.paying) t.paying.add(m.payerId);
        t.profiles += 1;
        if (kind === 'sale' && p.goals.budget) c.budgets.set(p.goals.budget, (c.budgets.get(p.goals.budget) ?? 0) + 1);
        if (kind === 'rent' && p.goals.maxRentPcm) c.maxRents.push(p.goals.maxRentPcm);
        if (p.goals.bedrooms) c.bedrooms.set(p.goals.bedrooms, (c.bedrooms.get(p.goals.bedrooms) ?? 0) + 1);
      }
    }
  }
  return { cells, summary };
}

/** Free members plus paying members × the weight: the order searches go in. */
export function demandScore(cell: Pick<DemandCell, 'members' | 'paying'>, payingWeight: number): number {
  return cell.members.size - cell.paying.size + cell.paying.size * payingWeight;
}

/**
 * How much members want each area, for the marketplace sweep's order
 * (sweep-plan.ts): wanted areas go first. Any demand counts here, not only
 * areas past the threshold: this orders searches the sweep makes anyway.
 */
export function areaScores(demand: Demand, payingWeight: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of demand.cells.values()) out.set(c.area, Math.max(out.get(c.area) ?? 0, demandScore(c, payingWeight)));
  return out;
}

/** What the demand-led searches can see about an area's screening data. */
export interface AreaData {
  /** Has a card whose figures can screen a listing. */
  screenable: boolean;
  /** 1–4 analyser reports: screened on thin figures. */
  early: boolean;
}

export type SkipReason = 'below_threshold' | 'in_sweep' | 'no_data' | 'searched_today' | 'no_answer_today';

export interface PlannedSearch {
  area: string;
  kind: DemandKind;
  key: string;
  members: number;
  paying: number;
  profiles: number;
  score: number;
  early: boolean;
}

export interface Skipped {
  area: string;
  kind: DemandKind;
  reason: SkipReason;
  members: number;
}

/** One of today's demand_searches rows. */
export interface TodayRow {
  query_key: string;
  status: string;
}

export interface TodayKeys {
  /** Reserved or answered today: not searched again until tomorrow. */
  searched: Set<string>;
  /** No answer (unavailable, or failed) `maxNoAnswer` times today and never answered: left until tomorrow. */
  gaveUp: Set<string>;
}

/** What today's searches rule out for the rest of the day. */
export function summariseToday(rows: readonly TodayRow[], maxNoAnswer: number): TodayKeys {
  const searched = new Set<string>();
  const noAnswer = new Map<string, number>();
  for (const r of rows) {
    if (r.status === 'reserved' || r.status === 'answered') searched.add(r.query_key);
    else if (r.status === 'unavailable' || r.status === 'failed') noAnswer.set(r.query_key, (noAnswer.get(r.query_key) ?? 0) + 1);
  }
  const gaveUp = new Set([...noAnswer].filter(([key, n]) => n >= maxNoAnswer && !searched.has(key)).map(([key]) => key));
  return { searched, gaveUp };
}

export interface PlanOptions {
  minMembers: number;
  payingWeight: number;
  /** Areas the marketplace sweep covers (empty when the sweep is switched off). */
  sweepAreas: ReadonlySet<string>;
  areaData: ReadonlyMap<string, AreaData>;
  /** Query keys already reserved or answered today. */
  searchedToday: ReadonlySet<string>;
  /** Query keys that got no answer too often today (summariseToday): left until tomorrow. */
  gaveUpToday: ReadonlySet<string>;
  /** Live deals per cellKey, the tie-break. */
  liveDeals: ReadonlyMap<string, number>;
}

export interface DemandPlan {
  /** Every search the demand list asks for today, most wanted first. */
  searches: PlannedSearch[];
  skipped: Skipped[];
}

export function planSearches(demand: Demand, opts: PlanOptions): DemandPlan {
  const searches: PlannedSearch[] = [];
  const skipped: Skipped[] = [];
  for (const c of demand.cells.values()) {
    const members = c.members.size;
    const key = queryKey(c.kind, c.area, null, null, null);
    const skip = (reason: SkipReason) => skipped.push({ area: c.area, kind: c.kind, reason, members });
    if (members < opts.minMembers) skip('below_threshold');
    else if (opts.sweepAreas.has(c.area)) skip('in_sweep');
    else if (!opts.areaData.get(c.area)?.screenable) skip('no_data');
    else if (opts.searchedToday.has(key)) skip('searched_today');
    else if (opts.gaveUpToday.has(key)) skip('no_answer_today');
    else searches.push({ area: c.area, kind: c.kind, key, members, paying: c.paying.size, profiles: c.profiles, score: demandScore(c, opts.payingWeight), early: opts.areaData.get(c.area)?.early ?? false });
  }
  const live = (s: PlannedSearch) => opts.liveDeals.get(cellKey(s.area, s.kind)) ?? 0;
  searches.sort((a, b) => b.score - a.score || b.profiles - a.profiles || live(a) - live(b) || a.area.localeCompare(b.area) || (a.kind === b.kind ? 0 : a.kind === 'sale' ? -1 : 1));
  skipped.sort((a, b) => b.members - a.members || a.area.localeCompare(b.area) || a.kind.localeCompare(b.kind));
  return { searches, skipped };
}
