import "server-only";

import { createAdminClient } from "../supabase/admin";
import { getAreaCardsWithin } from "../market/cached";
import { parseMarketGoals, describeGoals, type MarketGoals } from "../market/goals";
import { personaliseScore, personalInputFor } from "../market/personalise";
import { areaCentroid } from "../market/area-centroids";
import { ask, sourcingListings } from "../broker";
import { runMetered, newActionId } from "../credit/context";
import { getBalance, debit } from "../credit/ledger";
import { getUnitCostTable } from "../credit/unit-costs";
import { afterDebit } from "../credit/after-debit";
import { isAdminEmail } from "../admin";
import { isPaused } from "../access";
import { findOutcode } from "./html";
import { queriesForGoals, dealForSourced, rankPicks, withinQueryPrice, listingAge, medianAgeDays, rentPcm, type AreaRef, type SourcedListing, type SourcingQuery, type SourcedPick } from "./sourcing";
import { motivationFromListing, motivationFromSnapshot, meetsMotivationBar, NO_MOTIVATION, type Motivation } from "./motivation";
import { analyseRelaxation, closestMatch, describeRelaxation, toStoredRelaxation, type Dimension, type NearMiss, type Relaxation } from "./relax";
import { blendFit } from "./pipeline";
import { thresholdDaysFor, type MotivationGoals } from "../market/goals";
import { houseQueries, applyQueryFeedback, applyCandidateFeedback, feedbackRules, dealScoreOf, pickEmail, pickPrice, newPickToken, startOfTodayUtc, cleanReasons, type PickBasis, type PickFeedback } from "./picks";
import type { Deal } from "./deal";
import { resolveListing } from "./server";
import { suitabilityFromListing, suitabilityFromSnapshot, type Suitability, type UnsuitableReason } from "./suitability";
import type { ListingSnapshot } from "./types";
import type { AppliedRules } from "./picks";
import { sendEmail, isEmailConfigured } from "../email/send";
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
// produce two picks. After a successful send the member is debited one
// daily_pick unit (2p raw × markup, 10p at the seed table); admins are never
// charged.
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
const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const FEEDBACK_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;
/** How far down a member's ranking the pick may reach when better candidates are capped or unsuitable. */
const SPREAD_DEPTH = 40;
/** How many members may receive the same listing in one day (across passes). */
const DAILY_LISTING_CAP = 3;
/**
 * A listing in one of these states cannot be acted on, so it is never sent.
 * `under_offer` is deliberately absent: chains collapse, and a sale that fell
 * through is a reason to look harder, not to hide the listing.
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

type ProfileRow = {
  id: string;
  email: string | null;
  market_goals: unknown;
  plan_code: string | null;
  subscription_paused_from: string | null;
  subscription_paused_until: string | null;
  sourcing_last_sent_at: string | null;
};

interface Member {
  id: string;
  email: string;
  admin: boolean;
  goals: MarketGoals | null;
  basis: PickBasis;
  firstEver: boolean;
  queries: SourcingQuery[];
  areaFit: Map<string, number | null>;
  /** What this member's own answers changed, after contradictions cancel. */
  rules: AppliedRules;
}

