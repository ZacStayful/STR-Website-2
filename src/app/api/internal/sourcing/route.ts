import { createAdminClient } from "@/lib/supabase/admin";
import { getAreaCards } from "@/lib/market/cached";
import { parseMarketGoals, describeGoals, type MarketGoals } from "@/lib/market/goals";
import { personaliseScore, personalInputFor } from "@/lib/market/personalise";
import { areaCentroid } from "@/lib/market/area-centroids";
import { ask, sourcingListings } from "@/lib/broker";
import { runMetered, newActionId } from "@/lib/credit/context";
import { getBalance, debit } from "@/lib/credit/ledger";
import { getUnitCostTable } from "@/lib/credit/unit-costs";
import { afterDebit } from "@/lib/credit/after-debit";
import { isAdminEmail } from "@/lib/admin";
import { isPaused } from "@/lib/access";
import { queriesForGoals, dealForSourced, rankPicks, withinQueryPrice, type AreaRef, type SourcedListing, type SourcingQuery, type SourcedPick } from "@/lib/listing/sourcing";
import { houseQueries, applyQueryFeedback, applyCandidateFeedback, pickEmail, pickPrice, newPickToken, startOfTodayUtc, cleanReasons, type PickBasis, type PickFeedback } from "@/lib/listing/picks";
import { resolveListing } from "@/lib/listing/server";
import { sendEmail, isEmailConfigured } from "@/lib/email/send";
import { siteUrl } from "@/lib/url";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── Daily picks ──────────────────────────────────────────────────────
// Vercel cron (vercel.json: 07:00 UTC, with a resumable second pass at 07:20).
// Sending is ON unless SOURCING_ENABLED=false, the kill switch (?dry=1 works
// either way and never writes or sends). Every member with picks on
// (profiles.sourcing_alerts, default on) who has signed in at least once gets
// AT MOST ONE listing a day: paused subscriptions, members already sent today
// and members with less than one pick's worth of credit are skipped.
//
// Members with a usable filter (market_goals with areas) are searched on it;
// everyone else gets a "house" pick from the best-scoring areas, using their
// own kind / budget / bedrooms when they have goals but no areas. Identical
// queries are shared across members and answered once a day by the broker
// (PMI listings, then an OnTheMarket results page) as house spend. Listings
// first seen in the last week that the member has not been sent are priced
// on area figures, filtered by the member's confirmed feedback, ranked by fit,
// and the best one is emailed. The pick row is inserted BEFORE the send
// (status pending → sent / failed): the (user, url) primary key plus the
// "sent today" guard mean an overlapping run or a crash mid-send can never
// produce two picks. After a successful send the member is debited one
// daily_pick unit (2p raw × markup, 10p at the seed table).
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/sourcing?dry=1"

export const runtime = "nodejs";
export const maxDuration = 60;

const TIME_BUDGET_MS = 50_000;
/** The query phase stops here so the send loop always gets time. */
const QUERY_BUDGET_MS = 25_000;
/** Photo hydration of picks (one page fetch each) stops here. */
const HYDRATE_UNTIL_MS = 34_000;
const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const FEEDBACK_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;
const PICKS_PER_EMAIL = 1;
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
}

