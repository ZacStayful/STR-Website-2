import { createAdminClient } from "@/lib/supabase/admin";
import { getAreaCards } from "@/lib/market/cached";
import { parseMarketGoals, type MarketGoals } from "@/lib/market/goals";
import { personaliseScore, personalInputFor } from "@/lib/market/personalise";
import { areaCentroid } from "@/lib/market/area-centroids";
import { ask, sourcingListings } from "@/lib/broker";
import { runMetered, newActionId } from "@/lib/credit/context";
import { getBalance } from "@/lib/credit/ledger";
import { isEnforcing } from "@/lib/credit/http";
import { perksFor, sourcingRunsToday } from "@/lib/credit/perks";
import { isAdminEmail } from "@/lib/admin";
import { queriesForGoals, dealForSourced, rankPicks, sourcingEmail, type AreaRef, type SourcedListing, type SourcingQuery } from "@/lib/listing/sourcing";
import { sendEmail, isEmailConfigured } from "@/lib/email/send";
import { siteUrl } from "@/lib/url";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── Deal-sourcing digest ─────────────────────────────────────────────
// Vercel cron (vercel.json, 07:00 UTC daily). Ships dark: SOURCING_ENABLED=true
// turns it on, and only members who ticked "deal sourcing" under Edit goals are
// included. Cadence comes from the member's plan perks: weekly (Mondays) for
// free / Starter / Pro, daily for Scale. Each query's provider call is charged
// to the first member who wanted it (later members share the cached answer for
// free); members with no spendable credit are skipped for the run. For each member: their saved areas plus areas within their
// distance limit (best fit first, capped at five) × buy / rent-to-rent ×
// budget × bedrooms become queries; identical queries are shared across
// members and answered once a day by the broker (PMI listings, then an
// OnTheMarket results page). Listings first seen in the last week that the
// member has not been sent before are priced on area figures, ranked by fit,
// and the top five are emailed. What was sent is recorded only after the
// send succeeds.
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/sourcing?dry=1"

export const runtime = "nodejs";
export const maxDuration = 60;

const TIME_BUDGET_MS = 50_000;
const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const PICKS_PER_EMAIL = 5;

function maxQueries(): number {
  const n = Number(process.env.SOURCING_MAX_QUERIES_PER_RUN ?? 150);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 150;
}

type ProfileRow = { id: string; email: string | null; market_goals: unknown; plan_code: string | null };

