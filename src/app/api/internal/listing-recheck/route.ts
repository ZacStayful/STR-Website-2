import { createAdminClient } from "@/lib/supabase/admin";
import { resolveListing } from "@/lib/listing/server";
import { quickEstimate } from "@/lib/listing/quick";
import { serverFetchEnabled } from "@/lib/listing/fetch";
import { diffListing, parseHistory, pendingEntries, markNotified, dealAtNewPrice, recheckEmail, type PriceHistoryEntry, type RecheckAlertItem } from "@/lib/listing/recheck";
import type { ListingSnapshot, ListingSource, ListingStatus } from "@/lib/listing/types";
import type { QuickEstimate } from "@/lib/listing/quick-types";
import type { Deal } from "@/lib/listing/deal";
import { marketAccessState } from "@/lib/market/access";
import { sendEmail, isEmailConfigured } from "@/lib/email/send";
import { siteUrl } from "@/lib/url";
import { authoriseInternal, internalSecretsConfigured } from "@/lib/internal-auth";

// ─── Daily re-check of saved listings ──────────────────────────────────
// Vercel cron (vercel.json, 06:00 UTC). Stalest first over every pipeline
// row that is not Passed:
//   - Rightmove / OnTheMarket rows are re-read at most once a day (1 request
//     per second, one fetch per URL however many members watch it). A price
//     or status change is appended to price_history and the row's snapshot,
//     status and deal follow the new figures.
//   - Airbnb rows refresh their tracked figures monthly through the broker
//     (no page fetch; budgeted like any quick view).
// Changes are emailed the same run, one email per member; a failed send is
// retried next run because entries stay `notified: false` until sent.
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/listing-recheck?dry=1"
//
// Kill switches: LISTING_RECHECK_ENABLED=false (this route), LISTING_SERVER_FETCH
// and LISTING_SOURCES (the fetch layer). LISTING_RECHECK_MAX_PER_RUN caps a run
// (default 40: at one fetch plus a one-second pause each, that is what the
// 60 s function limit allows; a larger pipeline drains over several days,
// stalest first).

export const runtime = "nodejs";
export const maxDuration = 60;

const TIME_BUDGET_MS = 50_000;
/** The Airbnb refresh makes no page fetch and runs first inside this slice. */
const AIRBNB_BUDGET_MS = 8_000;
const PORTAL_MIN_AGE_MS = 20 * 60 * 60 * 1000;
const AIRBNB_MIN_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const AIRBNB_MAX_PER_RUN = 10;
const PORTAL_SOURCES: ListingSource[] = ["rightmove", "onthemarket"];
const DEFAULT_MAX_PER_RUN = 40;