type Candidate = { listing: SourcedListing; deal: ReturnType<typeof dealForSourced>; areaFit: number | null; areaName: string };

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  // A dry run writes and sends nothing, so it is allowed while sending is off:
  // that is how the audience and queries are checked before the flag is flipped.
  const enabled = process.env.SOURCING_ENABLED !== "false";
  const dry = new URL(request.url).searchParams.get("dry") === "1";
  if (!enabled && !dry) return Response.json({ enabled: false, reason: "SOURCING_ENABLED is 'false'" });
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return Response.json({ error: "Storage not configured" }, { status: 503 });
  }
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const nowIso = new Date().toISOString();
  const todayIso = startOfTodayUtc().toISOString();

  const cards = await getAreaCards().catch(() => []);
  if (cards.length === 0) return Response.json({ error: "Market data unavailable; nothing sent" }, { status: 503 });
  const cardByCode = new Map(cards.map((c) => [c.code, c]));
  const price = pickPrice(await getUnitCostTable());
  const pickBasePence = price.basePence;

  // ── Audience: picks on, signed in at least once; starved members first ──
  const profiles: ProfileRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("profiles")
      .select("id, email, market_goals, plan_code, subscription_paused_from, subscription_paused_until, sourcing_last_sent_at")
      .eq("sourcing_alerts", true)
      .not("welcome_checked_at", "is", null)
      .order("sourcing_last_sent_at", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("[sourcing] profiles select failed:", error.message);
      return Response.json({ error: "Query failed" }, { status: 500 });
    }
    profiles.push(...((data ?? []) as ProfileRow[]));
    if ((data?.length ?? 0) < PAGE) break;
  }
  const ids = profiles.map((p) => p.id);

  const savedByUser = new Map<string, string[]>();
  const sentToday = new Set<string>();
  const feedbackByUser = new Map<string, PickFeedback[]>();
  const feedbackSince = new Date(Date.now() - FEEDBACK_WINDOW_MS).toISOString();
  type FeedbackRow = { user_id: string; canonical_url: string; reaction: unknown; reaction_source: unknown; reasons: unknown; kind: unknown; postcode_area: unknown };
  const feedbackRows: FeedbackRow[] = [];
  for (const some of chunk(ids, ID_CHUNK)) {
    const [savedRes, todayRes, fbRes] = await Promise.all([
      admin.from("saved_areas").select("user_id, postcode_area").in("user_id", some),
      admin.from("sourcing_sent").select("user_id").in("user_id", some).gte("sent_at", todayIso),
      admin.from("sourcing_sent").select("user_id, canonical_url, reaction, reaction_source, reasons, kind, postcode_area").in("user_id", some).not("reaction", "is", null).gte("responded_at", feedbackSince),
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
    if (sentToday.has(p.id)) {
      skipped.push({ user: p.id, reason: "already_today" });
      continue;
    }
    const goals = parseMarketGoals(p.market_goals);
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
    queries = applyQueryFeedback(queries, feedbackByUser.get(p.id) ?? []);
    if (queries.length === 0) {
      skipped.push({ user: p.id, reason: "no_queries" });
      continue;
    }
    members.push({ id: p.id, email: p.email, admin: isAdminEmail(p.email), goals, basis, firstEver: !p.sourcing_last_sent_at, queries, areaFit });
  }

  // Shared query set, most-wanted first, capped per run.
  const demand = new Map<string, { query: SourcingQuery; members: number }>();
  for (const m of members) for (const q of m.queries) demand.set(q.key, { query: q, members: (demand.get(q.key)?.members ?? 0) + 1 });
  const queries = [...demand.values()].sort((a, b) => b.members - a.members).slice(0, maxQueries());

  const summary = { dry, enabled, enrolled: profiles.length, members: members.length, queries: queries.length, answered: 0, unavailable: 0, listings: 0, emails: 0, emailFailures: 0, chargedBasePence: 0, hydrated: 0, ranOutOfTime: false, pickBasePence };
  if (dry) {
    return Response.json({
      ...summary,
      skipped,
      wouldQuery: queries.map((q) => ({ key: q.query.key, members: q.members })),
      wouldEmail: members.map((m) => ({ user: m.id, basis: m.basis, firstEver: m.firstEver, queries: m.queries.map((q) => q.key) })),
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

  // ── One pick per member ──
  const picks: { member: Member; pick: SourcedPick; candidates: number }[] = [];
  const perUser: { user: string; basis: PickBasis; candidates: number; sent: boolean; reason?: string }[] = [];
  for (const m of members) {
    const sent = sentByUser.get(m.id) ?? new Set<string>();
    const seen = new Set<string>();
    const candidates: Candidate[] = [];
    for (const q of m.queries) {
      for (const l of byQuery.get(q.key) ?? []) {
        if (seen.has(l.canonicalUrl) || sent.has(l.canonicalUrl)) continue;
        if ((firstSeen.get(l.canonicalUrl) ?? Date.now()) < cutoff) continue;
        if (q.minBedrooms && l.bedrooms !== null && l.bedrooms < q.minBedrooms) continue;
        if (!withinQueryPrice(l, q)) continue;
        seen.add(l.canonicalUrl);
        const card = cardByCode.get(l.postcodeArea ?? q.area) ?? cardByCode.get(q.area);
        const figures = card ? { byBedrooms: card.byBedrooms.map((b) => ({ bedrooms: b.bedrooms, grossRevenue: b.grossRevenue, adr: b.adr })), headline: { grossRevenue: card.headline.grossRevenue, adr: card.headline.adr } } : null;
        const areaFit = m.goals ? m.areaFit.get(card?.code ?? q.area) ?? null : card?.score?.score ?? null;
        candidates.push({ listing: l, deal: dealForSourced(l, figures, m.goals?.finance ?? null), areaFit, areaName: card?.name ?? q.areaName });
      }
    }
    const kept = applyCandidateFeedback(candidates, feedbackByUser.get(m.id) ?? []);
    const [pick] = rankPicks(kept, PICKS_PER_EMAIL);
    if (!pick) {
      perUser.push({ user: m.id, basis: m.basis, candidates: candidates.length, sent: false, reason: "nothing_new" });
      continue;
    }
    picks.push({ member: m, pick, candidates: candidates.length });
  }

  if (picks.length > 0 && !isEmailConfigured()) {
    for (const p of picks) perUser.push({ user: p.member.id, basis: p.member.basis, candidates: p.candidates, sent: false, reason: "email_not_configured" });
    return Response.json({ ...summary, ms: elapsed(), skipped, members: perUser });
  }

  // ── Credit: only members who would actually get a pick, in parallel chunks ──
  const affordable: typeof picks = [];
  for (const some of chunk(picks, 10)) {
    const balances = await Promise.all(some.map((p) => (p.member.admin || pickBasePence <= 0 ? Promise.resolve(null) : getBalance(p.member.id).catch(() => null))));
    some.forEach((p, i) => {
      const bal = balances[i];
      if (!p.member.admin && pickBasePence > 0 && (!bal || bal.spendableBasePence < pickBasePence)) {
        perUser.push({ user: p.member.id, basis: p.member.basis, candidates: p.candidates, sent: false, reason: "no_credit" });
        return;
      }
      affordable.push(p);
    });
  }

  // ── Photo hydration: one page fetch per distinct pick without an image, house-metered, while time allows ──
  const hydrated = new Map<string, SourcedListing>();
  for (const { pick } of affordable) {
    const l = pick.listing;
    if (l.photo || hydrated.has(l.canonicalUrl)) continue;
    if (elapsed() > HYDRATE_UNTIL_MS) break;
    try {
      const res = await runMetered({ userId: null, admin: false, action: "cron:sourcing", actionId: newActionId() }, () => resolveListing(l.canonicalUrl));
      if (!res.ok) continue;
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
        photo: s.photos[0] ?? null,
      };
      hydrated.set(l.canonicalUrl, merged);
      summary.hydrated += 1;
      void admin.from("sourced_listings").update({ snapshot: merged }).eq("canonical_url", l.canonicalUrl).then(({ error }) => {
        if (error) console.warn("[sourcing] snapshot refresh failed:", error.message);
      });
    } catch (err) {
      console.warn("[sourcing] hydration failed:", (err as Error)?.message ?? err);
    }
  }

  // ── Send: pending row first, then the email, then the charge ──
  const base = siteUrl();
  for (const { member: m, pick: raw, candidates } of affordable) {
    if (elapsed() > TIME_BUDGET_MS) {
      summary.ranOutOfTime = true;
      perUser.push({ user: m.id, basis: m.basis, candidates, sent: false, reason: "out_of_time" });
      continue;
    }
    const pick: SourcedPick = { ...raw, listing: hydrated.get(raw.listing.canonicalUrl) ?? raw.listing };
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

  return Response.json({ ...summary, ms: elapsed(), skipped, members: perUser });
}
