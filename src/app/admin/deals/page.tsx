import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin";
import { areaMetaForCode } from "@/lib/market/areas";
import { getBillingSettings } from "@/lib/credit/unit-costs";
import { describeBand, formatOpenPrice, ladderBandIndex } from "@/lib/marketplace/ladder";
import { sweepEnabled } from "@/lib/marketplace/sweep-run";
import { recheckEnabled } from "@/lib/marketplace/recheck-run";
import { SOURCE_HOURLY_CAPS } from "@/lib/marketplace/cadence";
import { dryRunSweepAction, runSweepPassAction, dryRunRecheckAction, runRecheckPassAction, retireDealAction, restoreDealAction, updateLadderAction } from "./actions";

const RUN_COOKIE = "sf_deals_run";

export const metadata: Metadata = { title: "Deals marketplace admin — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
// The sweep and recheck buttons run a real pass.
export const maxDuration = 60;

interface LastRun {
  kind: string;
  at: string;
  body: Record<string, unknown>;
}

async function readLastRun(): Promise<LastRun | null> {
  try {
    const raw = (await cookies()).get(RUN_COOKIE)?.value;
    if (!raw) return null;
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as LastRun;
  } catch {
    return null;
  }
}

const MESSAGES: Record<string, string> = {
  retired: "Deal retired.",
  restored: "Deal restored.",
  ladder_saved: "Ladder saved. New opens use it from now.",
  bad_ladder: "That ladder did not parse: prices must be numbers, bands ascending, and the last band's ceiling blank.",
  bad_url: "That is not a listing URL.",
  failed: "That did not work.",
};

interface RunRow {
  id: string;
  kind: string;
  dry: boolean;
  started_at: string;
  finished_at: string | null;
  summary: Record<string, unknown>;
}

const DAYS = 30;
const gbp = (pence: number) => `£${(pence / 100).toFixed(2)}`;

function sinceIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="text-3xl font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function n(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * The marketplace's control room: what the sweep and the recheck did, what
 * is live, what members open and pay, and the ladder that prices an open.
 * The ladder tuning panel exists because the £50–£70 a month target rests on
 * an assumed usage profile; these are the numbers that correct it.
 */
export default async function DealsAdminPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/deals");
  if (!isAdminEmail(user.email)) notFound();

  const admin = createAdminClient();
  const since = sinceIso(DAYS);
  const weekAgo = sinceIso(7);
  const [lastRun, settings, runsRes, liveRes, pendingRes, retiredRes, opensRes, activeRes, checkingRes, byAreaRes] = await Promise.all([
    readLastRun(),
    getBillingSettings(),
    admin.from("marketplace_runs").select("id, kind, dry, started_at, finished_at, summary").order("started_at", { ascending: false }).limit(40),
    admin.from("marketplace_deals").select("kind", { count: "exact", head: true }).eq("status", "live"),
    admin.from("marketplace_deals").select("kind", { count: "exact", head: true }).eq("status", "pending_verify"),
    admin.from("marketplace_deals").select("retired_reason").eq("status", "retired").gte("retired_at", weekAgo).limit(5000),
    admin.from("deal_opens").select("user_id, charged_base_pence, opened_at, verified_via, annual_profit_at_open").eq("status", "open").gte("opened_at", since).limit(5000),
    admin.from("profiles").select("id", { count: "exact", head: true }).gte("last_seen_at", since),
    admin.from("marketplace_deals").select("id", { count: "exact", head: true }).not("check_requested_at", "is", null).in("status", ["live", "pending_verify"]),
    admin.from("marketplace_deals").select("postcode_area, kind").eq("status", "live").limit(20000),
  ]);
  const runs = (runsRes.data ?? []) as RunRow[];
  const sweeps = runs.filter((r) => r.kind === "sweep" && !r.dry).slice(0, 7);
  const rechecks = runs.filter((r) => r.kind === "recheck" && !r.dry).slice(0, 24);
  const retiredByReason = new Map<string, number>();
  for (const r of (retiredRes.data ?? []) as { retired_reason: string | null }[]) retiredByReason.set(r.retired_reason ?? "?", (retiredByReason.get(r.retired_reason ?? "?") ?? 0) + 1);
  const opens = (opensRes.data ?? []) as { user_id: string; charged_base_pence: number; opened_at: string; verified_via: string | null; annual_profit_at_open: number | null }[];
  const openers = new Set(opens.map((o) => o.user_id)).size;
  const pence = opens.reduce((s, o) => s + Number(o.charged_base_pence), 0);
  const picks = opens.filter((o) => o.verified_via === "pick").length;
  const activeMembers = activeRes.count ?? 0;
  const ladder = settings.dealOpenLadder;
  const bandCounts = ladder.map(() => 0);
  for (const o of opens) bandCounts[ladderBandIndex(o.annual_profit_at_open === null ? null : Number(o.annual_profit_at_open), ladder)] += 1;
  const byArea = new Map<string, { sale: number; rent: number }>();
  for (const r of (byAreaRes.data ?? []) as { postcode_area: string | null; kind: string }[]) {
    if (!r.postcode_area) continue;
    const c = byArea.get(r.postcode_area) ?? { sale: 0, rent: 0 };
    if (r.kind === "rent") c.rent += 1;
    else c.sale += 1;
    byArea.set(r.postcode_area, c);
  }
  const areas = [...byArea.entries()].sort((a, b) => b[1].sale + b[1].rent - (a[1].sale + a[1].rent)).slice(0, 60);
  const message = msg ? MESSAGES[msg] ?? null : null;
  const weeks = DAYS / 7;

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Deals marketplace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sweep is {sweepEnabled() ? "ON" : "OFF (MARKETPLACE_SWEEP_ENABLED=false)"} · recheck is {recheckEnabled() ? "ON" : "OFF"} · caps per hourly run: Rightmove {SOURCE_HOURLY_CAPS.rightmove}, OnTheMarket {SOURCE_HOURLY_CAPS.onthemarket}. Coverage is the 50 newest listings within 8 km of each area centroid, per kind, per day.
          </p>
        </div>
        <Link href="/admin" className="text-sm font-medium text-primary hover:underline">← Dashboard</Link>
      </div>

      {message && <p className="mb-4 rounded-md border border-border bg-card p-3 text-sm text-foreground">{message}</p>}

      <section className="mb-8 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">Run</h2>
        <p className="mt-1 text-sm text-muted-foreground">A sweep pass asks the broker for every top area (cached answers are free) and screens what comes back; a recheck pass reads up to the caps of listing pages. Dry runs ask and write nothing. Each takes up to a minute.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <form action={dryRunSweepAction}><button type="submit" className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Dry-run sweep</button></form>
          <form action={runSweepPassAction}><button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Run a sweep pass</button></form>
          <form action={dryRunRecheckAction}><button type="submit" className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Dry-run recheck</button></form>
          <form action={runRecheckPassAction}><button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Run a recheck pass</button></form>
        </div>
        {lastRun && (
          <div className="mt-4 rounded-lg border border-border bg-background p-4 text-sm">
            <p className="font-medium text-foreground">{lastRun.kind} · {new Date(lastRun.at).toLocaleString("en-GB")}</p>
            <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{JSON.stringify(lastRun.body, null, 1)}</pre>
          </div>
        )}
      </section>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Live deals" value={liveRes.count ?? 0} sub={`${pendingRes.count ?? 0} awaiting their entry check`} />
        <Stat label="Retired this week" value={[...retiredByReason.values()].reduce((a, b) => a + b, 0)} sub={[...retiredByReason.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"} />
        <Stat label={`Opens, ${DAYS} days`} value={opens.length} sub={`${picks} as daily picks · ${checkingRes.count ?? 0} waiting on a check`} />
        <Stat label="Charged" value={gbp(pence)} sub={`${openers} members opened something`} />
      </div>

      <section className="mt-8 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">Ladder tuning</h2>
        <p className="mt-1 text-sm text-muted-foreground">The target is £50–£70 a month from a member who uses the marketplace daily. These are the numbers that say whether the ladder is right; review after four weeks of real use.</p>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Opens per opener per week" value={openers > 0 ? (opens.length / openers / weeks).toFixed(1) : "—"} />
          <Stat label="Spend per opener per month" value={openers > 0 ? gbp((pence / openers) * (30 / DAYS)) : "—"} sub="opens and picks only; reports are separate" />
          <Stat label="Spend per active member per month" value={activeMembers > 0 ? gbp((pence / activeMembers) * (30 / DAYS)) : "—"} sub={`${activeMembers} members seen in ${DAYS} days`} />
          <Stat label="Average open price" value={opens.length > 0 ? formatOpenPrice(Math.round(pence / opens.length)) : "—"} />
        </div>
        <form action={updateLadderAction} className="mt-4">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Band</th><th>Profit up to (£)</th><th>Price (pence)</th><th>Opens in band</th></tr></thead>
            <tbody>
              {ladder.map((b, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-1.5">{describeBand(ladder, i)}</td>
                  <td><input name={`upTo_${i}`} type="number" defaultValue={b.upTo ?? ""} placeholder="top band" className="w-32 rounded-md border border-border bg-background px-2 py-1" /></td>
                  <td><input name={`pence_${i}`} type="number" defaultValue={b.pence} className="w-24 rounded-md border border-border bg-background px-2 py-1" /></td>
                  <td>{bandCounts[i]}</td>
                </tr>
              ))}
              {ladder.length < 8 && (
                <tr className="border-t border-border">
                  <td className="py-1.5 text-xs text-muted-foreground">new band</td>
                  <td><input name={`upTo_${ladder.length}`} type="number" className="w-32 rounded-md border border-border bg-background px-2 py-1" /></td>
                  <td><input name={`pence_${ladder.length}`} type="number" className="w-24 rounded-md border border-border bg-background px-2 py-1" /></td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">Bands must ascend; leave the last ceiling blank. Daily picks drawn from the pool are charged the same ladder.</p>
          <button type="submit" className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Save ladder</button>
        </form>
      </section>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">Sweep, last 7 passes</h2>
          <table className="mt-3 w-full text-xs">
            <thead className="text-left text-muted-foreground"><tr><th className="py-1">When</th><th>Queries</th><th>Cached</th><th>Listings</th><th>New</th><th>Retired</th><th>Raw p</th></tr></thead>
            <tbody>
              {sweeps.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-1">{new Date(r.started_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                  <td>{n(r.summary.answered)}/{n(r.summary.queries)}</td>
                  <td>{n(r.summary.cached)}</td>
                  <td>{n(r.summary.listings)}</td>
                  <td>{n(r.summary.newDeals)}</td>
                  <td>{Object.values((r.summary.retired as Record<string, number>) ?? {}).reduce((a, b) => a + n(b), 0)}</td>
                  <td>{Math.round(n(r.summary.rawCostPence))}</td>
                </tr>
              ))}
              {sweeps.length === 0 && <tr><td className="py-2 text-muted-foreground" colSpan={7}>No sweep has run yet.</td></tr>}
            </tbody>
          </table>
        </section>
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">Recheck, last 24 runs</h2>
          <table className="mt-3 w-full text-xs">
            <thead className="text-left text-muted-foreground"><tr><th className="py-1">When</th><th>Due</th><th>Fetched</th><th>Live</th><th>Retired</th><th>Failed</th><th>Paused</th></tr></thead>
            <tbody>
              {rechecks.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-1">{new Date(r.started_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                  <td>{n(r.summary.due)}</td>
                  <td>{n(r.summary.fetched)}</td>
                  <td>{n(r.summary.live)}</td>
                  <td>{Object.values((r.summary.retired as Record<string, number>) ?? {}).reduce((a, b) => a + n(b), 0) + Object.values((r.summary.retiredStale as Record<string, number>) ?? {}).reduce((a, b) => a + n(b), 0)}</td>
                  <td>{n(r.summary.failed)}</td>
                  <td>{r.summary.paused ? "yes" : ""}</td>
                </tr>
              ))}
              {rechecks.length === 0 && <tr><td className="py-2 text-muted-foreground" colSpan={7}>No recheck has run yet.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>

      <section className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">Live deals by area</h2>
        {areas.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nothing live yet.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Area</th><th>To buy</th><th>Rent-to-rent</th><th>Total</th></tr></thead>
            <tbody>
              {areas.map(([code, c]) => (
                <tr key={code} className="border-t border-border"><td className="py-1.5">{areaMetaForCode(code).name} ({code})</td><td>{c.sale}</td><td>{c.rent}</td><td>{c.sale + c.rent}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mt-6 grid gap-6 md:grid-cols-2">
        <form action={retireDealAction} className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">Retire a deal</h2>
          <p className="mt-1 text-xs text-muted-foreground">Removes it from the grid now. Members who opened it keep it in their opened list. Paste the canonical listing URL.</p>
          <input name="canonical_url" type="url" required placeholder="https://www.rightmove.co.uk/properties/…" className="mt-3 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
          <button type="submit" className="mt-3 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Retire</button>
        </form>
        <form action={restoreDealAction} className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">Restore an admin-retired deal</h2>
          <p className="mt-1 text-xs text-muted-foreground">Only a deal retired from this page can be restored; the recheck reads its page again within the hour.</p>
          <input name="canonical_url" type="url" required placeholder="https://www.rightmove.co.uk/properties/…" className="mt-3 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
          <button type="submit" className="mt-3 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Restore</button>
        </form>
      </section>
    </div>
  );
}