function maxPerRun(): number {
  const n = Number(process.env.LISTING_RECHECK_MAX_PER_RUN ?? DEFAULT_MAX_PER_RUN);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_PER_RUN;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Row {
  id: string;
  user_id: string;
  canonical_url: string;
  source: ListingSource;
  kind: "sale" | "rent" | "str";
  postcode: string | null;
  lat: number | null;
  lng: number | null;
  snapshot: ListingSnapshot;
  quick_estimate: QuickEstimate | null;
  deal: Deal | null;
  listing_status: ListingStatus | null;
  price_history: unknown;
  rechecked_at: string | null;
  last_checked_at: string | null;
  created_at: string;
}

type Profile = { email: string | null; plan: "free" | "pro"; reports_run: number; stripe_subscription_id: string | null };

function lastSeen(r: Row): number {
  return new Date(r.rechecked_at ?? r.last_checked_at ?? r.created_at).getTime();
}

export async function GET(request: Request) {
  if (!internalSecretsConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authoriseInternal(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.LISTING_RECHECK_ENABLED === "false") return Response.json({ enabled: false, reason: "LISTING_RECHECK_ENABLED=false" });

  const dry = new URL(request.url).searchParams.get("dry") === "1";
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return Response.json({ error: "Storage not configured" }, { status: 503 });
  }

  const started = Date.now();
  const now = new Date();
  const nowIso = now.toISOString();
  const cap = maxPerRun();

  const { data, error } = await admin
    .from("checked_listings")
    .select("id, user_id, canonical_url, source, kind, postcode, lat, lng, snapshot, quick_estimate, deal, listing_status, price_history, rechecked_at, last_checked_at, created_at")
    .neq("status", "passed")
    .in("source", [...PORTAL_SOURCES, "airbnb"])
    .order("rechecked_at", { ascending: true, nullsFirst: true })
    .limit(cap * 2 + AIRBNB_MAX_PER_RUN);
  if (error) {
    console.error("[recheck] select failed:", error.message);
    return Response.json({ error: "Query failed" }, { status: 500 });
  }
  const rows = (data ?? []) as unknown as Row[];

  // Portal listings: one fetch per URL, oldest first, skipping anything seen
  // today and anything already gone (a removed listing cannot change again).
  const byUrl = new Map<string, Row[]>();
  for (const r of rows) {
    if (!PORTAL_SOURCES.includes(r.source)) continue;
    if (r.listing_status === "removed") continue;
    if (now.getTime() - lastSeen(r) < PORTAL_MIN_AGE_MS) continue;
    if (!serverFetchEnabled(r.source)) continue;
    const list = byUrl.get(r.canonical_url) ?? [];
    list.push(r);
    byUrl.set(r.canonical_url, list);
  }
  const urls = [...byUrl.entries()].sort((a, b) => Math.min(...a[1].map(lastSeen)) - Math.min(...b[1].map(lastSeen))).slice(0, cap);

  // Airbnb listings: monthly figure refresh through the broker, a few per run.
  const airbnb = rows.filter((r) => r.source === "airbnb" && now.getTime() - lastSeen(r) >= AIRBNB_MIN_AGE_MS).sort((a, b) => lastSeen(a) - lastSeen(b)).slice(0, AIRBNB_MAX_PER_RUN);

  const summary = { dry, candidates: rows.length, portalUrls: urls.length, airbnb: airbnb.length, fetched: 0, changed: 0, removed: 0, skipped: 0, paused: false, airbnbRefreshed: 0, emails: 0, emailFailures: 0, ranOutOfTime: false };
  if (dry) {
    return Response.json({ ...summary, wouldFetch: urls.map(([u, rs]) => ({ url: u, members: rs.length, lastSeen: new Date(Math.min(...rs.map(lastSeen))).toISOString() })), wouldRefresh: airbnb.map((r) => r.canonical_url) });
  }

  // Airbnb first: no page fetch, bounded by its own slice so a long portal
  // queue can never starve the monthly refresh.
  for (const r of airbnb) {
    if (Date.now() - started > AIRBNB_BUDGET_MS) break;
    const snap = r.snapshot;
    const quick = await quickEstimate(
      { kind: "str", postcode: snap.postcode ?? r.postcode, outcode: snap.outcode, bedrooms: snap.bedrooms ?? 2, bathrooms: snap.bathrooms, lat: snap.lat ?? r.lat, lng: snap.lng ?? r.lng, airbnbId: snap.id },
      { mode: "cron", userId: r.user_id },
    );
    const { error: upErr } = await admin.from("checked_listings").update({ quick_estimate: quick, rechecked_at: nowIso }).eq("id", r.id);
    if (upErr) console.error("[recheck] airbnb update failed:", upErr.message);
    else summary.airbnbRefreshed += 1;
  }

  let first = true;
  for (const [url, members] of urls) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      summary.ranOutOfTime = true;
      break;
    }
    if (!first) await sleep(1000);
    first = false;
    const res = await resolveListing(url, { refresh: true });
    summary.fetched += 1;
    if (!res.ok && res.code === "paused") {
      summary.paused = true;
      break;
    }
    let next: { price?: ListingSnapshot["price"]; status?: ListingStatus } | null = null;
    let fresh: ListingSnapshot | null = null;
    if (res.ok) {
      fresh = res.snapshot;
      next = { price: fresh.price, status: fresh.status };
    } else if (res.code === "not_found") {
      next = { status: "removed" };
      summary.removed += 1;
    } else {
      summary.skipped += 1;
      continue; // blocked / unreadable: leave the row untouched so it is retried tomorrow
    }
    for (const r of members) {
      const prev = { price: r.snapshot.price, status: r.listing_status ?? r.snapshot.status };
      const history = parseHistory(r.price_history);
      const entry = diffListing(prev, next, nowIso);
      const update: Record<string, unknown> = { rechecked_at: nowIso };
      if (fresh) update.snapshot = { ...fresh, fetchedAt: r.snapshot.fetchedAt ?? fresh.fetchedAt };
      if (entry) {
        history.push(entry);
        update.price_history = history;
        if (next.status) update.listing_status = next.status;
        if (fresh?.price && entry.previousAmount !== null) {
          const deal = dealAtNewPrice(r.quick_estimate, r.deal, fresh.price, r.kind, fresh.bedrooms ?? r.snapshot.bedrooms ?? null);
          if (deal) {
            update.deal = deal;
            if (r.quick_estimate) update.quick_estimate = { ...r.quick_estimate, deal };
          }
        }
        summary.changed += 1;
      }
      const { error: upErr } = await admin.from("checked_listings").update(update).eq("id", r.id);
      if (upErr) console.error("[recheck] update failed:", upErr.message);
    }
  }

  // Email everything still unnotified: this run's changes plus any earlier
  // ones whose email failed. Recorded as notified only after a successful
  // send. Listings the member has since Passed are left alone.
  const { data: pendingData, error: pendErr } = await admin
    .from("checked_listings")
    .select("id, user_id, canonical_url, snapshot, price_history, profiles!inner(email, plan, reports_run, stripe_subscription_id)")
    .neq("status", "passed")
    .contains("price_history", [{ notified: false }]);
  if (pendErr) console.error("[recheck] pending select failed:", pendErr.message);
  const byUser = new Map<string, { profile: Profile; items: (RecheckAlertItem & { history: PriceHistoryEntry[] })[] }>();
  for (const raw of (pendingData ?? []) as unknown as { id: string; user_id: string; canonical_url: string; snapshot: ListingSnapshot; price_history: unknown; profiles: Profile }[]) {
    const history = parseHistory(raw.price_history);
    const pending = pendingEntries(history);
    if (pending.length === 0) continue;
    const entry = byUser.get(raw.user_id) ?? { profile: raw.profiles, items: [] };
    entry.items.push({ id: raw.id, title: raw.snapshot.title, address: raw.snapshot.displayAddress ?? null, canonicalUrl: raw.canonical_url, entries: pending, history });
    byUser.set(raw.user_id, entry);
  }
  const perUser: { user: string; items: number; sent: boolean; reason?: string }[] = [];
  for (const [userId, { profile, items }] of byUser) {
    if (!profile || marketAccessState({ email: profile.email }, profile) !== "ok" || !profile.email) {
      perUser.push({ user: userId, items: items.length, sent: false, reason: "no_access" });
      continue;
    }
    if (!isEmailConfigured()) {
      perUser.push({ user: userId, items: items.length, sent: false, reason: "email_not_configured" });
      continue;
    }
    const res = await sendEmail({ to: profile.email, ...recheckEmail(items, siteUrl()) });
    perUser.push({ user: userId, items: items.length, sent: res.sent, reason: res.reason });
    if (!res.sent) {
      summary.emailFailures += 1;
      continue;
    }
    summary.emails += 1;
    for (const item of items) {
      const { error: upErr } = await admin.from("checked_listings").update({ price_history: markNotified(item.history) }).eq("id", item.id);
      if (upErr) console.error("[recheck] mark notified failed:", upErr.message);
    }
  }

  return Response.json({ ...summary, ms: Date.now() - started, members: perUser });
}
