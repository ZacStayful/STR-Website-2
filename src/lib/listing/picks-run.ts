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
import { queriesForGoals, dealForSourced, rankPicks, withinQueryPrice, type AreaRef, type SourcedListing, type SourcingQuery, type SourcedPick } from "./sourcing";
import { houseQueries, applyQueryFeedback, applyCandidateFeedback, feedbackRules, dealScoreOf, pickEmail, pickPrice, newPickToken, startOfTodayUtc, cleanReasons, type PickBasis, type PickFeedback } from "./picks";
import type { Deal } from "./deal";
import { resolveListing } from "./server";
import { suitabilityFromListing, suitabilityFromSnapshot, type Suitability, type UnsuitableReason } from "./suitability";
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

type Candidate = { listing: SourcedListing; deal: ReturnType<typeof dealForSourced>; areaFit: number | null; areaName: string };
type Verdict = Exclude<Suitability, "unknown"> | "unverified";

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
  const summary = { dry, enabled, enrolled: profiles.length, members: members.length, queries: queries.length, answered: 0, unavailable: 0, listings: 0, verified: 0, unsuitable, emails: 0, emailFailures: 0, chargedBasePence: 0, ranOutOfTime: false, pickBasePence };
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
  type Ranked = SourcedPick & { precheck: "ok" | "unknown" };
  const ranked = new Map<string, Ranked[]>();
  const perUser: { user: string; basis: PickBasis; candidates: number; sent: boolean; reason?: string }[] = [];
  const candidateCount = new Map<string, number>();
  for (const m of members) {
    const sent = sentByUser.get(m.id) ?? new Set<string>();
    const seen = new Set<string>();
    const candidates: (Candidate & { precheck: "ok" | "unknown" })[] = [];
    for (const q of m.queries) {
      for (const l of byQuery.get(q.key) ?? []) {
        if (seen.has(l.canonicalUrl) || sent.has(l.canonicalUrl)) continue;
        if ((firstSeen.get(l.canonicalUrl) ?? Date.now()) < cutoff) continue;
        if (q.minBedrooms && l.bedrooms !== null && l.bedrooms < q.minBedrooms) continue;
        if (!withinQueryPrice(l, q)) continue;
        seen.add(l.canonicalUrl);
        const precheck = suitabilityFromListing(l);
        if (precheck !== "ok" && precheck !== "unknown") {
          reject(precheck);
          continue;
        }
        const card = cardByCode.get(l.postcodeArea ?? q.area) ?? cardByCode.get(q.area);
        const figures = card ? { byBedrooms: card.byBedrooms.map((b) => ({ bedrooms: b.bedrooms, grossRevenue: b.grossRevenue, adr: b.adr })), headline: { grossRevenue: card.headline.grossRevenue, adr: card.headline.adr } } : null;
        const areaFit = m.goals ? m.areaFit.get(card?.code ?? q.area) ?? null : card?.score?.score ?? null;
        candidates.push({ listing: l, deal: dealForSourced(l, figures, m.goals?.finance ?? null), areaFit, areaName: card?.name ?? q.areaName, precheck });
      }
    }
    candidateCount.set(m.id, candidates.length);
    const kept = applyCandidateFeedback(candidates, feedbackByUser.get(m.id) ?? [], m.rules);
    const precheckOf = new Map(kept.map((c) => [c.listing.canonicalUrl, c.precheck]));
    const list = rankPicks(kept, SPREAD_DEPTH).map((p) => ({ ...p, precheck: precheckOf.get(p.listing.canonicalUrl) ?? "unknown" }) as Ranked);
    const ok = list.filter((p) => p.precheck === "ok");
    // "Could not be run as a short let": only send this member listings that
    // already clear the check on the search card, never ones that need the
    // page to rescue them.
    const unknown = m.rules.strictSuitability ? [] : list.filter((p) => p.precheck !== "ok");
    if (ok.length + unknown.length === 0) {
      perUser.push({ user: m.id, basis: m.basis, candidates: candidates.length, sent: false, reason: "nothing_new" });
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
  const verdicts = new Map<string, { verdict: Verdict; listing: SourcedListing }>();
  const verify = async (l: SourcedListing): Promise<{ verdict: Verdict; listing: SourcedListing }> => {
    const memo = verdicts.get(l.canonicalUrl);
    if (memo) return memo;
    if (elapsed() > VERIFY_UNTIL_MS) return { verdict: "unverified", listing: l };
    try {
      let res = await runMetered({ userId: null, admin: false, action: "cron:sourcing", actionId: newActionId() }, () => resolveListing(l.canonicalUrl));
      // A snapshot cached before the parsers learned about tenure evidence is re-read once.
      if (res.ok && res.snapshot.shortLetsPermitted === undefined && elapsed() <= VERIFY_UNTIL_MS) {
        res = await runMetered({ userId: null, admin: false, action: "cron:sourcing", actionId: newActionId() }, () => resolveListing(l.canonicalUrl, { refresh: true }));
      }
      if (!res.ok) return { verdict: "unverified", listing: l };
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
      };
      const verdict = suitabilityFromSnapshot(s, l.kind);
      const out = { verdict, listing: merged };
      verdicts.set(l.canonicalUrl, out);
      summary.verified += 1;
      void admin.from("sourced_listings").update({ snapshot: merged }).eq("canonical_url", l.canonicalUrl).then(({ error }) => {
        if (error) console.warn("[sourcing] snapshot refresh failed:", error.message);
      });
      return out;
    } catch (err) {
      console.warn("[sourcing] verification failed:", (err as Error)?.message ?? err);
      return { verdict: "unverified", listing: l };
    }
  };

  // ── One pick per member: the best candidate that passes, under the daily cap ──
  const picks: { member: Member; pick: SourcedPick; candidates: number }[] = [];
  for (const m of affordable) {
    const list = ranked.get(m.id) ?? [];
    const candidates = candidateCount.get(m.id) ?? 0;
    // A member's own filter is not capped (their pool is their own); house
    // members share one pool, so capped listings are skipped unless nothing
    // else is left.
    const underCap = m.basis === "goals" ? list : list.filter((p) => (assigned.get(p.listing.canonicalUrl) ?? 0) < DAILY_LISTING_CAP);
    const order = underCap.length > 0 ? underCap : list;
    let chosen: SourcedPick | null = null;
    let outOfTime = false;
    for (const p of order) {
      const { verdict, listing } = await verify(p.listing);
      if (verdict === "ok" || (verdict === "unverified" && p.precheck === "ok")) {
        chosen = { ...p, listing };
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
      reject(verdict);
    }
    if (!chosen) {
      if (outOfTime) summary.ranOutOfTime = true;
      perUser.push({ user: m.id, basis: m.basis, candidates, sent: false, reason: outOfTime ? "out_of_time" : "nothing_suitable" });
      continue;
    }
    assigned.set(chosen.listing.canonicalUrl, (assigned.get(chosen.listing.canonicalUrl) ?? 0) + 1);
    picks.push({ member: m, pick: chosen, candidates });
  }

  // ── Send: pending row first, then the email, then the charge ──
  const base = siteUrl();
  for (const { member: m, pick, candidates } of picks) {
    if (elapsed() > TIME_BUDGET_MS) {
      summary.ranOutOfTime = true;
      perUser.push({ user: m.id, basis: m.basis, candidates, sent: false, reason: "out_of_time" });
      continue;
    }
    const l = pick.listing;
    const token = newPickToken();
    const charge = m.admin ? 0 : pickBasePence;
    const { data: row, error: insErr } = await admin
      .from("sourcing_sent")
      .insert({ user_id: m.id, canonical_url: l.canonicalUrl, sent_at: nowIso, status: "pending", token, kind: l.kind, postcode_area: l.postcodeArea, basis: m.basis, deal: pick.deal, fit: pick.fit, charged_base_pence: charge })
      .select("id")
      .single();
    if (insErr || !row) {
      // 23505: this listing, or today's pick, already exists for the member (an overlapping run).
      perUser.push({ user: m.id, basis: m.basis, candidates, sent: false, reason: insErr?.code === "23505" ? "already_sent" : "insert_failed" });
      if (insErr && insErr.code !== "23505") console.error("[sourcing] sourcing_sent insert failed:", insErr.message);
      continue;
    }
    const id = String(row.id);
    const mail = pickEmail({ pick, siteUrl: base, id, token, basis: m.basis, goalsChips: m.goals ? describeGoals(m.goals) : [], firstEver: m.firstEver, chargedBasePence: charge });
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
          meta: { action: "cron:sourcing", action_id: id, provider: "pmi", unit: "daily_pick", quantity: 1, unit_cost_pence: price.unitCostPence, markup: price.markup, raw_cost_pence: price.rawPence, description: `Daily pick: ${l.address ?? l.title}` },
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