type Candidate = { listing: SourcedListing; deal: ReturnType<typeof dealForSourced>; areaFit: number | null; areaName: string; motivation?: Motivation | null; motivationQualifies?: boolean };
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
  const pickBasePence = price.basePence;

  // ── Audience: picks on, signed in at least once; starved members first ──
  const profiles: ProfileRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = admin
      .from("profiles")
      .select("id, email, market_goals, plan_code, subscription_paused_from, subscription_paused_until, sourcing_last_sent_at")
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

  const savedByUser = new Map<string, string[]>();
  const sentToday = new Set<string>();
  const feedbackByUser = new Map<string, PickFeedback[]>();
  const feedbackSince = new Date(Date.now() - FEEDBACK_WINDOW_MS).toISOString();
  type FeedbackRow = { user_id: string; canonical_url: string; reaction: unknown; reaction_source: unknown; reasons: unknown; kind: unknown; postcode_area: unknown; deal: unknown };
  const feedbackRows: FeedbackRow[] = [];
  for (const some of chunk(ids, ID_CHUNK)) {
    const [savedRes, todayRes, fbRes] = await Promise.all([
      admin.from("saved_areas").select("user_id, postcode_area").in("user_id", some),
      admin.from("sourcing_sent").select("user_id").in("user_id", some).gte("sent_at", todayIso),
      admin.from("sourcing_sent").select("user_id, canonical_url, reaction, reaction_source, reasons, kind, postcode_area, deal").in("user_id", some).not("reaction", "is", null).gte("responded_at", feedbackSince),
    ]);
    for (const s of (savedRes.data ?? []) as { user_id: string; postcode_area: string }[]) savedByUser.set(s.user_id, [...(savedByUser.get(s.user_id) ?? []), s.postcode_area.toUpperCase()]);
    for (const r of (todayRes.data ?? []) as { user_id: string }[]) sentToday.add(r.user_id);
    if (fbRes.error) console.warn("[sourcing] feedback select failed (schema behind?):", fbRes.error.message);
    feedbackRows.push(...((fbRes.data ?? []) as FeedbackRow[]));
  }
  // The listing behind each piece of feedback (size, type, price) comes from the shared snapshot.
  const feedbackListing = new Map<string, SourcedListing>();
  for (const urls of chunk([...new Set(feedbackRows.map((r) => r.canonical_url))], URL_CHUNK)) {
    const { data } = await admin.from("sourced_listings").select("canonical_url, snapshot").in("canonical_url", urls);
    for (const r of (data ?? []) as { canonical_url: string; snapshot: SourcedListing }[]) feedbackListing.set(r.canonical_url, r.snapshot);
  }
  for (const r of feedbackRows) {
    const l = feedbackListing.get(r.canonical_url) ?? null;
    const amount = l?.price ? (l.kind === "rent" ? (l.price.period === "pw" ? Math.round((l.price.amount * 52) / 12) : l.price.amount) : l.price.period === "total" ? l.price.amount : null) : null;
    feedbackByUser.set(r.user_id, [
      ...(feedbackByUser.get(r.user_id) ?? []),
      {
        reaction: r.reaction === "yes" || r.reaction === "no" ? r.reaction : null,
        reactionSource: r.reaction_source === "form" || r.reaction_source === "link" ? r.reaction_source : null,
        reasons: cleanReasons(r.reasons),
        kind: r.kind === "sale" || r.kind === "rent" ? r.kind : null,
        postcodeArea: typeof r.postcode_area === "string" ? r.postcode_area : null,
        bedrooms: l?.bedrooms ?? null,
        amount,
        rawType: l?.rawType ?? null,
        // Older stored snapshots carry no outcode; the postcode still has one.
        outcode: l?.outcode ?? findOutcode(l?.postcode ?? l?.address ?? null),
        dealScore: dealScoreOf((r.deal as Deal | null) ?? null),
      },
    ]);
  }

  const members: Member[] = [];
  const skipped: { user: string; reason: string }[] = [];
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
    const goals = parseMarketGoals(p.market_goals);
    const rules = feedbackRules(feedbackByUser.get(p.id) ?? []);
    const areaFit = new Map<string, number | null>();
    let queries: SourcingQuery[] = [];
    let basis: PickBasis = "house";
    if (goals) {
      const refs: AreaRef[] = cards.map((card) => {
        const fit = personaliseScore(personalInputFor(card, goals), goals)?.score ?? card.score?.score ?? null;
        areaFit.set(card.code, fit);
        return { code: card.code, name: card.name, slug: card.slug, centroid: areaCentroid(card.code), fit };
      });
      queries = queriesForGoals(goals, savedByUser.get(p.id) ?? [], refs);
      if (queries.length > 0) basis = "goals";
    }
    if (queries.length === 0) queries = houseQueries(cards, goals);
    queries = applyQueryFeedback(queries, feedbackByUser.get(p.id) ?? [], rules);
    if (queries.length === 0) {
      skipped.push({ user: p.id, reason: "no_queries" });
      continue;
    }
    members.push({ id: p.id, email: p.email, admin: isAdminEmail(p.email), goals, basis, firstEver: !p.sourcing_last_sent_at, queries, areaFit, rules });
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
  const summary = { dry, enabled, enrolled: profiles.length, members: members.length, queries: queries.length, answered: 0, unavailable: 0, listings: 0, verified: 0, gone: 0, unsuitable, emails: 0, emailFailures: 0, chargedBasePence: 0, ranOutOfTime: false, pickBasePence };
  if (dry) {
    return done({
      status: 200,
      body: {
        ...summary,
        skipped,
        wouldQuery: queries.map((q) => ({ key: q.query.key, members: q.members, own: q.own })),
        wouldEmail: members.map((m) => ({ user: m.id, email: m.email, basis: m.basis, firstEver: m.firstEver, queries: m.queries.map((q) => q.key) })),
      },
    });
  }

  // ── Answer each query through the broker as house spend; remember every listing seen ──
  const byQuery = new Map<string, SourcedListing[]>();
  const seenUrls = new Set<string>();
  for (const { query } of queries) {
    if (elapsed() > QUERY_BUDGET_MS) {
      summary.ranOutOfTime = true;
      break;
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
  for (const some of chunk(members.map((m) => m.id), ID_CHUNK)) {
    const { data: sentRows } = await admin.from("sourcing_sent").select("user_id, canonical_url").in("user_id", some).gte("sent_at", sentSince);
    for (const r of (sentRows ?? []) as { user_id: string; canonical_url: string }[]) sentByUser.set(r.user_id, new Set([...(sentByUser.get(r.user_id) ?? []), r.canonical_url]));
  }
  const cutoff = Date.now() - NEW_WINDOW_MS;

  // ── The back catalogue, for members who asked for motivated sellers ──
  // Every other pick has to be new; this filter is the one case where old is the
  // point. These rows are read from what we have already stored, so they cost a
  // query rather than a provider call.
  const motivatedMembers = members.filter((m) => m.goals && m.goals.motivation.mode !== "off");
  const olderCandidates = new Map<string, SourcedListing[]>();
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
      for (const someIds of chunk(motivatedMembers.map((m) => m.id), ID_CHUNK)) {
        const { data: past } = await admin.from("sourcing_sent").select("user_id, canonical_url").in("user_id", someIds).in("canonical_url", someUrls);
        for (const r of (past ?? []) as { user_id: string; canonical_url: string }[]) {
          sentByUser.set(r.user_id, new Set([...(sentByUser.get(r.user_id) ?? []), r.canonical_url]));
        }
      }
    }
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
  type Ranked = SourcedPick & { precheck: "ok" | "unknown"; nearMiss?: boolean };
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
    const usable = misses.filter((x) => viable.has(x.listing.canonicalUrl));
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
  const perUser: { user: string; basis: PickBasis; candidates: number; sent: boolean; reason?: string }[] = [];
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
      const figures = card ? { byBedrooms: card.byBedrooms.map((b) => ({ bedrooms: b.bedrooms, grossRevenue: b.grossRevenue, adr: b.adr })), headline: { grossRevenue: card.headline.grossRevenue, adr: card.headline.adr } } : null;
      const areaFit = m.goals ? m.areaFit.get(card?.code ?? q.area) ?? null : card?.score?.score ?? null;
      const candidate = {
        listing: l,
        deal: dealForSourced(l, figures, m.goals?.finance ?? null),
        areaFit,
        areaName: card?.name ?? q.areaName,
        precheck,
        motivation,
        motivationQualifies: qualifies,
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
    candidateCount.set(m.id, candidates.length);
    const kept = applyCandidateFeedback(candidates, feedbackByUser.get(m.id) ?? [], m.rules);
    const precheckOf = new Map(kept.map((c) => [c.listing.canonicalUrl, c.precheck]));
    const list = rankPicks(kept, SPREAD_DEPTH, motiv?.mode ?? "off").map((p) => ({ ...p, precheck: precheckOf.get(p.listing.canonicalUrl) ?? "unknown" }) as Ranked);
    const ok = list.filter((p) => p.precheck === "ok");
    // "Could not be run as a short let": only send this member listings that
    // already clear the check on the search card, never ones that need the
    // page to rescue them.
    const unknown = m.rules.strictSuitability ? [] : list.filter((p) => p.precheck !== "ok");
    if (ok.length + unknown.length === 0) {
      // Nothing matched. A strict filter reads as a broken product when it just
      // goes quiet, so send the nearest thing and say which setting stopped the
      // rest — but only when there is a nearest thing whose deal actually works.
      const fallback = motiv ? nearestUsable(nearMisses, m) : null;
      if (!fallback) {
        perUser.push({ user: m.id, basis: m.basis, candidates: candidates.length, sent: false, reason: "nothing_new" });
        continue;
      }
      candidateCount.set(m.id, candidates.length + nearMisses.length);
      relaxationFor.set(m.id, fallback.relaxation);
      ranked.set(m.id, [fallback.pick]);
      continue;
    }
    ranked.set(m.id, [...ok, ...unknown]);
  }
  const withCandidates = members.filter((m) => ranked.has(m.id));

  if (withCandidates.length > 0 && !isEmailConfigured()) {
    for (const m of withCandidates) perUser.push({ user: m.id, basis: m.basis, candidates: candidateCount.get(m.id) ?? 0, sent: false, reason: "email_not_configured" });
    return done({ status: 200, body: { ...summary, ms: elapsed(), skipped, members: perUser } });
  }

  // ── Credit: only members who have a candidate, in parallel chunks ──
  const affordable: Member[] = [];
  for (const some of chunk(withCandidates, 10)) {
    const balances = await Promise.all(some.map((m) => (m.admin || pickBasePence <= 0 ? Promise.resolve(null) : getBalance(m.id).catch(() => null))));
    some.forEach((m, i) => {
      const bal = balances[i];
      if (!m.admin && pickBasePence > 0 && (!bal || bal.spendableBasePence < pickBasePence)) {
        perUser.push({ user: m.id, basis: m.basis, candidates: candidateCount.get(m.id) ?? 0, sent: false, reason: "no_credit" });
        return;
      }
      affordable.push(m);
    });
  }

  // ── Verify each candidate against its listing page (one read per distinct listing, house-metered) ──
  // The page carries what the search card does not: tenure, the shared-
  // ownership flag and the description's line on short lets. The merged
  // listing (photo, confirmed price, evidence) is what gets sent and stored,
  // so tomorrow's pre-check answers without a fetch.
  const verdicts = new Map<string, { verdict: Verdict; listing: SourcedListing; snapshot: ListingSnapshot | null }>();
  const verify = async (l: SourcedListing): Promise<{ verdict: Verdict; listing: SourcedListing; snapshot: ListingSnapshot | null }> => {
    const memo = verdicts.get(l.canonicalUrl);
    if (memo) return memo;
    if (elapsed() > VERIFY_UNTIL_MS) return { verdict: "unverified", listing: l, snapshot: null };
    try {
      let res = await runMetered({ userId: null, admin: false, action: "cron:sourcing", actionId: newActionId() }, () => resolveListing(l.canonicalUrl));
      // A snapshot cached before the parsers learned about tenure evidence is re-read once.
      if (res.ok && res.snapshot.shortLetsPermitted === undefined && elapsed() <= VERIFY_UNTIL_MS) {
        res = await runMetered({ userId: null, admin: false, action: "cron:sourcing", actionId: newActionId() }, () => resolveListing(l.canonicalUrl, { refresh: true }));
      }
      if (!res.ok) return { verdict: "unverified", listing: l, snapshot: null };
      const s = res.snapshot;
      const merged: SourcedListing = {
        ...l,
        title: s.title || l.title,
        address: s.displayAddress ?? l.address,
        postcode: s.postcode ?? l.postcode,
        bedrooms: s.bedrooms ?? l.bedrooms,
        bathrooms: s.bathrooms ?? l.bathrooms,
        price: s.price && s.price.period !== "night" ? { amount: s.price.amount, period: s.price.period } : l.price,
        rawType: s.rawType ?? l.rawType,
        photo: s.photos[0] ?? l.photo,
        tenure: s.tenure ?? l.tenure ?? null,
        features: s.features.length > 0 ? s.features : (l.features ?? []),
        priceQualifier: s.price?.qualifier ?? l.priceQualifier ?? null,
        sharedOwnership: s.sharedOwnership ?? false,
        shortLetsPermitted: s.shortLetsPermitted ?? null,
        // The portal's own listing date beats anything the search card had, and
        // is written back so tomorrow's run starts from the better answer.
        listedDate: s.listedDate ?? l.listedDate ?? null,
        agentHash: s.agentHash ?? l.agentHash ?? null,
      };
      // Liveness before suitability: a sold or let-agreed listing is not a pick
      // however well it scores. The search card cannot know this — only the page can.
      const verdict: Verdict = s.status && GONE_STATUSES.has(s.status) ? "gone" : suitabilityFromSnapshot(s, l.kind);
      const out = { verdict, listing: merged, snapshot: s };
      verdicts.set(l.canonicalUrl, out);
      summary.verified += 1;
      void admin.from("sourced_listings").update({ snapshot: merged }).eq("canonical_url", l.canonicalUrl).then(({ error }) => {
        if (error) console.warn("[sourcing] snapshot refresh failed:", error.message);
      });
      return out;
    } catch (err) {
      console.warn("[sourcing] verification failed:", (err as Error)?.message ?? err);
      return { verdict: "unverified", listing: l, snapshot: null };
    }
  };

  // ── One pick per member: the best candidate that passes, under the daily cap ──
  const picks: { member: Member; pick: SourcedPick; alternates: SourcedPick[]; candidates: number; nearMiss: boolean }[] = [];
  for (const m of affordable) {
    const list = ranked.get(m.id) ?? [];
    const candidates = candidateCount.get(m.id) ?? 0;
    const motiv: MotivationGoals | null = m.goals && m.goals.motivation.mode !== "off" ? m.goals.motivation : null;
    // A member's own filter is not capped (their pool is their own); house
    // members share one pool, so capped listings are skipped unless nothing
    // else is left.
    const underCap = m.basis === "goals" ? list : list.filter((p) => (assigned.get(p.listing.canonicalUrl) ?? 0) < DAILY_LISTING_CAP);
    const order = underCap.length > 0 ? underCap : list;
    let chosen: SourcedPick | null = null;
    let outOfTime = false;
    for (const p of order) {
      const { verdict, listing, snapshot } = await verify(p.listing);
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
    if (!chosen) {
      if (outOfTime) summary.ranOutOfTime = true;
      perUser.push({ user: m.id, basis: m.basis, candidates, sent: false, reason: outOfTime ? "out_of_time" : "nothing_suitable" });
      continue;
    }
    assigned.set(chosen.listing.canonicalUrl, (assigned.get(chosen.listing.canonicalUrl) ?? 0) + 1);
    // Stand-ins for a send that collides with a row this member already has.
    // Only listings already verified in this run qualify, so they cost no fetch.
    const alternates: SourcedPick[] = [];
    for (const p of order) {
      if (alternates.length >= MAX_ALTERNATES) break;
      if (p.listing.canonicalUrl === chosen.listing.canonicalUrl) continue;
      const v = verdicts.get(p.listing.canonicalUrl);
      if (v?.verdict === "ok") alternates.push({ ...p, listing: v.listing });
    }
    picks.push({ member: m, pick: chosen, alternates, candidates, nearMiss: Boolean((list[0] as Ranked | undefined)?.nearMiss) });
  }

  // ── Send: pending row first, then the email, then the charge ──
  const base = siteUrl();
  for (const { member: m, pick, alternates, candidates, nearMiss } of picks) {
    if (elapsed() > TIME_BUDGET_MS) {
      summary.ranOutOfTime = true;
      perUser.push({ user: m.id, basis: m.basis, candidates, sent: false, reason: "out_of_time" });
      continue;
    }
    const charge = m.admin ? 0 : pickBasePence;
    const relaxation = nearMiss ? relaxationFor.get(m.id) ?? null : null;
    // Persisted so the "change it" link has something to apply that the member
    // cannot alter in the request. It belongs to the pick the analysis was
    // about, so a stand-in reached after a collision carries nothing.
    const relaxationRow = nearMiss ? toStoredRelaxation(relaxation, pick.listing.kind) : null;
    // (user_id, canonical_url) is unique, so a listing this member already has
    // comes back 23505. That is not a reason to leave them with nothing: try the
    // stand-ins before giving up. Any other error is real and stops the attempt.
    let sending: SourcedPick | null = null;
    let rowId: string | null = null;
    let token = "";
    let insErr: { code?: string; message: string } | null = null;
    for (const cand of [pick, ...alternates]) {
      const attempt = newPickToken();
      const cl = cand.listing;
      const { data: row, error } = await admin
        .from("sourcing_sent")
        .insert({ user_id: m.id, canonical_url: cl.canonicalUrl, sent_at: nowIso, status: "pending", token: attempt, kind: cl.kind, postcode_area: cl.postcodeArea, basis: m.basis, deal: cand.deal, fit: cand.fit, charged_base_pence: charge, relaxation: cand === pick ? relaxationRow : null, motivation: cand.motivation ?? null })
        .select("id")
        .single();
      if (!error && row) {
        sending = cand;
        rowId = String(row.id);
        token = attempt;
        insErr = null;
        break;
      }
      insErr = error ?? { message: "no row returned" };
      if (error?.code !== "23505") break;
    }
    if (!sending || !rowId) {
      perUser.push({ user: m.id, basis: m.basis, candidates, sent: false, reason: insErr?.code === "23505" ? "already_sent" : "insert_failed" });
      if (insErr && insErr.code !== "23505") console.error("[sourcing] sourcing_sent insert failed:", insErr.message);
      continue;
    }
    if (sending !== pick) assigned.set(sending.listing.canonicalUrl, (assigned.get(sending.listing.canonicalUrl) ?? 0) + 1);
    const id = rowId;
    const mail = pickEmail({
      pick: sending,
      siteUrl: base,
      id,
      token,
      basis: m.basis,
      goalsChips: m.goals ? describeGoals(m.goals) : [],
      firstEver: m.firstEver,
      chargedBasePence: charge,
      // A stand-in was only reached because the first choice collided, and it
      // is an ordinary candidate — the near-miss wording belongs to the pick
      // the analysis was actually about.
      nearMiss: nearMiss && sending === pick,
      relaxation: describeRelaxation(relaxation),
    });
    const res = await sendEmail({ to: m.email, subject: mail.subject, html: mail.html, text: mail.text, headers: mail.headers });
    if (!res.sent) {
      summary.emailFailures += 1;
      perUser.push({ user: m.id, basis: m.basis, candidates, sent: false, reason: res.reason });
      // Kept as failed: Resend may have accepted the message even though we saw an error.
      const { error: failErr } = await admin.from("sourcing_sent").update({ status: "failed" }).eq("id", id);
      if (failErr) console.error("[sourcing] failed-status update failed:", failErr.message);
      continue;
    }
    summary.emails += 1;
    perUser.push({ user: m.id, basis: m.basis, candidates, sent: true });
    const sentAt = new Date().toISOString();
    const { error: sentErr } = await admin.from("sourcing_sent").update({ status: "sent", sent_at: sentAt }).eq("id", id);
    if (sentErr) console.error("[sourcing] sent-status update failed:", sentErr.message);
    if (charge > 0) {
      try {
        // allowNegative only covers the race between the balance check above and this debit.
        await debit(m.id, charge, {
          allowNegative: true,
          meta: { action: "cron:sourcing", action_id: id, provider: "pmi", unit: "daily_pick", quantity: 1, unit_cost_pence: price.unitCostPence, markup: price.markup, raw_cost_pence: price.rawPence, description: `Daily pick: ${sending.listing.address ?? sending.listing.title}` },
        });
        summary.chargedBasePence += charge;
        void afterDebit(m.id).catch(() => {});
      } catch (err) {
        console.error("[sourcing] pick debit failed:", (err as Error)?.message ?? err);
      }
    }
    const { error: profErr } = await admin.from("profiles").update({ sourcing_last_sent_at: sentAt }).eq("id", m.id);
    if (profErr) console.error("[sourcing] profile update failed:", profErr.message);
  }

  return done({ status: 200, body: { ...summary, ms: elapsed(), skipped, members: perUser } });
}
