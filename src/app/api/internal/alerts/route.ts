import { createAdminClient } from "@/lib/supabase/admin";
import { getAreaCards } from "@/lib/market/cached";
import { fetchMarketTrends } from "@/lib/market/trends-client";
import { areaTrend, type AreaTrend } from "@/lib/market/trend";
import { digestChanges, digestEmail, type ListingWeekChange, type SavedAreaState } from "@/lib/market/alerts";
import { parseHistory, describeChange } from "@/lib/listing/recheck";
import { marketAccessState } from "@/lib/market/access";
import { sendEmail, isEmailConfigured } from "@/lib/email/send";
import { siteUrl } from "@/lib/url";

// ─── Weekly trend-alert digest ─────────────────────────────────────
// Vercel cron (vercel.json). For every member with explorer access,
// alert_weekly on and at least one saved area: compare each saved area's
// enquiry trend and confidence tier with what the last digest recorded;
// email one digest of the changes; then record the state the member has
// actually been told about. The first run after saving only records a
// baseline (no email). If the digest could not be sent, nothing is recorded,
// so the change is reported next time instead of being lost.
//
//   curl -H "x-internal-secret: $INTERNAL_API_SECRET" "https://<host>/api/internal/alerts?dry=1"
//
// Auth: Vercel Cron's `Authorization: Bearer $CRON_SECRET`, or the shared
// internal secret for manual runs.

export const runtime = "nodejs";
export const maxDuration = 60;

function authorise(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  const secret = process.env.INTERNAL_API_SECRET;
  if (secret && request.headers.get("x-internal-secret") === secret) return true;
  return false;
}

type Row = SavedAreaState & {
  user_id: string;
  profiles: { email: string | null; alert_weekly: boolean; plan: "free" | "pro"; reports_run: number; stripe_subscription_id: string | null } | null;
};

export async function GET(request: Request) {
  if (!process.env.INTERNAL_API_SECRET && !process.env.CRON_SECRET) return Response.json({ error: "Not found" }, { status: 404 });
  if (!authorise(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const dry = new URL(request.url).searchParams.get("dry") === "1";
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return Response.json({ error: "Storage not configured" }, { status: 503 });
  }

  const [cards, trends] = await Promise.all([getAreaCards(), fetchMarketTrends()]);
  // Without both feeds we cannot judge a change; bail rather than record a
  // baseline of "insufficient" that would produce a mass digest next week.
  if (cards.length === 0 || !trends) return Response.json({ error: "Market data unavailable; nothing recorded" }, { status: 503 });
  const cardByCode = new Map(cards.map((c) => [c.code, c]));
  const trendByCode = new Map<string, AreaTrend | null>(cards.map((c) => [c.code, areaTrend(trends.areas[c.code])]));

  const { data: saved, error } = await admin
    .from("saved_areas")
    .select("user_id, postcode_area, last_alerted_direction, last_alerted_tier, profiles!inner(email, alert_weekly, plan, reports_run, stripe_subscription_id)")
    .eq("profiles.alert_weekly", true);
  if (error) {
    console.error("[alerts] saved_areas query failed:", error.message);
    return Response.json({ error: "Query failed" }, { status: 500 });
  }

  const byUser = new Map<string, { profile: Row["profiles"]; rows: Row[]; listings: ListingWeekChange[] }>();
  for (const r of (saved ?? []) as unknown as Row[]) {
    const entry = byUser.get(r.user_id) ?? { profile: r.profiles, rows: [], listings: [] };
    entry.rows.push(r);
    byUser.set(r.user_id, entry);
  }

  // Pipeline listings that moved in the last week (recorded by the daily
  // re-check) ride along in the same digest, for members with alerts on.
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).getTime();
  const { data: moved, error: movedError } = await admin
    .from("checked_listings")
    .select("id, user_id, snapshot, price_history, profiles!inner(email, alert_weekly, plan, reports_run, stripe_subscription_id)")
    .eq("profiles.alert_weekly", true)
    .neq("price_history", "[]");
  if (movedError) console.warn("[alerts] checked_listings select failed (schema behind?):", movedError.message);
  for (const raw of (moved ?? []) as unknown as { id: string; user_id: string; snapshot: { title?: string; displayAddress?: string }; price_history: unknown; profiles: Row["profiles"] }[]) {
    const recent = parseHistory(raw.price_history).filter((e) => new Date(e.at).getTime() >= weekAgo);
    if (recent.length === 0) continue;
    const entry = byUser.get(raw.user_id) ?? { profile: raw.profiles, rows: [], listings: [] };
    entry.listings.push({ id: raw.id, label: raw.snapshot?.displayAddress ?? raw.snapshot?.title ?? "Listing", summary: recent.map(describeChange).join("; ") });
    byUser.set(raw.user_id, entry);
  }

  const now = new Date().toISOString();
  const summary: { user: string; changes: number; listings: number; sent: boolean; recorded: number; reason?: string }[] = [];
  const toRecord: { user_id: string; postcode_area: string; last_alerted_direction: string; last_alerted_tier: string; last_alerted_at: string }[] = [];

  for (const [userId, { profile, rows, listings }] of byUser) {
    // Same rule as the explorer: lapsed / exhausted accounts get no paid figures.
    if (!profile || marketAccessState({ email: profile.email }, profile) !== "ok") {
      summary.push({ user: userId, changes: 0, listings: 0, sent: false, recorded: 0, reason: "no_access" });
      continue;
    }
    const changes = digestChanges(rows, cardByCode, trendByCode);
    let sent = false;
    let reason: string | undefined;
    if ((changes.length > 0 || listings.length > 0) && !dry) {
      if (!profile.email) reason = "no_email";
      else if (!isEmailConfigured()) reason = "email_not_configured";
      else {
        const res = await sendEmail({ to: profile.email, ...digestEmail(changes, siteUrl(), listings) });
        sent = res.sent;
        reason = res.reason;
      }
    }
    // Record only what the member has been told: every row when there was
    // nothing to say (baseline) or the digest went out; nothing on a failed
    // send. A direction that dropped to "insufficient" never overwrites a
    // real one, so a thin month can't manufacture a "change" later.
    let recorded = 0;
    if (!dry && (changes.length === 0 || sent)) {
      for (const r of rows) {
        const card = cardByCode.get(r.postcode_area);
        if (!card) continue;
        const dir = trendByCode.get(r.postcode_area)?.enquiries.direction ?? "insufficient";
        const direction = dir === "insufficient" && r.last_alerted_direction ? r.last_alerted_direction : dir;
        toRecord.push({ user_id: userId, postcode_area: r.postcode_area, last_alerted_direction: direction, last_alerted_tier: card.confidence.tier, last_alerted_at: now });
        recorded += 1;
      }
    }
    summary.push({ user: userId, changes: changes.length, listings: listings.length, sent, recorded, reason });
  }

  if (toRecord.length > 0) {
    const { error: upsertError } = await admin.from("saved_areas").upsert(toRecord, { onConflict: "user_id,postcode_area" });
    if (upsertError) console.error("[alerts] recording state failed:", upsertError.message);
  }

  return Response.json({
    dry,
    members: summary.length,
    digests: summary.filter((s) => s.changes > 0 || s.listings > 0).length,
    sent: summary.filter((s) => s.sent).length,
    recorded: toRecord.length,
    summary,
  });
}
