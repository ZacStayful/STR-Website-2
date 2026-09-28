import "server-only";

import { createAdminClient } from "../supabase/admin";
import { getAreaCardsWithin } from "../market/cached";
import { parseMarketGoals, describeGoals, type MarketGoals } from "../market/goals";
import { personaliseScore, personalInputFor } from "../market/personalise";
import { areaCentroid } from "../market/area-centroids";
import { ask, sourcingListings } from "../broker";
import { runMetered, newActionId } from "../credit/context";
import { getBalance, debit } from "../credit/ledger";
import { payerIn } from "../team";
import { getUnitCostTable } from "../credit/unit-costs";
import { afterDebit } from "../credit/after-debit";
import { isAdminEmail } from "../admin";
import { isPaused, hasEverPaid, PAID_TIER_COLUMNS, type PaidTierAccount } from "../access";
import { dealVisibility, dealVisible, PAID_VISIBILITY } from "../marketplace/visibility";
import { queriesForGoals, dealForSourced, rankPicks, withinQueryPrice, listingAge, medianAgeDays, rentPcm, areaRevenueFor, type AreaRef, type SourcedListing, type SourcingQuery, type SourcedPick } from "./sourcing";
import { motivationFromListing, motivationFromSnapshot, meetsMotivationBar, NO_MOTIVATION, type Motivation } from "./motivation";
import { analyseRelaxation, closestMatch, describeRelaxation, toStoredRelaxation, type Dimension, type NearMiss, type Relaxation } from "./relax";
import { indexCohorts, lookupCohorts, type CohortMember } from "./cohorts";
import { fetchCohorts, sourcedPropertiesConfigured } from "../apis/propertydata-sourced";
import { blendFit } from "./pipeline";
import { thresholdDaysFor, type MotivationGoals } from "../market/goals";
import { houseQueries, applyQueryFeedback, feedbackRules, pickSection, pickPrice, newPickToken, startOfTodayUtc, addUnlocked, type PickBasis, type PickFeedback } from "./picks";
import { rankForMember, toPickFeedback, FEEDBACK_WINDOW_MS } from "./rank";
import { missedRowFor } from "./picks-paused";
import { mergeFeedback, type FeedbackEntry } from "../marketplace/reactions";
import { dealFeedbackFor } from "../marketplace/reactions-server";
import { isSendable, parseScreening, type Band, type Screening } from "./screen";
import { storedAreaRentTable } from "../broker/providers/internal";
import { screenSourced, mergeSnapshotIntoListing } from "../marketplace/record";
import { openPricePence } from "../marketplace/ladder";
import { getBillingSettings } from "../credit/unit-costs";
import { resolveListing } from "./server";
import { suitabilityFromListing, suitabilityFromSnapshot, type Suitability, type UnsuitableReason } from "./suitability";
import type { ListingSnapshot } from "./types";
import type { AppliedRules } from "./picks";
import { sendEmail, isEmailConfigured } from "../email/send";
import { buildDaily, type ProfileDeals, type Unsubscribe } from "../notify/message";
import { renderEmail } from "../notify/render-email";
import { claimSlot, finishSend, markSending, releaseClaim, slotsInUse } from "../notify/sends";
import { capDay, sendKey, testSendKey } from "../notify/cap";
import { pendingChanges, trackedAlertsOn } from "../notify/alerts-server";
import { teasersFrom, todayPlans, type TodayPlan } from "../notify/daily-server";
import { dailyDealsMode, PayerPurse } from "./daily-deals";
import { cardRangeLine, profitRange } from "../marketplace/profit-range";
import { chargeDailyDeals, payersForCharging } from "./daily-deals-server";
import { profileNudgesFor } from "../profile/server";
import { allProfilesFor } from "../profiles/server";
import { labelFor, profileLinks, seatKey, seatsFor, type SavedProfile } from "../profiles/rules";
import { GOALS_EDITOR_HREF } from "../nav";
import { closingIds, type Settled } from "../notify/alerts";
import type { MemberContext } from "../today/selection";
import { tailoringForSeats } from "../tailoring/server";
import type { TailoringProfile } from "../tailoring/profile";
import { siteUrl } from "../url";

// ─── Daily picks: the run ─────────────────────────────────────────────
// Every member with picks on (profiles.sourcing_alerts, default on) who has
// signed in at least once gets AT MOST ONE listing a day: paused
// subscriptions, members already sent today and members with less than one
// pick's worth of credit are skipped.
//
// Members with a usable filter (market_goals with areas) are searched on it;
// everyone else gets a "house" pick from the best-scoring areas, using their
// own kind / budget / bedrooms when they have goals but no areas. Identical
// queries are shared across members and answered once a day by the broker
// (PMI listings, then an OnTheMarket results page) as house spend. Listings
// first seen in the last week that the member has not been sent are priced
// on area figures, filtered by the member's confirmed feedback, ranked by fit,
// and the best one that passes the short-let suitability check (no rooms,
// no shared ownership, no leasehold without letting permission: see
// suitability.ts) is emailed. A pick's listing page is read before the send
// so the verdict comes from the page itself, not just the search card. The
// pick row is inserted BEFORE the send
// (status pending → sent / failed): the (user, url) primary key plus the
// "sent today" guard mean an overlapping run or a crash mid-send can never
// produce two picks. After a successful send the member is charged: before
// billing_settings.new_pricing_from, the pick (a pool deal's ladder price,
// else one daily_pick unit); from that date, one day of daily deals
// (todays_5_daily_pence) for the whole of Today's 5, with the pick included
// (src/lib/listing/daily-deals.ts). Admins are never charged. A payer's
// balance is spent in order across every member it pays for, so teammates
// cannot between them overdraw their owner.
//
// Saved profiles (Batch 13): every running profile is a seat of its own:
// its own candidates, pick, Today list and daily charge, and its own
// section of the member's ONE daily email (active profile first). No listing
// is picked for two of a member's profiles, and no deal is told twice in the
// email. When credit runs out part-way, the profiles at the end of the order
// miss the day (recorded per profile) and the email names them.
//
// Entry points: /api/internal/sourcing (the cron, secret-gated) and the
// admin page's "send me a test pick" / "dry run" buttons (session-gated).

/** All budgets count from function entry: the route's maxDuration is 60 s and a pass must never be killed mid-send. */
const TIME_BUDGET_MS = 50_000;
/** How long to wait for the market snapshot; on a cold cache the build keeps running for the next pass. */
const SNAPSHOT_WAIT_MS = 20_000;
/** The query phase stops here so the send loop always gets time. */
const QUERY_BUDGET_MS = 30_000;
/** Page verification of picks (one page fetch per distinct listing) stops here. */
const VERIFY_UNTIL_MS = 40_000;
/**
 * The send loop waits for Today's lists (chosen while verification waits on
 * the network) at most until here; a member whose list is not ready by then
 * gets their pick and changes without teasers rather than a delayed send.
 */
const DAILY_READY_BY_MS = 44_000;
const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** How far down a member's ranking the pick may reach when better candidates are capped or unsuitable. */
const SPREAD_DEPTH = 40;
/** How many members may receive the same listing in one day (across passes). */
const DAILY_LISTING_CAP = 3;
/**
 * A listing in one of these states cannot be acted on, so it is never sent.
 * `under_offer` is deliberately absent: chains collapse, and a sale that fell
 * through is a reason to look harder, not to hide the listing. The
 * marketplace pool takes the opposite view (see marketplace/status.ts) and
 * retires an under-offer listing, so a pick drawn from the pool never sees
 * one; only a broker-answered pick for an uncovered area still can.
 */
const GONE_STATUSES: ReadonlySet<string> = new Set(["sold", "let_agreed", "removed"]);
/** How many already-verified stand-ins to keep per member in case the send collides. */
const MAX_ALTERNATES = 3;
/**
 * The back catalogue a motivated filter may reach into, per run. The whole
 * point of the filter is listings that have been sitting a long time, and those
 * are by definition older than the new-listing window every other pick obeys.
 * Capped and ordered by last sighting so the sweep rotates instead of grinding
 * over the same rows, and floored so it never trawls years of dead stock.
 */
const MOTIVATED_POOL_LIMIT = 600;
/**
 * The cohort feed costs one credit per cohort per area, so it is bounded twice:
 * by how many areas one run will ask about, and by a time budget, because it
 * runs before the queries that the picks themselves depend on.
 */
const COHORT_AREAS_PER_RUN = 12;
const COHORT_RADIUS_MILES = 10;
const COHORT_UNTIL_MS = 12_000;
const MOTIVATED_POOL_FLOOR_MS = 18 * 30 * 24 * 60 * 60 * 1000;
const PAGE = 1000;
const ID_CHUNK = 100;
const URL_CHUNK = 150;