interface Member {
  id: string;
  email: string;
  goals: MarketGoals;
  profile: ProfileRow;
  savedAreas: string[];
  queries: SourcingQuery[];
  areaFit: Map<string, number | null>;
}

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.SOURCING_ENABLED !== "true") return Response.json({ enabled: false, reason: "SOURCING_ENABLED is not 'true'" });

  const dry = new URL(request.url).searchParams.get("dry") === "1";
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return Response.json({ error: "Storage not configured" }, { status: 503 });
  }
  const started = Date.now();
  const nowIso = new Date().toISOString();

  const cards = await getAreaCards().catch(() => []);
  if (cards.length === 0) return Response.json({ error: "Market data unavailable; nothing sent" }, { status: 503 });
  const cardByCode = new Map(cards.map((c) => [c.code, c]));

  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id, email, market_goals, plan_code")
    .eq("sourcing_alerts", true)
    .not("market_goals", "is", null);
  if (error) {
    console.error("[sourcing] profiles select failed:", error.message);
    return Response.json({ error: "Query failed" }, { status: 500 });
  }
  const ids = (profiles ?? []).map((p) => p.id as string);
  const { data: saved } = ids.length ? await admin.from("saved_areas").select("user_id, postcode_area").in("user_id", ids) : { data: [] as { user_id: string; postcode_area: string }[] };
  const savedByUser = new Map<string, string[]>();
  for (const s of (saved ?? []) as { user_id: string; postcode_area: string }[]) savedByUser.set(s.user_id, [...(savedByUser.get(s.user_id) ?? []), s.postcode_area.toUpperCase()]);

  // Members with usable goals and access; each gets their areas ranked by personal fit.
  const members: Member[] = [];
  const skipped: { user: string; reason: string }[] = [];
  for (const p of (profiles ?? []) as ProfileRow[]) {
    const goals = parseMarketGoals(p.market_goals);
    if (!goals) {
      skipped.push({ user: p.id, reason: "no_goals" });
      continue;
    }
    if (!p.email) {
      skipped.push({ user: p.id, reason: "no_email" });
      continue;
    }
    if (!sourcingRunsToday(perksFor(p.plan_code).sourcingCadence)) {
      skipped.push({ user: p.id, reason: "not_today" });
      continue;
    }
    if (!isAdminEmail(p.email) && isEnforcing()) {
      const bal = await getBalance(p.id).catch(() => null);
      if (bal && bal.spendableBasePence <= 0) {
        skipped.push({ user: p.id, reason: "no_credit" });
        continue;
      }
    }
    const areaFit = new Map<string, number | null>();
    const refs: AreaRef[] = cards.map((card) => {
      const fit = personaliseScore(personalInputFor(card, goals), goals)?.score ?? card.score?.score ?? null;
      areaFit.set(card.code, fit);
      return { code: card.code, name: card.name, slug: card.slug, centroid: areaCentroid(card.code), fit };
    });
    const savedAreas = savedByUser.get(p.id) ?? [];
    const queries = queriesForGoals(goals, savedAreas, refs);
    if (queries.length === 0) {
      skipped.push({ user: p.id, reason: "no_areas" });
      continue;
    }
    members.push({ id: p.id, email: p.email, goals, profile: p, savedAreas, queries, areaFit });
  }

  // Shared query set, most-wanted first, capped per run.
  const demand = new Map<string, { query: SourcingQuery; members: number; payer: Member }>();
  for (const m of members) for (const q of m.queries) demand.set(q.key, { query: q, members: (demand.get(q.key)?.members ?? 0) + 1, payer: demand.get(q.key)?.payer ?? m });
  const queries = [...demand.values()].sort((a, b) => b.members - a.members).slice(0, maxQueries());

  const summary = { dry, optedIn: (profiles ?? []).length, members: members.length, queries: queries.length, answered: 0, unavailable: 0, listings: 0, newListings: 0, emails: 0, emailFailures: 0, ranOutOfTime: false };
  if (dry) {
    return Response.json({ ...summary, skipped, wouldQuery: queries.map((q) => ({ key: q.query.key, members: q.members })), wouldEmail: members.map((m) => ({ user: m.id, queries: m.queries.map((q) => q.key) })) });
  }

  // Answer each query through the broker (cached a day), remember every listing seen.
  const byQuery = new Map<string, SourcedListing[]>();
  const seenUrls = new Set<string>();
  for (const { query, payer } of queries) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      summary.ranOutOfTime = true;
      break;
    }
    const res = await runMetered({ userId: payer.id, admin: isAdminEmail(payer.email), action: "cron:sourcing", actionId: newActionId() }, () => ask(sourcingListings, query, { mode: "cron", userId: payer.id }));
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

  // First-seen dates decide what counts as new; sent rows decide what each member already had.
  const firstSeen = new Map<string, number>();
  if (seenUrls.size > 0) {
    const { data: seenRows } = await admin.from("sourced_listings").select("canonical_url, first_seen_at").in("canonical_url", [...seenUrls]);
    for (const r of (seenRows ?? []) as { canonical_url: string; first_seen_at: string }[]) firstSeen.set(r.canonical_url, new Date(r.first_seen_at).getTime());
  }
  const sentByUser = new Map<string, Set<string>>();
  if (members.length > 0 && seenUrls.size > 0) {
    const { data: sentRows } = await admin.from("sourcing_sent").select("user_id, canonical_url").in("user_id", members.map((m) => m.id)).in("canonical_url", [...seenUrls]);
    for (const r of (sentRows ?? []) as { user_id: string; canonical_url: string }[]) sentByUser.set(r.user_id, new Set([...(sentByUser.get(r.user_id) ?? []), r.canonical_url]));
  }
  const cutoff = Date.now() - NEW_WINDOW_MS;

  const perUser: { user: string; candidates: number; picks: number; sent: boolean; reason?: string }[] = [];
  for (const m of members) {
    const sent = sentByUser.get(m.id) ?? new Set<string>();
    const candidates: { listing: SourcedListing; deal: ReturnType<typeof dealForSourced>; areaFit: number | null; areaName: string }[] = [];
    const seen = new Set<string>();
    for (const q of m.queries) {
      for (const l of byQuery.get(q.key) ?? []) {
        if (seen.has(l.canonicalUrl) || sent.has(l.canonicalUrl)) continue;
        if ((firstSeen.get(l.canonicalUrl) ?? Date.now()) < cutoff) continue;
        if (m.goals.bedrooms && l.bedrooms !== null && l.bedrooms < m.goals.bedrooms) continue;
        if (l.kind === "sale" && l.price && ((q.maxPrice && l.price.amount > q.maxPrice) || (q.minPrice && l.price.amount < q.minPrice))) continue;
        seen.add(l.canonicalUrl);
        const card = cardByCode.get(l.postcodeArea ?? q.area) ?? cardByCode.get(q.area);
        const figures = card ? { byBedrooms: card.byBedrooms.map((b) => ({ bedrooms: b.bedrooms, grossRevenue: b.grossRevenue, adr: b.adr })), headline: { grossRevenue: card.headline.grossRevenue, adr: card.headline.adr } } : null;
        candidates.push({ listing: l, deal: dealForSourced(l, figures, m.goals.finance), areaFit: m.areaFit.get(card?.code ?? q.area) ?? null, areaName: card?.name ?? q.areaName });
      }
    }
    const picks = rankPicks(candidates, PICKS_PER_EMAIL);
    if (picks.length === 0) {
      perUser.push({ user: m.id, candidates: candidates.length, picks: 0, sent: false, reason: "nothing_new" });
      continue;
    }
    if (!isEmailConfigured()) {
      perUser.push({ user: m.id, candidates: candidates.length, picks: picks.length, sent: false, reason: "email_not_configured" });
      continue;
    }
    const res = await sendEmail({ to: m.email, ...sourcingEmail(picks, siteUrl()) });
    perUser.push({ user: m.id, candidates: candidates.length, picks: picks.length, sent: res.sent, reason: res.reason });
    if (!res.sent) {
      summary.emailFailures += 1;
      continue;
    }
    summary.emails += 1;
    summary.newListings += picks.length;
    const { error: sentErr } = await admin.from("sourcing_sent").upsert(
      picks.map((p) => ({ user_id: m.id, canonical_url: p.listing.canonicalUrl, sent_at: nowIso })),
      { onConflict: "user_id,canonical_url" },
    );
    if (sentErr) console.error("[sourcing] sourcing_sent insert failed:", sentErr.message);
    const { error: profErr } = await admin.from("profiles").update({ sourcing_last_sent_at: nowIso }).eq("id", m.id);
    if (profErr) console.error("[sourcing] profile update failed:", profErr.message);
  }

  return Response.json({ ...summary, ms: Date.now() - started, skipped, members: perUser });
}
