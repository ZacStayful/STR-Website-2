import { createAdminClient } from "@/lib/supabase/admin";
import { payerFor } from "@/lib/team";
import { resolveListing } from "@/lib/listing/server";
import { quickEstimate } from "@/lib/listing/quick";
import { serverFetchEnabled } from "@/lib/listing/fetch";
import { diffListing, parseHistory, dealAtNewPrice } from "@/lib/listing/recheck";
import type { ListingSnapshot, ListingSource, ListingStatus } from "@/lib/listing/types";
import type { QuickEstimate } from "@/lib/listing/quick-types";
import type { Deal } from "@/lib/listing/deal";
import { runMetered, newActionId } from "@/lib/credit/context";
import { getBalance } from "@/lib/credit/ledger";
import { isEnforcing } from "@/lib/credit/http";
import { isAdminEmail } from "@/lib/admin";
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
// Changes are RECORDED here and nothing is sent (Batch 6): the 06:55
// collector (/api/internal/deal-alerts) turns them into alerts, and the
// member's one daily email carries them. A listing marked removed is read
// again every few days for a month, so one that comes back is noticed.
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
/** A removed listing is re-read this often, inside the same cap... */
const REMOVED_EVERY_MS = 3 * 24 * 60 * 60 * 1000;
/** ...for this long after it went, in case it comes back (a transient 404, a relist on the same URL). */
const REMOVED_FOR_MS = 30 * 24 * 60 * 60 * 1000;

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


/** When a row was recorded as removed: its latest removed entry, else when it was last checked. */
function removedAt(r: Row): number {
  const entries = parseHistory(r.price_history).filter((e) => e.status === "removed");
  const last = entries[entries.length - 1];
  return last ? new Date(last.at).getTime() : lastSeen(r);
}

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
  // today. A removed listing is read again every REMOVED_EVERY_MS for
  // REMOVED_FOR_MS after it went (it may come back); after that it is left.
  // Every row that is skipped without a fetch still gets its rechecked_at
  // stamped, or it sits at the front of the oldest-first queue forever and,
  // once enough of them build up, nothing behind them is ever checked again.
  const deferred: string[] = [];
  const byUrl = new Map<string, Row[]>();
  for (const r of rows) {
    if (!PORTAL_SOURCES.includes(r.source)) continue;
    if (r.listing_status === "removed") {
      if (now.getTime() - removedAt(r) > REMOVED_FOR_MS) {
        deferred.push(r.id);
        continue;
      }
      // Not due yet: left as it is. Stamping it would restart its clock and it
      // would never come due; it is not at the front of the queue meanwhile,
      // because everything live is read daily.
      if (now.getTime() - lastSeen(r) < REMOVED_EVERY_MS) continue;
    }
    if (now.getTime() - lastSeen(r) < PORTAL_MIN_AGE_MS) continue;
    if (!serverFetchEnabled(r.source)) {
      deferred.push(r.id);
      continue;
    }
    const list = byUrl.get(r.canonical_url) ?? [];
    list.push(r);
    byUrl.set(r.canonical_url, list);
  }
  const urls = [...byUrl.entries()].sort((a, b) => Math.min(...a[1].map(lastSeen)) - Math.min(...b[1].map(lastSeen))).slice(0, cap);

  // Airbnb listings: monthly figure refresh through the broker, a few per run.
  const airbnb = rows.filter((r) => r.source === "airbnb" && now.getTime() - lastSeen(r) >= AIRBNB_MIN_AGE_MS).sort((a, b) => lastSeen(a) - lastSeen(b)).slice(0, AIRBNB_MAX_PER_RUN);

  const summary = { dry, candidates: rows.length, portalUrls: urls.length, airbnb: airbnb.length, fetched: 0, changed: 0, removed: 0, skipped: 0, paused: false, airbnbRefreshed: 0, ranOutOfTime: false };
  if (dry) {
    return Response.json({ ...summary, wouldFetch: urls.map(([u, rs]) => ({ url: u, members: rs.length, lastSeen: new Date(Math.min(...rs.map(lastSeen))).toISOString() })), wouldRefresh: airbnb.map((r) => r.canonical_url) });
  }

  // Airbnb first: no page fetch, bounded by its own slice so a long portal
  // queue can never starve the monthly refresh.
  for (const r of airbnb) {
    if (Date.now() - started > AIRBNB_BUDGET_MS) break;
    const snap = r.snapshot;
    // A team member's tracked listings re-check on their owner's credit.
    const payer = await payerFor(r.user_id);
    if (payer.suspended) {
      summary.skipped += 1;
      continue;
    }
    if (isEnforcing()) {
      const bal = await getBalance(payer.payerId).catch(() => null);
      if (bal && bal.spendableBasePence <= 0) {
        summary.skipped += 1;
        continue;
      }
    }
    const quick = await runMetered({ userId: payer.payerId, memberId: payer.memberId, admin: false, action: "cron:recheck", actionId: newActionId() }, () =>
      quickEstimate(
        { kind: "str", postcode: snap.postcode ?? r.postcode, outcode: snap.outcode, bedrooms: snap.bedrooms ?? 2, bathrooms: snap.bathrooms, lat: snap.lat ?? r.lat, lng: snap.lng ?? r.lng, airbnbId: snap.id },
        { mode: "cron", userId: r.user_id },
      ),
    );
    if (quick.limited && !quick.estimate && !quick.tracked) {
      // Provider budget spent: keep last month's figures and try again next run.
      summary.skipped += 1;
      continue;
    }
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
    // One page fetch however many members watch it; the nominal cost goes to the first.
    const watcher = members[0]?.user_id ?? null;
    // A team member's share is billed to their owner, like everything else they do.
    const pagePayer = watcher ? await payerFor(watcher) : null;
    const res = await runMetered({ userId: pagePayer && !pagePayer.suspended ? pagePayer.payerId : null, memberId: pagePayer?.memberId ?? null, admin: false, action: "cron:recheck", actionId: newActionId() }, () => resolveListing(url, { refresh: true }));
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
      // Blocked / unreadable: nothing to record, but move the rows to the back
      // of the queue so one bad page cannot pin it. They are retried tomorrow.
      deferred.push(...members.map((r) => r.id));
      continue;
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

  if (deferred.length > 0) {
    const { error: defErr } = await admin.from("checked_listings").update({ rechecked_at: nowIso }).in("id", deferred);
    if (defErr) console.error("[recheck] deferred stamp failed:", defErr.message);
  }
  return Response.json({ ...summary, deferred: deferred.length, ms: Date.now() - started });
}