function maxQueries(): number {
  const n = Number(process.env.SOURCING_MAX_QUERIES_PER_RUN ?? 150);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 150;
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

type ProfileRow = PaidTierAccount & {
  id: string;
  email: string | null;
  market_goals: unknown;
  plan_code: string | null;
  subscription_paused_from: string | null;
  subscription_paused_until: string | null;
  sourcing_last_sent_at: string | null;
};

/**
 * One seat in the run: a member's running saved profile (Batch 13), or the
 * member themselves when they have no profile row (seatKey). Everything the
 * member has once (email, slot, tier, payer) is keyed by `id`; everything a
 * profile has of its own (candidates, pick, Today list, charge, miss) by `key`.
 */
interface Member {
  id: string;
  key: string;
  /** The saved profile this seat is for; null: the member as one seat, as before this batch. */
  profile: SavedProfile | null;
  /** The profile's name as its section heading, once the member has two or more. */
  heading: string | null;
  /** The profile's "specific areas" (saved_areas for a seat with no profile). */
  areas: string[];
  email: string;
  admin: boolean;
  /** Has the paying account (their own, or their team owner's) ever paid? Decides early access to pool deals. */
  paid: boolean;
  goals: MarketGoals | null;
  basis: PickBasis;
  firstEver: boolean;
  queries: SourcingQuery[];
  areaFit: Map<string, number | null>;
  /** What this member's own answers changed, after contradictions cancel. */
  rules: AppliedRules;
}

type Candidate = { listing: SourcedListing; deal: ReturnType<typeof dealForSourced>; areaFit: number | null; areaName: string; motivation?: Motivation | null; motivationQualifies?: boolean; screening?: Screening | null };
type Verdict = Exclude<Suitability, "unknown"> | "unverified" | "gone";

export interface RunOptions {
  /** Report who would get what; write and send nothing. */
  dry: boolean;
  /** Restrict the audience to these members (the admin "send me a test pick" button). */
  onlyUserIds?: string[];
  /** Skip the one-a-day guard (admin test only; the (user, url) key still blocks a repeat listing). */
  ignoreToday?: boolean;
}

export interface RunResult {
  status: number;
  body: Record<string, unknown>;
}

export function sendingEnabled(): boolean {
  return process.env.SOURCING_ENABLED !== "false";
}

/**
 * One daily-picks run. Called by the cron route (every enrolled member) and by
 * the admin page (one member, or a dry run). The caller decides who may run it.
 */
export async function runDailyPicks(opts: RunOptions): Promise<RunResult> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const done = (result: RunResult): RunResult => {
    // One line per pass in the Vercel logs: what was answered, verified, rejected and sent.
    const lists = new Set(["skipped", "members", "wouldQuery", "wouldEmail"]);
    const rest = Object.fromEntries(Object.entries(result.body).filter(([k]) => !lists.has(k)));
    console.log("[sourcing] run", JSON.stringify({ status: result.status, ms: elapsed(), ...rest }));
    return result;
  };
  const { dry } = opts;
  const enabled = sendingEnabled();
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return done({ status: 503, body: { error: "Storage not configured" } });
  }
  const nowIso = new Date().toISOString();
  const todayIso = startOfTodayUtc().toISOString();

  // A cold snapshot build (hundreds of PropertyData calls) can take most of a
  // minute; wait a bounded time, then let it finish in the background for the
  // next pass rather than be killed at maxDuration mid-send.
  const cards = await getAreaCardsWithin(SNAPSHOT_WAIT_MS);
  if (cards === null) return done({ status: 503, body: { error: "snapshot_warming", detail: "Market snapshot still building; the next pass will use it" } });
  if (cards.length === 0) return done({ status: 503, body: { error: "Market data unavailable; nothing sent" } });
  const cardByCode = new Map(cards.map((c) => [c.code, c]));
  const price = pickPrice(await getUnitCostTable());
  // Long-let rents we have already paid for, read back from past reports: the
  // free tier of the income screening's rent ladder. One read for the whole run.
  const rentTable = await storedAreaRentTable().catch((err) => {
    // A rent we cannot look up degrades the screening to the national ladder; it
    // must never cost the whole run.
    console.warn("[sourcing] stored rent table failed:", (err as Error)?.message ?? err);
    return new Map<string, { monthlyRent: number; samples: number }>();
  });
  const pickBasePence = price.basePence;
  // A pick drawn from the marketplace pool is an auto-open: it unlocks the deal
  // sheet and is charged the deal's ladder price, not the flat pick price.
  const settings = await getBillingSettings();
  const ladder = settings.dealOpenLadder;
  // Before the new pricing date the pick is charged; from it, the day is (33p on a plan).
  const mode = dailyDealsMode(settings.dealPricing, new Date());
  const dailyPence = settings.dealPricing.todays5DailyPence;
  const poolCutoffIso = new Date(Date.now() - NEW_WINDOW_MS).toISOString();
  // Early access: a pool deal inside its window is not a pick for an account
  // that has never paid, exactly as it is not on their grid.
  const freeVisibility = dealVisibility("free", new Date(), settings.freeDealDelayHours);

  // ── Audience: picks on, signed in at least once; starved members first ──
  const profiles: ProfileRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = admin
      .from("profiles")
      .select(`id, email, market_goals, subscription_paused_from, subscription_paused_until, sourcing_last_sent_at, ${PAID_TIER_COLUMNS}`)
      .eq("sourcing_alerts", true)
      .not("welcome_checked_at", "is", null);
    if (opts.onlyUserIds) q = q.in("id", opts.onlyUserIds);
    const { data, error } = await q
      .order("sourcing_last_sent_at", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("[sourcing] profiles select failed:", error.message);
      return done({ status: 500, body: { error: "Query failed" } });
    }
    profiles.push(...((data ?? []) as ProfileRow[]));
    if ((data?.length ?? 0) < PAGE) break;
  }
  const ids = profiles.map((p) => p.id);
  // Every profile row of the audience (Batch 13). Unreadable (schema not run):
  // every member is one seat, exactly as before.
  const profileRows = await allProfilesFor(admin, ids);
  const tagged = profileRows !== null;
  const feedbackBySeat = new Map<string, PickFeedback[]>();

  const savedByUser = new Map<string, string[]>();
  const sentToday = new Set<string>();
  // Seats already recorded as missing a pick today: one miss a day each, across the passes.
  const missedToday = new Set<string>();
  const feedbackSince = new Date(Date.now() - FEEDBACK_WINDOW_MS).toISOString();
  type FeedbackRow = { user_id: string; canonical_url: string; reaction: unknown; reaction_source: unknown; reasons: unknown; kind: unknown; postcode_area: unknown; deal: unknown; responded_at: unknown };
  const feedbackRows: FeedbackRow[] = [];
  for (const some of chunk(ids, ID_CHUNK)) {
    const [savedRes, todayRes, fbRes, missedRes] = await Promise.all([
      admin.from("saved_areas").select("user_id, postcode_area").in("user_id", some),
      admin.from("sourcing_sent").select("user_id").in("user_id", some).gte("sent_at", todayIso),
      admin.from("sourcing_sent").select("user_id, canonical_url, reaction, reaction_source, reasons, kind, postcode_area, deal, responded_at").in("user_id", some).not("reaction", "is", null).gte("responded_at", feedbackSince),
      admin.from("sourcing_missed").select(tagged ? "user_id, profile_id" : "user_id").in("user_id", some).gte("missed_at", todayIso),
    ]);
    for (const s of (savedRes.data ?? []) as { user_id: string; postcode_area: string }[]) savedByUser.set(s.user_id, [...(savedByUser.get(s.user_id) ?? []), s.postcode_area.toUpperCase()]);
    for (const r of (todayRes.data ?? []) as { user_id: string }[]) sentToday.add(r.user_id);
    if (missedRes.error) console.warn("[sourcing] sourcing_missed select failed (schema behind?):", missedRes.error.message);
    for (const r of (missedRes.data ?? []) as unknown as { user_id: string; profile_id?: string | null }[]) missedToday.add(seatKey(r.user_id, r.profile_id ?? null));
    if (fbRes.error) console.warn("[sourcing] feedback select failed (schema behind?):", fbRes.error.message);
    feedbackRows.push(...((fbRes.data ?? []) as FeedbackRow[]));
  }
  // The screening behind each piece of feedback, read SEPARATELY on purpose. The
  // select above only console.warns on failure, so putting a new column in it
  // would mean one missing column silently switching off every feedback rule —
  // price caps, area bans, kind switches — for every member. On its own it can
  // only cost the return floor, which then simply does not apply. The profile
  // each answer was given under (Batch 13) is read the same way, for the same reason.
  const feedbackScreening = new Map<string, Screening | null>();
  const feedbackProfile = new Map<string, string | null>();
  for (const some of chunk(ids, ID_CHUNK)) {
    const { data, error } = await admin
      .from("sourcing_sent")
      .select(tagged ? "user_id, canonical_url, screening, profile_id" : "user_id, canonical_url, screening")
      .in("user_id", some)
      .not("reaction", "is", null)
      .gte("responded_at", feedbackSince);
    if (error) {
      console.warn("[sourcing] screening feedback select failed (schema behind?):", error.message);
      break;
    }
    for (const r of (data ?? []) as unknown as { user_id: string; canonical_url: string; screening: unknown; profile_id?: string | null }[]) {
      feedbackScreening.set(`${r.user_id}|${r.canonical_url}`, parseScreening(r.screening));
      feedbackProfile.set(`${r.user_id}|${r.canonical_url}`, r.profile_id ?? null);
    }
  }
  // The listing behind each piece of feedback (size, type, price) comes from the shared snapshot.
  const feedbackListing = new Map<string, SourcedListing>();
  for (const urls of chunk([...new Set(feedbackRows.map((r) => r.canonical_url))], URL_CHUNK)) {
    const { data } = await admin.from("sourced_listings").select("canonical_url, snapshot").in("canonical_url", urls);
    for (const r of (data ?? []) as { canonical_url: string; snapshot: SourcedListing }[]) feedbackListing.set(r.canonical_url, r.snapshot);
  }
  // Each answer keeps its listing, time and profile so it can be merged with the grid's below.
  const pickEntries = new Map<string, { entry: FeedbackEntry; profileId: string | null }[]>();
  for (const r of feedbackRows) {
    pickEntries.set(r.user_id, [
      ...(pickEntries.get(r.user_id) ?? []),
      {
        entry: {
          url: r.canonical_url,
          // Already in the filter above, so selecting it adds no new way for this read to fail.
          at: typeof r.responded_at === "string" ? r.responded_at : null,
          feedback: toPickFeedback(r, feedbackListing.get(r.canonical_url) ?? null, feedbackScreening.get(`${r.user_id}|${r.canonical_url}`) ?? null),
        },
        profileId: feedbackProfile.get(`${r.user_id}|${r.canonical_url}`) ?? null,
      },
    ]);
  }
  // A Keep or Pass on the /deals grid is an answer too (src/lib/marketplace/reactions.ts).
  // One answer per listing, the latest: a deal both picked and passed counts once.
  // A seat for a saved profile learns only from the answers given under it
  // (as Today does, src/lib/today/feedback.ts); a seat with no profile from all of them.
  const grid = await dealFeedbackFor(admin, ids, feedbackSince, { byProfile: tagged });
  const feedbackFor = (userId: string, profileId: string | null): PickFeedback[] => {
    const picked = (pickEntries.get(userId) ?? []).filter((x) => !profileId || x.profileId === profileId).map((x) => x.entry);
    return mergeFeedback(picked, (profileId ? grid.byProfile.get(profileId) : grid.entries.get(userId)) ?? []);
  };

  const members: Member[] = [];
  const skipped: { user: string; profile?: string; reason: string }[] = [];
  for (const p of profiles) {
    if (!p.email) {
      skipped.push({ user: p.id, reason: "no_email" });
      continue;
    }
    if (isPaused(p)) {
      skipped.push({ user: p.id, reason: "paused" });
      continue;
    }
    if (sentToday.has(p.id) && !opts.ignoreToday) {
      skipped.push({ user: p.id, reason: "already_today" });
      continue;
    }
    const { seats, allPaused } = seatsFor(p.id, profileRows?.get(p.id));
    if (allPaused) {
      skipped.push({ user: p.id, reason: "profiles_paused" });
      continue;
    }
    for (const seat of seats) {
      const goals = seat.profile ? seat.profile.goals : parseMarketGoals(p.market_goals);
      const areas = seat.profile ? seat.profile.areas : savedByUser.get(p.id) ?? [];
      const feedback = feedbackFor(p.id, seat.profile?.id ?? null);
      const rules = feedbackRules(feedback);
      const areaFit = new Map<string, number | null>();
      let queries: SourcingQuery[] = [];
      let basis: PickBasis = "house";
      if (goals) {
        const refs: AreaRef[] = cards.map((card) => {
          const fit = personaliseScore(personalInputFor(card, goals), goals)?.score ?? card.score?.score ?? null;
          areaFit.set(card.code, fit);
          return { code: card.code, name: card.name, slug: card.slug, centroid: areaCentroid(card.code), fit };
        });
        queries = queriesForGoals(goals, areas, refs);
        if (queries.length > 0) basis = "goals";
      }
      if (queries.length === 0) queries = houseQueries(cards, goals);
      queries = applyQueryFeedback(queries, feedback, rules);
      if (queries.length === 0) {
        skipped.push({ user: p.id, ...(seat.profile ? { profile: seat.profile.id } : {}), reason: "no_queries" });
        continue;
      }
      feedbackBySeat.set(seat.key, feedback);
      members.push({ id: p.id, key: seat.key, profile: seat.profile, heading: seat.heading, areas, email: p.email, admin: isAdminEmail(p.email), paid: hasEverPaid(p, { admin: isAdminEmail(p.email) }), goals, basis, firstEver: !p.sourcing_last_sent_at, queries, areaFit, rules });
    }
  }
  const memberIds = [...new Set(members.map((m) => m.id))];

  // ── Who pays for whom, before any candidate is judged ──
  // A team member's picks are paid from their team owner's credit, and their
  // early-access tier is the owner's too: the owner is the account that paid.
  // In chunks: one lookup for a whole audience is a request too long to send.
  // A lookup that fails stops the pass: it would bill members' own accounts
  // and miss paused seats (the next pass tries again).
  const payers = await payersForCharging(memberIds);
  if (!payers) return done({ status: 503, body: { error: "Team lookup failed; nothing sent or charged" } });
  {
    const audience = new Map(profiles.map((p) => [p.id, p as PaidTierAccount]));
    const ownersToRead = [...new Set([...payers.values()].map((p) => p.payerId))].filter((id) => !audience.has(id));
    const owners = new Map<string, PaidTierAccount>();
    for (const some of chunk(ownersToRead, ID_CHUNK)) {
      const { data, error } = await admin.from("profiles").select(`id, ${PAID_TIER_COLUMNS}`).in("id", some);
      if (error) console.error("[sourcing] owner tier read failed:", error.message);
      for (const r of (data ?? []) as (PaidTierAccount & { id: string })[]) owners.set(r.id, r);
    }
    for (const m of members) {
      const payer = payers.get(m.id);
      if (!payer) continue;
      const owner = audience.get(payer.payerId) ?? owners.get(payer.payerId) ?? null;
      m.paid = m.admin || hasEverPaid(owner);
    }
  }

  // Shared query set, capped per run. Searches that carry a member's own
  // filter (their budget, bedrooms, kind, areas) go first: they are wanted by
  // one member each and would otherwise sort last and starve when the budget
  // runs out. House searches follow, most-wanted first, and the later cron
  // passes finish them from cache.
  const demand = new Map<string, { query: SourcingQuery; members: number; own: boolean }>();
  for (const m of members) {
    for (const q of m.queries) {
      const d = demand.get(q.key) ?? { query: q, members: 0, own: false };
      d.members += 1;
      d.own = d.own || m.goals !== null;
      demand.set(q.key, d);
    }
  }
  const queries = [...demand.values()].sort((a, b) => Number(b.own) - Number(a.own) || b.members - a.members).slice(0, maxQueries());

  const unsuitable: Partial<Record<UnsuitableReason, number>> = {};
  // How the income screening landed across every candidate considered this run.
  // Counted because the gate failing silently is the one outcome that looks like
  // a broken product: the log line has to show whether members got nothing
  // because the market was thin or because the bar rejected it all.
  const screened: Partial<Record<Band, number>> = {};
  const summary = { dry, enabled, enrolled: profiles.length, members: members.length, queries: queries.length, answered: 0, fromPool: 0, unavailable: 0, listings: 0, verified: 0, gone: 0, unsuitable, screened, emails: 0, emailFailures: 0, sections: 0, unfunded: 0, chargedBasePence: 0, missed: 0, ranOutOfTime: false, pickBasePence, chargeMode: mode, dailyPence };
  // Each seat's tailoring (Batch 14): the same loader the Today page uses, so
  // a list stored here is the one the page would have chosen. A failed read
  // leaves every seat untailored: chosen exactly as before.
  const tailoringBySeat = await tailoringForSeats(admin, members.map((m) => ({ userId: m.id, profile: m.profile, goals: m.goals, savedAreas: m.areas }))).catch((err) => {
    console.error("[sourcing] tailoring read failed:", (err as Error)?.message ?? err);
    return new Map<string, TailoringProfile>();
  });
  // What Today's list needs to know about a member (src/lib/today/selection.ts).
  const memberContextOf = (m: Member): MemberContext => ({ userId: m.id, payerId: payerIn(payers, m.id).payerId, goals: m.goals, savedAreas: m.areas, visibility: m.paid ? PAID_VISIBILITY : freeVisibility, profileId: m.profile?.id ?? null, profileActive: m.profile?.isActive ?? false, tailoring: tailoringBySeat.get(m.key) ?? null });
  if (dry) {
    // What each member's daily email would carry besides the pick, read
    // without writing anything: a Today list only if one is stored already
    // (the real run chooses one), the changes waiting for them, and whether
    // their daily slot is already spent. The pick itself is chosen at send
    // time, after page reads a dry run does not make.
    const ids = memberIds;
    const [slots, plans, alertsOn, pending] = await Promise.all([
      slotsInUse(admin, ids, "daily"),
      todayPlans(admin, members.map(memberContextOf), new Date(), { create: false }),
      trackedAlertsOn(admin, ids),
      pendingChanges(admin, ids),
    ]);
    return done({
      status: 200,
      body: {
        ...summary,
        skipped,
        wouldQuery: queries.map((q) => ({ key: q.query.key, members: q.members, own: q.own })),
        wouldEmail: members.map((m) => {
          const plan = plans.get(m.key) ?? null;
          const changes = alertsOn.has(m.id) ? pending.get(m.id)?.changes ?? [] : [];
          return {
            user: m.id,
            // One section of the member's one email per running profile.
            profile: m.profile?.id ?? null,
            email: m.email,
            basis: m.basis,
            firstEver: m.firstEver,
            queries: m.queries.map((q) => q.key),
            daily: {
              slot: slots === null ? "unreadable" : slots.get(m.id)?.status ?? "free",
              tier: m.paid ? "paid" : "free",
              today: plan ? teasersFrom(plan, null, m.paid ? PAID_VISIBILITY : freeVisibility).map((c) => c.id) : "chosen_at_send",
              changes: changes.map((c) => ({ id: c.id, type: c.alertType })),
              changesSwitch: alertsOn.has(m.id),
              wouldCharge: m.admin
                ? 0
                : mode === "per_day"
                  ? { pence: dailyPence, for: m.profile ? "this profile's Today's 5, pick included" : "the day's Today's 5, pick included", payer: payerIn(payers, m.id).payerId }
                  : { pence: "the pick's price: a pool deal's ladder price, else the flat pick price", payer: payerIn(payers, m.id).payerId },
            },
          };
        }),
      },
    });
  }

  // ── Answer each query: the marketplace pool first, then the broker as house spend ──
  // The sweep has already searched, screened and page-checked every top scored
  // area, so a query for one of those areas is answered from the pool for free
  // and the pick and the marketplace can never disagree. An area the sweep does
  // not cover (a member's own saved area outside the top list) still goes to
  // the broker exactly as before, so nobody is starved by the pool.
  const byQuery = new Map<string, SourcedListing[]>();
  const seenUrls = new Set<string>();
  const urlToDealId = new Map<string, string>();
  const urlToLiveSince = new Map<string, string | null>();
  const poolFor = async (query: SourcingQuery): Promise<SourcedListing[] | null> => {
    const { data, error } = await admin
      .from("marketplace_deals")
      .select("canonical_url, id, live_since")
      .eq("status", "live")
      .eq("kind", query.kind)
      .eq("postcode_area", query.area)
      .gte("first_seen_at", poolCutoffIso)
      .order("annual_profit", { ascending: false, nullsFirst: false })
      .limit(300);
    if (error) {
      console.error("[sourcing] pool read failed:", error.message);
      return null;
    }
    const rows = (data ?? []) as { canonical_url: string; id: string; live_since: string | null }[];
    if (rows.length === 0) return null;
    const out: SourcedListing[] = [];
    for (const urls of chunk(rows.map((r) => r.canonical_url), URL_CHUNK)) {
      const { data: snaps } = await admin.from("sourced_listings").select("canonical_url, snapshot").in("canonical_url", urls);
      for (const r of (snaps ?? []) as { canonical_url: string; snapshot: SourcedListing }[]) if (r.snapshot && typeof r.snapshot === "object") out.push(r.snapshot);
    }
    for (const r of rows) {
      urlToDealId.set(r.canonical_url, r.id);
      urlToLiveSince.set(r.canonical_url, r.live_since);
    }
    return out;
  };
  for (const { query } of queries) {
    if (elapsed() > QUERY_BUDGET_MS) {
      summary.ranOutOfTime = true;
      break;
    }
    const pooled = await poolFor(query);
    if (pooled && pooled.length > 0) {
      summary.answered += 1;
      summary.fromPool += 1;
      byQuery.set(query.key, pooled);
      summary.listings += pooled.length;
      pooled.forEach((l) => seenUrls.add(l.canonicalUrl));
      continue;
    }
    const res = await runMetered({ userId: null, admin: false, action: "cron:sourcing", actionId: newActionId() }, () => ask(sourcingListings, query, { mode: "cron" }));
    if (!res.value) {
      summary.unavailable += 1;
      continue;
    }
    summary.answered += 1;
    byQuery.set(query.key, res.value);
    const rows = res.value.map((l) => ({ canonical_url: l.canonicalUrl, source: l.source, kind: l.kind, query_key: query.key, postcode_area: l.postcodeArea ?? query.area, snapshot: l, first_seen_at: nowIso, last_seen_at: nowIso }));
    summary.listings += rows.length;
    if (rows.length === 0) continue;
    const { error: insErr } = await admin.from("sourced_listings").upsert(rows, { onConflict: "canonical_url", ignoreDuplicates: true });
    if (insErr) console.error("[sourcing] sourced_listings insert failed:", insErr.message);
    const urls = rows.map((r) => r.canonical_url);
    urls.forEach((u) => seenUrls.add(u));
    const { error: seenErr } = await admin.from("sourced_listings").update({ last_seen_at: nowIso }).in("canonical_url", urls);
    if (seenErr) console.error("[sourcing] last_seen update failed:", seenErr.message);
  }

  // First-seen dates decide what counts as new; recent sends decide what each member already had.
  const firstSeen = new Map<string, number>();
  for (const urls of chunk([...seenUrls], URL_CHUNK)) {
    const { data: seenRows } = await admin.from("sourced_listings").select("canonical_url, first_seen_at").in("canonical_url", urls);
    for (const r of (seenRows ?? []) as { canonical_url: string; first_seen_at: string }[]) firstSeen.set(r.canonical_url, new Date(r.first_seen_at).getTime());
  }
  // Only listings first seen this week can be candidates, so only sends this
  // week (plus a day of slack) can collide; that keeps every chunk under the
  // 1000-row page.
  const sentByUser = new Map<string, Set<string>>();
  const sentSince = new Date(Date.now() - NEW_WINDOW_MS - 24 * 60 * 60 * 1000).toISOString();
  for (const some of chunk(memberIds, ID_CHUNK)) {
    const { data: sentRows } = await admin.from("sourcing_sent").select("user_id, canonical_url").in("user_id", some).gte("sent_at", sentSince);
    for (const r of (sentRows ?? []) as { user_id: string; canonical_url: string }[]) sentByUser.set(r.user_id, new Set([...(sentByUser.get(r.user_id) ?? []), r.canonical_url]));
  }
  // A deal the member passed on the grid is never their pick, however long ago
  // they passed it: a pool pick is an auto-open, and they would be charged for it.
  for (const [userId, urls] of grid.passedUrls) sentByUser.set(userId, new Set([...(sentByUser.get(userId) ?? []), ...urls]));
  const cutoff = Date.now() - NEW_WINDOW_MS;

  // ── What a data provider already knows about these areas ──
  // Everything else in the motivation read is inferred. This is PropertyData
  // naming the properties it has measured as continuously marketed for over a
  // year, cut by more than fifteen percent, or repossessed — facts rather than
  // adjectives, and the only way to know a listing's real history on the day we
  // first see it. One credit per cohort per area, as house spend.
  const cohortIndex = new Map<string, CohortMember>();
  if (sourcedPropertiesConfigured()) {
    const motivatedAreas = new Set<string>();
    for (const m of members) {
      if (!m.goals || m.goals.motivation.mode === "off") continue;
      for (const q of m.queries) motivatedAreas.add(q.area);
    }
    for (const area of [...motivatedAreas].slice(0, COHORT_AREAS_PER_RUN)) {
      if (elapsed() > COHORT_UNTIL_MS) break;
      const c = areaCentroid(area);
      if (!c) continue;
      try {
        const rows = await runMetered({ userId: null, admin: false, action: "cron:sourcing", actionId: newActionId() }, () => fetchCohorts({ lat: c.lat, lng: c.lng }, COHORT_RADIUS_MILES));
        for (const [k, v] of indexCohorts(rows)) if (!cohortIndex.has(k)) cohortIndex.set(k, v);
      } catch (err) {
        // A cohort feed that is down must never cost anyone their daily pick.
        console.warn("[sourcing] cohort feed failed for", area, (err as Error)?.message ?? err);
      }
    }
  }

  // ── The back catalogue, for members who asked for motivated sellers ──
  // Every other pick has to be new; this filter is the one case where old is the
  // point. These rows are read from what we have already stored, so they cost a
  // query rather than a provider call.
  const motivatedMembers = members.filter((m) => m.goals && m.goals.motivation.mode !== "off");
  const olderCandidates = new Map<string, SourcedListing[]>();
  // A back-catalogue listing can be a marketplace deal that went live (or
  // came back) inside the early-access window: its live_since decides, for an
  // account that has never paid, exactly as the pool's does. Null: the read
  // failed, and a free account then gets no back-catalogue pick at all.
  let backLiveSince: Map<string, string | null> | null = new Map();
  if (motivatedMembers.length > 0) {
    const wanted = new Set<string>();
    for (const m of motivatedMembers) for (const q of m.queries) wanted.add(`${q.kind}|${q.area}`);
    const areas = [...new Set([...wanted].map((k) => k.split("|")[1]))];
    const { data: oldRows, error: oldErr } = await admin
      .from("sourced_listings")
      .select("canonical_url, kind, postcode_area, snapshot, first_seen_at")
      .in("postcode_area", areas)
      .lt("first_seen_at", new Date(cutoff).toISOString())
      .gt("first_seen_at", new Date(Date.now() - MOTIVATED_POOL_FLOOR_MS).toISOString())
      .order("last_seen_at", { ascending: false })
      .limit(MOTIVATED_POOL_LIMIT);
    if (oldErr) console.error("[sourcing] motivated pool query failed:", oldErr.message);
    const olderUrls: string[] = [];
    for (const r of (oldRows ?? []) as { canonical_url: string; kind: string; postcode_area: string | null; snapshot: SourcedListing; first_seen_at: string }[]) {
      if (!r.snapshot || typeof r.snapshot !== "object") continue;
      const key = `${r.kind}|${r.postcode_area ?? ""}`;
      if (!wanted.has(key)) continue;
      olderCandidates.set(key, [...(olderCandidates.get(key) ?? []), r.snapshot]);
      olderUrls.push(r.canonical_url);
      // These rows predate the window `firstSeen` was built for, so seed it here
      // or their age would fall back to "unknown" and read as brand new.
      if (!firstSeen.has(r.canonical_url)) firstSeen.set(r.canonical_url, new Date(r.first_seen_at).getTime());
    }
    // The dedupe set above only reaches back eight days, which is all the fresh
    // pool can collide with. A back-catalogue listing may have been emailed
    // months ago, and (user_id, canonical_url) is unique — so without this the
    // insert fails and the member loses their pick for the day.
    for (const someUrls of chunk(olderUrls, URL_CHUNK)) {
      if (!backLiveSince) break;
      const { data: deals, error: dealsErr } = await admin.from("marketplace_deals").select("canonical_url, live_since").in("canonical_url", someUrls);
      if (dealsErr) {
        console.error("[sourcing] back-catalogue early-access read failed; no back-catalogue picks for free accounts:", dealsErr.message);
        backLiveSince = null;
        break;
      }
      for (const d of (deals ?? []) as { canonical_url: string; live_since: string | null }[]) backLiveSince.set(d.canonical_url, d.live_since);
    }
    for (const someUrls of chunk(olderUrls, URL_CHUNK)) {
      for (const someIds of chunk([...new Set(motivatedMembers.map((m) => m.id))], ID_CHUNK)) {
        const { data: past } = await admin.from("sourcing_sent").select("user_id, canonical_url").in("user_id", someIds).in("canonical_url", someUrls);
        for (const r of (past ?? []) as { user_id: string; canonical_url: string }[]) {
          sentByUser.set(r.user_id, new Set([...(sentByUser.get(r.user_id) ?? []), r.canonical_url]));
        }
      }
    }
  }

  // A pool deal the member's team has already unlocked is theirs: never their
  // pick, or they would pay for it twice. Unlocks belong to the account that
  // pays (a team member's owner); a row still being opened counts too.
  // Read by payer (a handful of rows each) and matched to the pool here, so
  // the read stays a few requests however large the pool is. The charge
  // below checks again, so a read cut short costs nothing.
  if (urlToDealId.size > 0) {
    const unlockedByPayer = new Map<string, Set<string>>();
    const payerIds = [...new Set(members.map((m) => payerIn(payers, m.id).payerId))];
    const PAGE = 1000;
    reading: for (const someIds of chunk(payerIds, ID_CHUNK)) {
      for (let from = 0; ; from += PAGE) {
        if (elapsed() > QUERY_BUDGET_MS) break reading;
        const { data: opened, error: openedErr } = await admin.from("deal_opens").select("user_id, canonical_url").in("user_id", someIds).order("id", { ascending: true }).range(from, from + PAGE - 1);
        if (openedErr) {
          console.error("[sourcing] unlocked-deal read failed:", openedErr.message);
          break;
        }
        for (const r of (opened ?? []) as { user_id: string; canonical_url: string }[]) {
          if (urlToDealId.has(r.canonical_url)) unlockedByPayer.set(r.user_id, new Set([...(unlockedByPayer.get(r.user_id) ?? []), r.canonical_url]));
        }
        if ((opened?.length ?? 0) < PAGE) break;
      }
    }
    addUnlocked(sentByUser, memberIds, (id) => payerIn(payers, id).payerId, unlockedByPayer);
  }

  // What "slow" means round here. Computed from the listings each query already
  // returned, so it costs nothing: no provider call, no extra read. Areas with
  // too thin a sample answer null, and the area test is then skipped rather than
  // failed — see meetsMotivationBar.
  const runNow = new Date();
  const firstSeenIso = (url: string): string | null => {
    const ms = firstSeen.get(url);
    return ms === undefined ? null : new Date(ms).toISOString();
  };
  const areaMedianDays = new Map<string, number | null>();
  for (const { query } of queries) {
    const cohort = byQuery.get(query.key) ?? [];
    if (cohort.length === 0) continue;
    const key = `${query.kind}|${query.area}`;
    if (areaMedianDays.has(key)) continue;
    areaMedianDays.set(key, medianAgeDays(cohort.map((l) => listingAge(l, firstSeenIso(l.canonicalUrl), runNow))));
  }

  // The same listing goes to at most DAILY_LISTING_CAP members a day, across
  // every pass: seed the counter from today's rows (any status).
  const assigned = new Map<string, number>();
  {
    const { data: todayRows } = await admin.from("sourcing_sent").select("canonical_url").gte("sent_at", todayIso).range(0, PAGE - 1);
    for (const r of (todayRows ?? []) as { canonical_url: string }[]) assigned.set(r.canonical_url, (assigned.get(r.canonical_url) ?? 0) + 1);
  }
  const reject = (reason: UnsuitableReason) => {
    unsuitable[reason] = (unsuitable[reason] ?? 0) + 1;
  };

  // ── Candidates per member: new, unsent, within the query, not obviously unsuitable, ranked ──
  // Pre-checked 'ok' listings rank ahead of 'unknown' ones (a leasehold flat
  // whose page has not been read yet) so the page reads go to listings that
  // are likely to pass.
  type Ranked = SourcedPick & { precheck: "ok" | "unknown"; nearMiss?: boolean; screening?: Screening | null };
  const ranked = new Map<string, Ranked[]>();
  const relaxationFor = new Map<string, Relaxation | null>();

  /**
   * The closest listing to a filter that matched nothing, with the advice to go
   * with it. The money tests still apply — "closest" never means a deal that
   * does not work — and the pick is marked so the email can be honest about it.
   */
  const nearestUsable = (misses: (NearMiss & { candidate: Candidate & { precheck: "ok" | "unknown" } })[], m: Member): { pick: Ranked; relaxation: Relaxation | null } | null => {
    if (misses.length === 0) return null;
    const viable = new Set(rankPicks(misses.map((x) => x.candidate), misses.length, "off").map((p) => p.listing.canonicalUrl));
    // The income bar applies here too: "closest to your filter" must not become
    // a way to send the very thing the screening rejected.
    const usable = misses.filter((x) => viable.has(x.listing.canonicalUrl) && (!x.candidate.screening || isSendable(x.candidate.screening)));
    if (usable.length === 0) return null;
    const best = closestMatch(usable, (l) => usable.find((x) => x.listing.canonicalUrl === l.canonicalUrl)?.candidate.motivation?.score ?? 0);
    if (!best) return null;
    const chosen = usable.find((x) => x.listing.canonicalUrl === best.listing.canonicalUrl)!;
    const q = m.queries.find((x) => x.kind === chosen.listing.kind) ?? m.queries[0];
    const motivation = m.goals!.motivation;
    const relaxation = analyseRelaxation(usable, {
      kind: chosen.listing.kind,
      thresholdUnits: chosen.listing.kind === "rent" ? motivation.minWeeksOnMarket : motivation.minMonthsOnMarket,
      maxPrice: q?.maxPrice ?? null,
      minBedrooms: q?.minBedrooms ?? null,
    });
    const fit = blendFit(chosen.candidate.deal, chosen.candidate.areaFit) ?? 0;
    return { pick: { ...chosen.candidate, fit, nearMiss: true }, relaxation };
  };
  const perUser: { user: string; profile?: string; basis: PickBasis; candidates: number; sent: boolean; reason?: string }[] = [];
  const seatOf = (m: Member) => (m.profile ? { profile: m.profile.id } : {});
  const candidateCount = new Map<string, number>();
  for (const m of members) {
    const sent = sentByUser.get(m.id) ?? new Set<string>();
    // House picks have no filter, so no motivation read: there is no member
    // threshold to judge them against.
    const motiv: MotivationGoals | null = m.goals && m.goals.motivation.mode !== "off" ? m.goals.motivation : null;
    const seen = new Set<string>();
    const candidates: (Candidate & { precheck: "ok" | "unknown" })[] = [];
    // Listings that failed the filter rather than the property tests. Kept only
    // for a member whose filter can empty the pool, because they are the whole
    // basis of "nothing matched, and here is what to change".
    const nearMisses: (NearMiss & { candidate: Candidate & { precheck: "ok" | "unknown" } })[] = [];
    const consider = (l: SourcedListing, q: SourcingQuery, fromBackCatalogue: boolean) => {
      if (seen.has(l.canonicalUrl) || sent.has(l.canonicalUrl)) return;
      // A pool deal still inside its early-access window is not for a member
      // whose account has never paid. Decided here, before anything is ranked,
      // so neither the alternates nor the daily cap can reach it later.
      if (!m.paid && urlToDealId.has(l.canonicalUrl) && !dealVisible(urlToLiveSince.get(l.canonicalUrl), freeVisibility.cutoffIso)) return;
      // The same for the back catalogue, which the pool read above never sees.
      if (!m.paid && fromBackCatalogue && (backLiveSince === null || (backLiveSince.has(l.canonicalUrl) && !dealVisible(backLiveSince.get(l.canonicalUrl), freeVisibility.cutoffIso)))) return;
      // Every ordinary pick has to be new. The back-catalogue pool is the one
      // exception, because a listing that has been sitting for months is exactly
      // what its member asked for.
      if (!fromBackCatalogue && (firstSeen.get(l.canonicalUrl) ?? Date.now()) < cutoff) return;
      seen.add(l.canonicalUrl);
      const precheck = suitabilityFromListing(l);
      if (precheck !== "ok" && precheck !== "unknown") {
        // Not a near miss: a room or a shared-ownership sale can never be sent,
        // so there is no filter to relax that would help.
        reject(precheck);
        return;
      }
      // Soft failures are recorded rather than dropped: a listing that misses on
      // exactly one of these is what tells us which constraint is costing the
      // member the most.
      const fails: Dimension[] = [];
      if (q.minBedrooms && l.bedrooms !== null && l.bedrooms < q.minBedrooms) fails.push("bedrooms");
      if (!withinQueryPrice(l, q)) fails.push("price");
      const median = areaMedianDays.get(`${q.kind}|${q.area}`) ?? null;
      const motivation = motiv
        ? motivationFromListing(l, {
            thresholdDays: thresholdDaysFor(motiv, l.kind),
            areaMedianDays: median,
            firstSeenAt: firstSeenIso(l.canonicalUrl),
            cohort: lookupCohorts(cohortIndex, { uprn: l.uprn, postcode: l.postcode, address: l.address }),
            now: runNow,
          })
        : null;
      const qualifies = motiv && motivation
        ? meetsMotivationBar(motivation, { mode: motiv.mode, areaRelative: motiv.areaRelative, areaMedianKnown: median !== null })
        : undefined;
      // Reaching back is only justified for a listing that genuinely qualifies.
      // Under "prefer" nothing is otherwise excluded, and without this the
      // filter would quietly start posting stale stock with nothing to say for
      // itself — the opposite of what the member asked for.
      if (fromBackCatalogue && !meetsMotivationBar(motivation ?? NO_MOTIVATION, { mode: "only", areaRelative: motiv?.areaRelative ?? false, areaMedianKnown: median !== null })) return;
      if (motiv?.mode === "only" && qualifies !== true) fails.push("motivation");
      const card = cardByCode.get(l.postcodeArea ?? q.area) ?? cardByCode.get(q.area);
      const areaFit = m.goals ? m.areaFit.get(card?.code ?? q.area) ?? null : card?.score?.score ?? null;
      // Income screening: does this earn enough as a short let to be worth
      // recommending, against what the same property would make on a long let?
      // One helper shared with the marketplace and the screening report, so
      // the gate, the pool and the report can never disagree.
      const { screening, figures } = screenSourced(l, card ?? null, rentTable);
      const candidate = {
        listing: l,
        deal: dealForSourced(l, figures, m.goals?.finance ?? null),
        areaFit,
        areaName: card?.name ?? q.areaName,
        precheck,
        motivation,
        motivationQualifies: qualifies,
        screening,
      };
      if (fails.length === 0) {
        candidates.push(candidate);
        return;
      }
      if (!motiv) return;
      const age = listingAge(l, firstSeenIso(l.canonicalUrl), runNow);
      nearMisses.push({
        candidate,
        listing: l,
        fails,
        ageDays: age?.days ?? null,
        amount: l.price ? (l.kind === "rent" ? rentPcm(l.price) : l.price.period === "total" ? l.price.amount : null) : null,
        bedrooms: l.bedrooms,
      });
    };
    for (const q of m.queries) {
      for (const l of byQuery.get(q.key) ?? []) consider(l, q, false);
      if (motiv) for (const l of olderCandidates.get(`${q.kind}|${q.area}`) ?? []) consider(l, q, true);
    }
    candidateCount.set(m.key, candidates.length);
    // Feedback, the income gate, fit and the short-let split: shared with the
    // Today page (see rank.ts), so the email and the page rank alike.
    const result = rankForMember(candidates, feedbackBySeat.get(m.key) ?? [], m.rules, { depth: SPREAD_DEPTH, mode: motiv?.mode ?? "off" });
    for (const [band, n] of Object.entries(result.screened) as [Band, number][]) screened[band] = (screened[band] ?? 0) + n;
    const list: Ranked[] = result.ranked;
    if (list.length === 0) {
      // Nothing matched. A strict filter reads as a broken product when it just
      // goes quiet, so send the nearest thing and say which setting stopped the
      // rest — but only when there is a nearest thing whose deal actually works.
      const fallback = motiv ? nearestUsable(nearMisses, m) : null;
      if (!fallback) {
        // Saying which of the two happened matters: one is a thin market, the
        // other is the income bar, and only the second is ours to reconsider.
        perUser.push({ user: m.id, ...seatOf(m), basis: m.basis, candidates: candidates.length, sent: false, reason: result.gated ? "nothing_qualified" : "nothing_new" });
        continue;
      }
      candidateCount.set(m.key, candidates.length + nearMisses.length);
      relaxationFor.set(m.key, fallback.relaxation);
      ranked.set(m.key, [fallback.pick]);
      continue;
    }
    ranked.set(m.key, list);
  }
  const withCandidates = members.filter((m) => ranked.has(m.key));

  if (withCandidates.length > 0 && !isEmailConfigured()) {
    for (const m of withCandidates) perUser.push({ user: m.id, ...seatOf(m), basis: m.basis, candidates: candidateCount.get(m.key) ?? 0, sent: false, reason: "email_not_configured" });
    return done({ status: 200, body: { ...summary, ms: elapsed(), skipped, members: perUser } });
  }

  // What a candidate would cost this member. Before the new pricing date: the
  // ladder price for a pool deal, the flat pick price otherwise. From it: the
  // day's price, whichever listing is the pick.
  const priceOf = (m: Member, cand: Ranked | undefined): number => {
    if (m.admin) return 0;
    if (mode === "per_day") return dailyPence;
    if (!cand) return pickBasePence;
    return urlToDealId.has(cand.listing.canonicalUrl) ? openPricePence(cand.screening?.surplus ?? null, ladder) : pickBasePence;
  };

  // ── Credit: only members who have a candidate ──
  // A team member's picks are paid from their team owner's credit (`payers`,
  // resolved above); a suspended seat has none to spend. Each payer's balance
  // is read once and spent in order across everyone it pays for (the purse),
  // starved members first, so a team cannot between them overdraw its owner.
  const affordable: Member[] = [];
  // Seats whose payer could not cover them: left out of today's email, and named in it.
  const unfundedSeats = new Set<string>();
  const missedRows: Record<string, unknown>[] = [];
  const toRead = [...new Set(withCandidates.filter((m) => !m.admin && !payerIn(payers, m.id).suspended).map((m) => payerIn(payers, m.id).payerId))];
  const spendable = new Map<string, number | null>();
  for (const some of chunk(toRead, 10)) {
    const balances = await Promise.all(some.map((id) => getBalance(id).catch(() => null)));
    some.forEach((id, i) => spendable.set(id, balances[i]?.spendableBasePence ?? null));
  }
  const purse = new PayerPurse(spendable);
  // What each seat's send has taken from its payer's purse so far. Seats come
  // in charge order (a member's active profile first), so when the credit
  // runs out part-way it is the later profiles that miss the day.
  const held = new Map<string, number>();
  // A member with a candidate is emailed, and every one of their profiles
  // with a Today goes in it and is charged its day: so from the new pricing
  // date every seat of theirs holds its day here, in charge order, whether it
  // has a candidate or not. A profile with no candidate never goes ahead of
  // the active one for want of a hold.
  const candidateUsers = new Set(withCandidates.map((m) => m.id));
  for (const m of members.filter((x) => candidateUsers.has(x.id))) {
    const payer = payerIn(payers, m.id);
    if (!ranked.has(m.key)) {
      // Its Today alone: held now if the purse covers it; the send loop tries again, and names it if not.
      if (mode === "per_day" && !m.admin && !payer.suspended && purse.take(payer.payerId, dailyPence)) held.set(m.key, dailyPence);
      continue;
    }
    const top = ranked.get(m.key)?.[0];
    const need = priceOf(m, top);
    if (m.admin || need <= 0 || (!payer.suspended && purse.take(payer.payerId, need))) {
      held.set(m.key, m.admin ? 0 : Math.max(0, need));
      affordable.push(m);
      continue;
    }
    unfundedSeats.add(m.key);
    perUser.push({ user: m.id, ...seatOf(m), basis: m.basis, candidates: candidateCount.get(m.key) ?? 0, sent: false, reason: "no_credit" });
    // Remembered for the "your picks have paused" letter (picks-paused-run):
    // the best candidate, figures only. Not for a seat the owner has let
    // lapse (nothing for them to top up), not when the balance could not
    // be read (that is not "out of credit"), and once a day across passes.
    if (top && !payer.suspended && purse.known(payer.payerId) && !missedToday.has(m.key)) {
      missedToday.add(m.key);
      missedRows.push({ user_id: m.id, missed_at: nowIso, need_pence: need, ...missedRowFor(top.listing, top.screening ?? null), ...(m.profile ? { profile_id: m.profile.id } : {}) });
    }
  }
  // Can this seat's payer cover this candidate instead of what is held for it?
  const coverable = (m: Member, cand: Ranked): boolean => m.admin || priceOf(m, cand) <= (held.get(m.key) ?? 0) + purse.remaining(payerIn(payers, m.id).payerId) + 1e-9;
  const holdFor = (m: Member, cand: Ranked): boolean => {
    if (m.admin) return true;
    const price = priceOf(m, cand);
    if (!purse.adjust(payerIn(payers, m.id).payerId, held.get(m.key) ?? 0, price)) return false;
    held.set(m.key, price);
    return true;
  };
  // What a seat holds goes back to the purse for the rest of the payer's seats.
  const unholdSeat = (m: Member) => {
    purse.giveBack(payerIn(payers, m.id).payerId, held.get(m.key) ?? 0);
    held.set(m.key, 0);
  };
  if (missedRows.length > 0) {
    const { error: missErr } = await admin.from("sourcing_missed").upsert(missedRows, { onConflict: "user_id,canonical_url", ignoreDuplicates: true });
    if (missErr) console.error("[sourcing] sourcing_missed insert failed (schema behind?):", missErr.message);
    else summary.missed = missedRows.length;
  }

  // ── Today's 5 and the changes, for everyone who can be sent a pick (Batch 6) ──
  // Started now and left to run while the page verification below waits on
  // the network, so the send loop only reads results. Each member's list is
  // the one /today shows them (todaySelection chooses and stores it once a
  // day); the changes are the alerts the 06:55 collector recorded for them.
  const dailyIds = [...new Set(affordable.map((m) => m.id))];
  const alertsReady = Promise.all([trackedAlertsOn(admin, dailyIds), pendingChanges(admin, dailyIds)]).catch((err) => {
    console.error("[sourcing] changes read failed:", (err as Error)?.message ?? err);
    return [new Set<string>(), new Map<string, Settled>()] as const;
  });
  // Every seat of a member who will be emailed, bar those the credit could
  // not cover: a profile with no pick today still has its Today in the email.
  const emailed = new Set(dailyIds);
  const planSeats = members.filter((m) => emailed.has(m.id) && !unfundedSeats.has(m.key));
  const plansReady = todayPlans(admin, planSeats.map(memberContextOf), new Date(), { create: true, concurrency: 6 }).catch((err) => {
    console.error("[sourcing] today lists failed:", (err as Error)?.message ?? err);
    return new Map<string, TodayPlan | null>();
  });

  // ── Verify each candidate against its listing page (one read per distinct listing, house-metered) ──
  // The page carries what the search card does not: tenure, the shared-
  // ownership flag and the description's line on short lets. The merged
  // listing (photo, confirmed price, evidence) is what gets sent and stored,
  // so tomorrow's pre-check answers without a fetch.
  // `previousAgentHash` is the agent digest the candidate arrived with, read
  // before the merge below overwrites it — the stored row's for anything seen
  // on an earlier run, today's search card for anything new. Only the path
  // that actually read a page carries one, because with no fresh digest there
  // is nothing to compare against.
  //
  // Card and page digests are never compared against each other, which would
  // be meaningless: of the page parsers only Rightmove reads an agent at all,
  // and the two card sources are OnTheMarket (whose page yields none, so the
  // pair is always half-known) and PMI (which yields none itself). Every pair
  // that can fire is therefore one Rightmove page against another.
  type Verified = { verdict: Verdict; listing: SourcedListing; snapshot: ListingSnapshot | null; previousAgentHash: string | null };
  const verdicts = new Map<string, Verified>();
  const verify = async (l: SourcedListing): Promise<Verified> => {
    const memo = verdicts.get(l.canonicalUrl);
    if (memo) return memo;
    if (elapsed() > VERIFY_UNTIL_MS) return { verdict: "unverified", listing: l, snapshot: null, previousAgentHash: null };
    try {
      let res = await runMetered({ userId: null, admin: false, action: "cron:sourcing", actionId: newActionId() }, () => resolveListing(l.canonicalUrl));
      // A snapshot cached before the parsers learned about tenure evidence is re-read once.
      if (res.ok && res.snapshot.shortLetsPermitted === undefined && elapsed() <= VERIFY_UNTIL_MS) {
        res = await runMetered({ userId: null, admin: false, action: "cron:sourcing", actionId: newActionId() }, () => resolveListing(l.canonicalUrl, { refresh: true }));
      }
      if (!res.ok) return { verdict: "unverified", listing: l, snapshot: null, previousAgentHash: null };
      const s = res.snapshot;
      // Read before the merge below folds it into `merged.agentHash`.
      const previousAgentHash = l.agentHash ?? null;
      // The portal's own listing date beats anything the search card had, and
      // is written back so tomorrow's run starts from the better answer.
      const merged: SourcedListing = mergeSnapshotIntoListing(l, s);
      // Liveness before suitability: a sold or let-agreed listing is not a pick
      // however well it scores. The search card cannot know this — only the page can.
      const verdict: Verdict = s.status && GONE_STATUSES.has(s.status) ? "gone" : suitabilityFromSnapshot(s, l.kind);
      const out = { verdict, listing: merged, snapshot: s, previousAgentHash };
      verdicts.set(l.canonicalUrl, out);
      summary.verified += 1;
      void admin.from("sourced_listings").update({ snapshot: merged }).eq("canonical_url", l.canonicalUrl).then(({ error }) => {
        if (error) console.warn("[sourcing] snapshot refresh failed:", error.message);
      });
      return out;
    } catch (err) {
      console.warn("[sourcing] verification failed:", (err as Error)?.message ?? err);
      return { verdict: "unverified", listing: l, snapshot: null, previousAgentHash: null };
    }
  };

  // Batch 12: "Your profile is 60% done" for the email of anyone whose
  // profile is not complete. One read for the whole audience; a team member
  // is never asked, so never nudged.
  const nudges = await profileNudgesFor(admin, dailyIds.filter((id) => payerIn(payers, id).payerId === id));

  // ── One pick per member: the best candidate that passes, under the daily cap ──
  const picks: { member: Member; pick: Ranked; alternates: Ranked[]; candidates: number; nearMiss: boolean }[] = [];
  // Listings already picked for one of a member's profiles this run: never a second profile's too.
  const pickedFor = new Map<string, Set<string>>();
  for (const m of affordable) {
    const list = ranked.get(m.key) ?? [];
    const candidates = candidateCount.get(m.key) ?? 0;
    const taken = pickedFor.get(m.id) ?? new Set<string>();
    pickedFor.set(m.id, taken);
    const motiv: MotivationGoals | null = m.goals && m.goals.motivation.mode !== "off" ? m.goals.motivation : null;
    // A member's own filter is not capped (their pool is their own); house
    // members share one pool, so capped listings are skipped unless nothing
    // else is left.
    const underCap = m.basis === "goals" ? list : list.filter((p) => (assigned.get(p.listing.canonicalUrl) ?? 0) < DAILY_LISTING_CAP);
    const order = underCap.length > 0 ? underCap : list;
    let chosen: Ranked | null = null;
    let outOfTime = false;
    for (const p of order) {
      if (taken.has(p.listing.canonicalUrl)) continue;
      // A pricier stand-in than the balance was checked for is never sent into overdraft.
      if (!coverable(m, p)) continue;
      const { verdict, listing, snapshot, previousAgentHash } = await verify(p.listing);
      // A listing from the back catalogue has usually dropped out of the feed
      // long ago, so "we could not read the page" is not good enough: it may
      // have sold months back. Only a page we actually read can clear it.
      const fromBackCatalogue = (firstSeen.get(p.listing.canonicalUrl) ?? Date.now()) < cutoff;
      const cardAloneWillDo = p.precheck === "ok" && !fromBackCatalogue;
      if (verdict === "ok" || (verdict === "unverified" && cardAloneWillDo)) {
        // The card could not see the description, the listing history or the let
        // terms. Now that the page has been read, score it again so the reasons
        // in the email are the best ones we have rather than the cheapest.
        const motivation = motiv && snapshot
          ? motivationFromSnapshot(snapshot, listing.kind, {
              thresholdDays: thresholdDaysFor(motiv, listing.kind),
              areaMedianDays: areaMedianDays.get(`${listing.kind}|${listing.postcodeArea ?? ""}`) ?? null,
              firstSeenAt: firstSeenIso(listing.canonicalUrl),
              cohort: lookupCohorts(cohortIndex, { uprn: listing.uprn, postcode: listing.postcode, address: listing.address }),
              // The page we just read against the agent the stored row carried:
              // a property back on with someone new is a seller out of patience.
              previousAgentHash,
              now: runNow,
            })
          : p.motivation ?? null;
        chosen = { ...p, listing, motivation };
        break;
      }
      if (verdict === "unverified") {
        // Could not read the page and the card alone cannot clear it.
        if (elapsed() > VERIFY_UNTIL_MS) {
          outOfTime = true;
          break;
        }
        continue;
      }
      if (verdict === "gone") {
        summary.gone += 1;
        continue;
      }
      reject(verdict);
    }
    if (!chosen || !holdFor(m, chosen)) {
      if (outOfTime) summary.ranOutOfTime = true;
      perUser.push({ user: m.id, ...seatOf(m), basis: m.basis, candidates, sent: false, reason: outOfTime ? "out_of_time" : "nothing_suitable" });
      continue;
    }
    taken.add(chosen.listing.canonicalUrl);
    assigned.set(chosen.listing.canonicalUrl, (assigned.get(chosen.listing.canonicalUrl) ?? 0) + 1);
    // Stand-ins for a send that collides with a row this member already has.
    // Only listings already verified in this run qualify, so they cost no fetch.
    const alternates: Ranked[] = [];
    for (const p of order) {
      if (alternates.length >= MAX_ALTERNATES) break;
      if (p.listing.canonicalUrl === chosen.listing.canonicalUrl || taken.has(p.listing.canonicalUrl)) continue;
      const v = verdicts.get(p.listing.canonicalUrl);
      if (v?.verdict === "ok" && coverable(m, p)) alternates.push({ ...p, listing: v.listing });
    }
    picks.push({ member: m, pick: chosen, alternates, candidates, nearMiss: Boolean((list[0] as Ranked | undefined)?.nearMiss) });
  }
  // A member none of whose profiles has a pick is not emailed by this run
  // (the 08:10 digest has them): everything their seats hold goes back, so
  // the rest of the payer's members can use it.
  {
    const withPick = new Set(picks.map((x) => x.member.id));
    for (const m of members) if (!withPick.has(m.id) && (held.get(m.key) ?? 0) > 0) unholdSeat(m);
  }

  // ── Send: the day's slot, the pending rows, the email, then the charges ──
  // One email per member, with a part for each of their running profiles
  // (active first): its pick when it has one, then the rest of its Today. A
  // member none of whose profiles has a pick is left for the 08:10 digest.
  const base = siteUrl();
  const notReady = new Map<string, TodayPlan | null>();
  let readyTimer: ReturnType<typeof setTimeout> | undefined;
  const plans = await Promise.race([plansReady, new Promise<Map<string, TodayPlan | null>>((r) => (readyTimer = setTimeout(() => r(notReady), Math.max(0, DAILY_READY_BY_MS - elapsed()))))]);
  clearTimeout(readyTimer);
  if (plans === notReady) console.warn("[sourcing] today lists not ready; sending picks without teasers");
  const [alertsOn, pending] = await alertsReady;
  const pickByKey = new Map(picks.map((x) => [x.member.key, x]));
  const seatsByUser = new Map<string, Member[]>();
  for (const m of members) seatsByUser.set(m.id, [...(seatsByUser.get(m.id) ?? []), m]);
  type SentRow = { id: string; token: string; sending: Ranked; charge: number; dealId: string | null };
  type Part = { member: Member; deals: ProfileDeals; row: SentRow | null; candidates: number };
  for (const userId of [...new Set(picks.map((x) => x.member.id))]) {
    const seats = seatsByUser.get(userId) ?? [];
    const withPick = seats.map((m) => pickByKey.get(m.key)).filter((x): x is (typeof picks)[number] => x !== undefined);
    const who = withPick[0].member;
    const payer = payerIn(payers, userId);
    // A member who is not sent anything gives every hold back to the rest of their team.
    const unholdAll = () => seats.forEach(unholdSeat);
    const fail = (reason: string, list: readonly { member: Member; candidates: number }[] = withPick) => {
      for (const x of list) perUser.push({ user: userId, ...seatOf(x.member), basis: x.member.basis, candidates: x.candidates, sent: false, reason });
    };
    if (elapsed() > TIME_BUDGET_MS) {
      summary.ranOutOfTime = true;
      unholdAll();
      fail("out_of_time");
      continue;
    }
    // The day's one email slot (src/lib/notify/cap.ts). Taken already means the
    // member has had their daily email; nothing more today. A cap table the
    // schema has not caught up with does not stop the pick: it goes as before.
    // The admin's test send never touches the member's real slot.
    const claim = opts.ignoreToday ? null : await claimSlot(admin, userId, "todays_5");
    if (claim && !claim.ok && claim.reason === "slot_used") {
      unholdAll();
      fail("slot_used");
      continue;
    }
    const claimId = claim?.ok ? claim.id : null;
    const day = claim?.ok ? claim.day : capDay();
    const visibility = who.paid ? PAID_VISIBILITY : freeVisibility;
    // What this member's profiles were picked: a stand-in is never another profile's pick.
    const picked = new Set(withPick.map((x) => x.pick.listing.canonicalUrl));
    const parts: Part[] = [];
    const unfunded: string[] = [];
    let unsubscribe: Unsubscribe | null = null;
    for (const m of seats) {
      if (unfundedSeats.has(m.key)) {
        if (m.heading) unfunded.push(m.heading);
        continue;
      }
      const links = m.profile ? profileLinks(base, m.profile, GOALS_EDITOR_HREF) : null;
      const entry = pickByKey.get(m.key);
      let row: SentRow | null = null;
      let pickPart: ProfileDeals["pick"] = null;
      if (entry) {
        const { pick, alternates, candidates, nearMiss } = entry;
        const relaxation = nearMiss ? relaxationFor.get(m.key) ?? null : null;
        // Persisted so the "change it" link has something to apply that the member
        // cannot alter in the request. It belongs to the pick the analysis was
        // about, so a stand-in reached after a collision carries nothing.
        const relaxationRow = nearMiss ? toStoredRelaxation(relaxation, pick.listing.kind) : null;
        // (user_id, canonical_url) is unique, so a listing this member already has
        // comes back 23505. That is not a reason to leave them with nothing: try the
        // stand-ins before giving up. Any other error is real and stops the attempt.
        let sending: Ranked | null = null;
        let rowId: string | null = null;
        let token = "";
        let charge = 0;
        let insErr: { code?: string; message: string } | null = null;
        for (const cand of [pick, ...alternates]) {
          if (cand !== pick && picked.has(cand.listing.canonicalUrl)) continue;
          if (!holdFor(m, cand)) continue;
          const attempt = newPickToken();
          const cl = cand.listing;
          // From the new pricing date the pick itself costs nothing: the day is charged, after the send.
          charge = mode === "per_day" ? 0 : priceOf(m, cand);
          const { data: inserted, error } = await admin
            .from("sourcing_sent")
            .insert({ user_id: userId, canonical_url: cl.canonicalUrl, sent_at: nowIso, status: "pending", token: attempt, kind: cl.kind, postcode_area: cl.postcodeArea, basis: m.basis, deal: cand.deal, fit: cand.fit, charged_base_pence: charge, relaxation: cand === pick ? relaxationRow : null, motivation: cand.motivation ?? null, screening: cand.screening ?? null, deal_id: urlToDealId.get(cl.canonicalUrl) ?? null, ...(m.profile ? { profile_id: m.profile.id } : {}) })
            .select("id")
            .single();
          if (!error && inserted) {
            sending = cand;
            rowId = String(inserted.id);
            token = attempt;
            insErr = null;
            break;
          }
          insErr = error ?? { message: "no row returned" };
          if (error?.code !== "23505") break;
        }
        if (!sending || !rowId) {
          perUser.push({ user: userId, ...seatOf(m), basis: m.basis, candidates, sent: false, reason: insErr?.code === "23505" ? "already_sent" : !insErr ? "no_credit" : "insert_failed" });
          if (insErr && insErr.code !== "23505") console.error("[sourcing] sourcing_sent insert failed:", insErr.message);
          // No pick for this profile; its Today can still go below, on what it holds.
        } else {
          if (sending !== pick) assigned.set(sending.listing.canonicalUrl, (assigned.get(sending.listing.canonicalUrl) ?? 0) + 1);
          picked.add(sending.listing.canonicalUrl);
          const pickDealId = urlToDealId.get(sending.listing.canonicalUrl) ?? null;
          // Unlocked by the team since the pool was read (a teammate's pick earlier
          // in this run, or an open on /deals, finished or still going through): it
          // is paid for by that open, so it is sent but never charged twice.
          if (pickDealId && charge > 0) {
            const { data: unlocked, error: unlockedErr } = await admin.from("deal_opens").select("id").eq("user_id", payer.payerId).eq("canonical_url", sending.listing.canonicalUrl).in("status", ["open", "pending"]).limit(1);
            if (unlockedErr) console.error("[sourcing] unlocked check failed:", unlockedErr.message);
            if ((unlocked ?? []).length > 0) {
              charge = 0;
              // Nothing to pay for it after all: what was held goes back for the rest of the team.
              unholdSeat(m);
              const { error: zeroErr } = await admin.from("sourcing_sent").update({ charged_base_pence: 0 }).eq("id", rowId);
              if (zeroErr) console.error("[sourcing] pick price reset failed:", zeroErr.message);
            }
          }
          const section = pickSection({
            pick: sending,
            siteUrl: base,
            id: rowId,
            token,
            basis: m.basis,
            goalsChips: m.goals ? describeGoals(m.goals) : [],
            // The "why you get this" introduction, once per email.
            firstEver: m.firstEver && unsubscribe === null,
            chargedBasePence: charge,
            dailyPence: mode === "per_day" ? dailyPence : null,
            // A stand-in was only reached because the first choice collided, and it
            // is an ordinary candidate — the near-miss wording belongs to the pick
            // the analysis was actually about.
            nearMiss: nearMiss && sending === pick,
            relaxation: describeRelaxation(relaxation),
            // Whichever listing is actually going out carries its own screening, so a
            // stand-in never inherits the first choice's figures.
            screening: sending.screening ?? null,
            dealId: pickDealId,
            // Batch 10: the profit as a range at the profile's finance, never one figure.
            range: profitRange({ kind: sending.listing.kind, priceAmount: sending.listing.price?.amount ?? null, pricePeriod: sending.listing.price?.period ?? null, bedrooms: sending.listing.bedrooms, grossRevenue: sending.screening?.grossRevenue?.value ?? null, confidence: sending.screening?.confidence ?? null, finance: m.goals?.finance ?? null, widths: settings.dealPricing.profitRangePct }),
            profileLinks: links,
          });
          unsubscribe ??= section.unsubscribe;
          row = { id: rowId, token, sending, charge, dealId: pickDealId };
          pickPart = { section: section.section, headline: section.headline };
        }
      }
      // The rest of the profile's Today, in the order /today draws it.
      const plan = plans.get(m.key) ?? null;
      let teasers = plan ? teasersFrom(plan, row?.dealId ?? null, visibility) : [];
      if (!row && teasers.length > 0 && mode === "per_day" && !m.admin) {
        // A profile with no pick today is charged for its Today alone: on what
        // it holds from the credit check, else on what the purse has left.
        const have = held.get(m.key) ?? 0;
        if (have + 1e-9 < dailyPence) {
          if (!payer.suspended && purse.adjust(payer.payerId, have, dailyPence)) held.set(m.key, dailyPence);
          else {
            if (m.heading) unfunded.push(m.heading);
            teasers = [];
          }
        }
      }
      if (!row && (teasers.length === 0 || mode !== "per_day")) {
        // Nothing charged for this profile: whatever it held goes back.
        unholdSeat(m);
      }
      if (!row && teasers.length === 0) continue;
      parts.push({
        member: m,
        row,
        candidates: entry?.candidates ?? candidateCount.get(m.key) ?? 0,
        deals: {
          heading: m.heading,
          pick: pickPart,
          pickDealId: row?.dealId ?? null,
          teasers,
          advice: plan?.nearMiss ? plan.advice : null,
          todayUrl: links?.today,
          // Batch 10: each deal's profit as a range at this profile's finance.
          figureFor: (c) => cardRangeLine(c, m.goals?.finance ?? null, settings.dealPricing.profitRangePct),
        },
      });
    }
    const sentRows = parts.flatMap((p) => (p.row ? [p.row] : []));
    if (sentRows.length === 0 || !unsubscribe) {
      // Every pick collided or failed: nothing is sent, and the slot goes back for the 08:10 digest.
      unholdAll();
      if (claimId) await releaseClaim(admin, claimId);
      continue;
    }
    // Changes ride only an email whose slot is recorded, because that is what
    // marks them told; without it (cap table unreadable) they wait for the next
    // email rather than be told twice. The admin's test send shows them without
    // marking anything.
    const settled = alertsOn.has(userId) && (claimId || opts.ignoreToday) ? pending.get(userId) ?? null : null;
    const built = buildDaily({
      siteUrl: base,
      pick: null,
      teasers: [],
      profiles: parts.map((p) => p.deals),
      unfunded,
      // Each change names its profile once the member has two.
      changes: (settled?.changes ?? []).map((c) => ({ ...c, profileName: labelFor(profileRows?.get(userId), c.profileId) })),
      freeCutoffIso: who.paid ? null : freeVisibility.cutoffIso,
      unsubscribe,
      // Batch 12: "Your profile is 60% done" while it is not complete (never for a team member).
      profileNudge: nudges.has(userId) ? { percent: nudges.get(userId)!, url: `${base.replace(/\/$/, "")}/profile`, pence: settings.profileCompletePence } : null,
    });
    const mail = built ? renderEmail(built.message) : null;
    const failRows = async () => {
      for (const r of sentRows) {
        const { error: failErr } = await admin.from("sourcing_sent").update({ status: "failed" }).eq("id", r.id);
        if (failErr) console.error("[sourcing] failed-status update failed:", failErr.message);
      }
    };
    const withRows = parts.filter((p) => p.row).map((p) => ({ member: p.member, candidates: p.candidates }));
    if (!built || !mail) {
      // Unreachable with a pick in hand; kept so a future change cannot send nothing and charge.
      if (claimId) await releaseClaim(admin, claimId);
      await failRows();
      unholdAll();
      fail("build_failed", withRows);
      continue;
    }
    if (built.droppedTeasers.length > 0) console.error("[sourcing] early-access backstop dropped teasers", JSON.stringify({ user: userId, dropped: built.droppedTeasers }));
    const sendSummary = { pickId: sentRows[0].id, pickIds: sentRows.map((r) => r.id), pickDealId: sentRows[0].dealId, teasers: built.teaserIds, alerts: built.changeIds, droppedTeasers: built.droppedTeasers, todayReady: parts.every((p) => plans.get(p.member.key) != null), profiles: parts.length, subject: mail.subject };
    // A failed write here leaves the row "claimed", which a later run could take
    // over after five minutes; the send below still carries the slot's
    // idempotency key, so Resend refuses any second, different daily email.
    if (claimId && !(await markSending(admin, claimId, sendSummary, null))) console.error("[sourcing] mark sending failed; relying on the idempotency key", JSON.stringify({ user: userId }));
    const res = await sendEmail({
      to: who.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      headers: mail.headers,
      idempotencyKey: opts.ignoreToday ? testSendKey(sentRows[0].token) : sendKey("daily", userId, day),
    });
    if (!res.sent) {
      summary.emailFailures += 1;
      unholdAll();
      fail(res.reason ?? "send_failed", withRows);
      // Kept as failed: Resend may have accepted the message even though we saw an error.
      await failRows();
      // The slot is spent for today and its alerts stay pending for tomorrow's email.
      if (claimId) await finishSend(admin, claimId, false, sendSummary, []);
      continue;
    }
    // The slot sent and its alerts told, straight away: nothing between the
    // send and this record can be interrupted into telling them twice.
    if (claimId) await finishSend(admin, claimId, true, sendSummary, closingIds(built, settled));
    summary.emails += 1;
    summary.sections += parts.length;
    summary.unfunded += unfunded.length;
    const sentAt = new Date().toISOString();
    for (const [i, part] of parts.entries()) {
      const m = part.member;
      let transactionId: number | null = null;
      // What was actually taken for the pick: the records below say this, never more.
      let charged = 0;
      const row = part.row;
      if (row) {
        perUser.push({ user: userId, ...seatOf(m), basis: m.basis, candidates: part.candidates, sent: true });
        const { error: sentErr } = await admin.from("sourcing_sent").update({ status: "sent", sent_at: sentAt }).eq("id", row.id);
        if (sentErr) console.error("[sourcing] sent-status update failed:", sentErr.message);
        if (row.charge > 0) {
          try {
            // allowNegative only covers the race between the balance check above and this debit.
            const memberMeta = payer.memberId ? { member_id: payer.memberId } : {};
            const profileMeta = m.profile ? { profile_id: m.profile.id } : {};
            transactionId = await debit(payer.payerId, row.charge, {
              allowNegative: true,
              meta: row.dealId
                ? { action: "cron:sourcing", action_id: row.id, provider: "marketplace", unit: "deal_open", quantity: 1, unit_cost_pence: 0, markup: 1, raw_cost_pence: 0, description: `Daily pick (deal sheet): ${row.sending.listing.address ?? row.sending.listing.title}`, ...memberMeta, ...profileMeta }
                : { action: "cron:sourcing", action_id: row.id, provider: "pmi", unit: "daily_pick", quantity: 1, unit_cost_pence: price.unitCostPence, markup: price.markup, raw_cost_pence: price.rawPence, description: `Daily pick: ${row.sending.listing.address ?? row.sending.listing.title}`, ...memberMeta, ...profileMeta },
            });
            charged = row.charge;
            summary.chargedBasePence += row.charge;
            void afterDebit(payer.payerId).catch(() => {});
          } catch (err) {
            console.error("[sourcing] pick debit failed:", (err as Error)?.message ?? err);
            // The pick went uncharged: its row must not say otherwise.
            const { error: zeroErr } = await admin.from("sourcing_sent").update({ charged_base_pence: 0 }).eq("id", row.id);
            if (zeroErr) console.error("[sourcing] pick price reset failed:", zeroErr.message);
          }
        }
      }
      // From the new pricing date: one day of daily deals for each profile the
      // email carried deals for, once per profile per day, to the payer. Never
      // on the admin's test send.
      const told = row !== null || (built.teasersByPart[i]?.length ?? 0) > 0;
      let dayCharged = false;
      if (mode === "per_day" && !m.admin && !opts.ignoreToday && told) {
        const dayCharge = await chargeDailyDeals(admin, { userId, payerId: payer.payerId, memberId: payer.memberId, day, pence: dailyPence, run: "picks", sendRef: row?.id ?? null, profile: m.profile ? { id: m.profile.id, active: m.profile.isActive } : null });
        if (dayCharge.charged) {
          summary.chargedBasePence += dailyPence;
          transactionId = dayCharge.transactionId;
          dayCharged = true;
        }
      }
      // What this profile held and was not taken (already charged today, a
      // failed debit, nothing told after all) goes back for the rest of the team.
      if (!dayCharged && charged <= 0) unholdSeat(m);
      if (row?.dealId) {
        // The pick IS the open: the member holds the page-verified listing, so
        // the sheet on /deals is theirs from now on. Before the new pricing it
        // records the deal's price paid; from it, the pick is included in the
        // day (recorded at 0, against the day's charge), so a Full analysis of
        // it later is the full price. Tagged with the profile only when the
        // member pays for themselves: a team open belongs to the owner.
        const { error: openErr } = await admin.from("deal_opens").upsert(
          // The team's open, like one pressed on /deals: the owner paid for it.
          { user_id: payer.payerId, canonical_url: row.sending.listing.canonicalUrl, deal_id: row.dealId, status: "open", charged_base_pence: charged, transaction_id: transactionId, verified_via: "pick", status_at_open: "available", band_at_open: row.sending.screening?.band ?? null, annual_profit_at_open: row.sending.screening?.surplus ?? null, fetched: false, ...(m.profile && payer.payerId === userId ? { profile_id: m.profile.id } : {}) },
          { onConflict: "user_id,canonical_url", ignoreDuplicates: true },
        );
        if (openErr) console.error("[sourcing] auto-open insert failed:", openErr.message);
      }
    }
    const { error: profErr } = await admin.from("profiles").update({ sourcing_last_sent_at: sentAt }).eq("id", userId);
    if (profErr) console.error("[sourcing] profile update failed:", profErr.message);
  }

  return done({ status: 200, body: { ...summary, ms: elapsed(), skipped, members: perUser } });
}
