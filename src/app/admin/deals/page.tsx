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
import { dryRunSweepAction, runSweepPassAction, dryRunRecheckAction, runRecheckPassAction, retireDealAction, restoreDealAction, updateLadderAction, updateR2rBarAction, dryRunLowEntryAction, runLowEntryPassAction, updateLowEntryAction, runDealChecksAction, runDealRecheckAction, retireUncheckedAction, updateDealChecksAction } from "./actions";
import { R2R_MEDIUM_PROFIT, R2R_QUALIFIED_PROFIT } from "@/lib/listing/screen";
import { latestLowEntryRuns, lowEntrySearchEnabled } from "@/lib/deal-quality/low-entry-run";
import { weekSpentPence } from "@/lib/deal-quality/low-entry-plan";
import { STREAMS, STREAM_LABELS, streamOfRow, type Stream } from "@/lib/deal-quality/streams";
import { checksView } from "@/lib/deal-quality/checks-run";
import { readDealQualitySettings } from "@/lib/deal-quality/settings-server";
import type { CheckResult } from "@/lib/deal-quality/checks";

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
  r2r_saved: "Rent-to-rent bar saved. New screenings use it within a minute.",
  bad_r2r_bar: "The rent-to-rent bar must be whole pounds from £4,000 (the medium bar) to £20,000 (the cash bar).",
  low_entry_saved: "Low-entry settings saved. New records and the next search pass use them within a minute.",
  bad_low_entry: "Those settings did not parse: whole numbers, cash in £0–£1,000,000, price cap £10,000–£2,000,000, weekly cap 0–100,000p, bedrooms 0–6, areas a pass 1–30.",
  deal_checks_saved: "Deal-check settings saved. The next pass and the next re-screen use them within a minute.",
  bad_deal_checks: "Those settings did not parse: whole numbers, checks a day 0–500, daily cap 0–100,000p, each stream's slots 0–500, calls a check 1–10, a check good for 1–730 days, shortlist 1–60 days, re-check ceiling 0–100,000p.",
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
 * Searches the sweep had finished today by the end of a pass. Passes skip
 * what earlier passes finished (Batch 15), so a pass's own `answered` is only
 * its share; older rows, which re-read everything, keep showing `answered`.
 */
function sweepDoneToday(summary: Record<string, unknown>): number {
  if (typeof summary.doneToday !== "number") return n(summary.answered);
  return n(summary.doneToday) + (Array.isArray(summary.doneKeys) ? summary.doneKeys.length : 0);
}

const pounds = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

/**
 * Live deals by stream, all and gone live this week (Batch 16, Part F). The
 * stream column is read where the database has it; before schema.sql is run
 * each row is worked out from the deal it carries, as the record would.
 */
async function streamCounts(admin: ReturnType<typeof createAdminClient>, maxCashIn: number, weekAgo: string): Promise<{ counts: Record<Stream, { live: number; week: number }>; derived: boolean } | null> {
  const read = (withStream: boolean) => admin.from("marketplace_deals").select(withStream ? "kind, stream, deal, live_since" : "kind, deal, live_since").eq("status", "live").limit(20000);
  let { data, error } = await read(true);
  let derived = false;
  if (error) {
    derived = true;
    ({ data, error } = await read(false));
  }
  if (error) return null;
  const counts = Object.fromEntries(STREAMS.map((s) => [s, { live: 0, week: 0 }])) as Record<Stream, { live: number; week: number }>;
  for (const r of (data ?? []) as unknown as { kind: "sale" | "rent"; stream?: unknown; deal: unknown; live_since: string | null }[]) {
    const s = streamOfRow(r, { maxCashIn });
    counts[s].live += 1;
    if (r.live_since && r.live_since >= weekAgo) counts[s].week += 1;
  }
  return { counts, derived };
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
  const [lastRun, settings, runsRes, liveRes, pendingRes, retiredRes, opensRes, activeRes, checkingRes, byAreaRes, lowEntryRuns] = await Promise.all([
    readLastRun(),
    getBillingSettings(),
    admin.from("marketplace_runs").select("id, kind, dry, started_at, finished_at, summary").in("kind", ["sweep", "recheck"]).order("started_at", { ascending: false }).limit(40),
    admin.from("marketplace_deals").select("kind", { count: "exact", head: true }).eq("status", "live"),
    admin.from("marketplace_deals").select("kind", { count: "exact", head: true }).eq("status", "pending_verify"),
    admin.from("marketplace_deals").select("retired_reason").eq("status", "retired").gte("retired_at", weekAgo).limit(5000),
    admin.from("deal_opens").select("user_id, charged_base_pence, opened_at, verified_via, annual_profit_at_open").eq("status", "open").gte("opened_at", since).limit(5000),
    admin.from("profiles").select("id", { count: "exact", head: true }).gte("last_seen_at", since),
    admin.from("marketplace_deals").select("id", { count: "exact", head: true }).not("check_requested_at", "is", null).in("status", ["live", "pending_verify"]),
    admin.from("marketplace_deals").select("postcode_area, kind").eq("status", "live").limit(20000),
    latestLowEntryRuns(admin, 30),
  ]);
  const streams = await streamCounts(admin, settings.lowEntry.maxCashIn, weekAgo);
  const dealQuality = await readDealQualitySettings(admin);
  const checks = await checksView(admin, dealQuality);
  const checkSettings = dealQuality.checks;
  const lastCheckResults = ((checks?.runs.find((r) => Array.isArray(r.summary.results))?.summary.results as CheckResult[] | undefined) ?? []).slice(0, 40);
  const lowEntryWeekSpent = weekSpentPence(lowEntryRuns.map((r) => ({ startedAt: r.started_at, rawCostPence: r.summary.rawCostPence })), new Date());
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

      <section className="mt-8 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">Rent-to-rent bar</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A rent-to-rent listing qualifies on this much profit a year after rent and running costs (medium from £{R2R_MEDIUM_PROFIT.toLocaleString("en-GB")}). Decided default £{R2R_QUALIFIED_PROFIT.toLocaleString("en-GB")}. New screenings use it within a minute; a live deal is re-screened when its price changes, and one retired as unqualified can come back when the sweep next sees it.
        </p>
        <form action={updateR2rBarAction} className="mt-3 flex flex-wrap items-center gap-3">
          <label className="text-sm">£ a year <input name="r2rBar" type="text" inputMode="numeric" defaultValue={settings.r2rQualifiedProfit} className="ml-2 w-28 rounded-md border border-border bg-background px-2 py-1" /></label>
          <button type="submit" className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Save bar</button>
        </form>
      </section>

      {/* Batch 16, Part B: the daily paid checks. */}
      <section className="mt-8 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">Deal checks</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {checks?.enabled ? "ON" : "OFF (DEAL_CHECKS_ENABLED is not 'true': nothing is shortlisted, and the buttons work either way)"} · five passes at 03:40–04:20 UTC. A qualifying listing waits on the shortlist for its own Airbnb comparables check (nearest similar homes at its own location, through the analyser’s pipeline) instead of going live on the area’s average; the check decides what is shown and how sure the range is. Step 0 measured the check at a typical 11.5% from fresh full analyses, against 16.7% for the area average. House spend, {checkSettings.perDay} checks and {gbp(checkSettings.dailyCapPence)} a UK day, whichever binds first.
        </p>
        {checks ? (
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Checked today" value={`${STREAMS.reduce((n, s) => n + checks.spent.checked[s], 0)} of ${checks.perDay}`} sub={STREAMS.map((s) => `${STREAM_LABELS[s]} ${checks.spent.checked[s]}`).join(" · ")} />
            <Stat label="Spent today" value={`${gbp(Number.isFinite(checks.spent.pence) ? checks.spent.pence : 0)} of ${gbp(checks.capPence)}`} sub={`${checks.spent.runs} run${checks.spent.runs === 1 ? "" : "s"} since ${new Date(checks.day).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`} />
            <Stat label="Shortlist" value={STREAMS.reduce((n, s) => n + checks.waiting[s], 0)} sub={STREAMS.map((s) => `${STREAM_LABELS[s]} ${checks.waiting[s]}`).join(" · ")} />
            <Stat label="Live on their own check" value={checks.checkedLive} sub={`${checks.uncheckedLive} live on the area average`} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">The shortlist could not be read.</p>
        )}
        <form action={runDealChecksAction} className="mt-4 flex flex-wrap items-center gap-3">
          <button type="submit" name="mode" value="dry" className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Dry-run today’s checks</button>
          <button type="submit" name="mode" value="run" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Run a checks pass</button>
          <span className="text-xs text-muted-foreground">Dry run lists the day’s slots and what would be checked, and spends nothing. Run makes real Airbtics calls within the day’s cap and takes up to a minute.</span>
        </form>
        {lastCheckResults.length > 0 && (
          <table className="mt-4 w-full text-xs">
            <thead className="text-left text-muted-foreground"><tr><th className="py-1">Last run</th><th>Beds</th><th>Stream</th><th>Result</th><th>Confidence</th><th>Comps</th><th>Own £/yr</th><th>Area £/yr</th><th>Calls</th><th>p</th></tr></thead>
            <tbody>
              {lastCheckResults.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-1">{r.area ?? "?"} · {r.kind}</td>
                  <td>{r.bedrooms ?? "?"}</td>
                  <td>{STREAM_LABELS[r.stream] ?? r.stream}</td>
                  <td>{r.outcome}{r.error ? ` (${r.error})` : ""}</td>
                  <td>{r.confidence ?? "—"}</td>
                  <td>{r.comps ?? "—"}</td>
                  <td>{r.gross === null ? "—" : Math.round(r.gross).toLocaleString("en-GB")}</td>
                  <td>{r.areaGross === null ? "—" : Math.round(r.areaGross).toLocaleString("en-GB")}</td>
                  <td>{r.calls}</td>
                  <td>{r.pence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <table className="mt-4 w-full text-xs">
          <thead className="text-left text-muted-foreground"><tr><th className="py-1">When</th><th>Job</th><th>By</th><th>Checked</th><th>Outcomes</th><th>Calls</th><th>Raw p</th><th>Stopped</th></tr></thead>
          <tbody>
            {(checks?.runs ?? []).map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="py-1">{new Date(r.started_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                <td>{r.kind === "deal_checks" ? "daily" : r.summary.retiredUnchecked !== undefined ? "retire unchecked" : "re-check"}</td>
                <td>{String(r.summary.triggeredBy ?? "")}</td>
                <td>{r.summary.retiredUnchecked !== undefined ? `${n(r.summary.retiredUnchecked)} retired` : typeof r.summary.checked === "object" && r.summary.checked ? STREAMS.map((s) => n((r.summary.checked as Record<string, unknown>)[s])).reduce((a, b) => a + b, 0) : n(r.summary.checked)}{typeof r.summary.planned === "number" ? ` of ${r.summary.planned}` : ""}</td>
                <td>{Object.entries((r.summary.outcomes as Record<string, number>) ?? {}).map(([k, v]) => `${k} ${v}`).join(" · ")}</td>
                <td>{n(r.summary.calls)}</td>
                <td>{Math.round(n(r.summary.rawCostPence) * 10) / 10}</td>
                <td>{String(r.summary.stoppedBy ?? "")}</td>
              </tr>
            ))}
            {(checks?.runs ?? []).length === 0 && <tr><td className="py-2 text-muted-foreground" colSpan={8}>No check has run yet.</td></tr>}
          </tbody>
        </table>
        <form action={updateDealChecksAction} className="mt-4 grid gap-3 sm:grid-cols-4">
          <label className="text-sm">Checks a day<input name="perDay" type="text" inputMode="numeric" defaultValue={checkSettings.perDay} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1" /></label>
          <label className="text-sm">Daily cap, pence<input name="dailyCapPence" type="text" inputMode="numeric" defaultValue={checkSettings.dailyCapPence} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1" /></label>
          <label className="text-sm">Calls a check, at most<input name="maxCallsPerCheck" type="text" inputMode="numeric" defaultValue={checkSettings.maxCallsPerCheck} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1" /></label>
          <label className="text-sm">A check is good for, days<input name="validDays" type="text" inputMode="numeric" defaultValue={checkSettings.validDays} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1" /></label>
          <label className="text-sm">Slots: top areas<input name="splitTop60" type="text" inputMode="numeric" defaultValue={checkSettings.split.top60} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1" /></label>
          <label className="text-sm">Slots: low entry<input name="splitLowEntry" type="text" inputMode="numeric" defaultValue={checkSettings.split.low_entry} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1" /></label>
          <label className="text-sm">Slots: rent-to-rent<input name="splitR2r" type="text" inputMode="numeric" defaultValue={checkSettings.split.r2r} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1" /></label>
          <label className="text-sm">Shortlist waits, days<input name="shortlistExpiryDays" type="text" inputMode="numeric" defaultValue={checkSettings.shortlistExpiryDays} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1" /></label>
          <label className="text-sm">Re-check ceiling, pence<input name="recheckCeilingPence" type="text" inputMode="numeric" defaultValue={checkSettings.recheckCeilingPence} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1" /></label>
          <div className="flex items-end sm:col-span-3"><button type="submit" className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Save deal-check settings</button></div>
        </form>
      </section>

      <section className="mt-8 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">Live deals still on the area average</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {checks ? `${checks.uncheckedLive} live deals` : "The live deals"} were screened on the area’s average before the checks existed. The one-off re-check gives each its own comparables check, sales by annual profit first and then rentals, within its ceiling ({checks ? `${gbp(checks.recheckSpentPence)} of ${gbp(checks.recheckCeilingPence)} spent so far` : gbp(checkSettings.recheckCeilingPence)}) and the day’s cap; a pass keeps the deal live on its new figure, too few similar homes or a figure under the bar retires it. Each run carries on where the last stopped. The other way is to retire them all as unchecked: the next sweep revives each onto the shortlist while it is still in the feed, so it comes back through a check over the following days.
        </p>
        <form action={runDealRecheckAction} className="mt-3 flex flex-wrap items-center gap-3">
          <button type="submit" name="mode" value="dry" className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Dry-run the re-check</button>
          <button type="submit" name="mode" value="run" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Run a re-check pass</button>
        </form>
        <form action={retireUncheckedAction} className="mt-3 flex flex-wrap items-center gap-3">
          <button type="submit" name="mode" value="dry" className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Count unchecked live deals</button>
          <button type="submit" name="mode" value="retire" className="rounded-md border border-destructive px-4 py-2 text-sm font-medium text-destructive hover:bg-muted">Retire every unchecked live deal</button>
          <span className="text-xs text-muted-foreground">Retiring takes them off the grid now; members who opened one keep it. Count first.</span>
        </form>
      </section>

      {/* Batch 16, Part F: the three streams and the nationwide low-entry search. */}
      <section className="mt-8 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">Streams</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every deal is in one stream from the moment it is screened: a rental is rent-to-rent; a sale the house finance (25% deposit, its nation’s tax, £6,000 + £3,500 a bedroom of setup) gets into for at most {pounds(settings.lowEntry.maxCashIn)} is low entry, an auction lot at its auction price; every other sale is a top-area deal. “This week” counts deals that went live in the last 7 days.
          {streams?.derived ? " The stream column is not in the database yet (run schema.sql): each row is worked out from the deal it carries." : ""}
        </p>
        <table className="mt-3 w-full max-w-md text-sm">
          <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Stream</th><th>Live</th><th>This week</th></tr></thead>
          <tbody>
            {STREAMS.map((s) => (
              <tr key={s} className="border-t border-border"><td className="py-1.5">{STREAM_LABELS[s]}</td><td>{streams ? streams.counts[s].live : "—"}</td><td>{streams ? streams.counts[s].week : "—"}</td></tr>
            ))}
          </tbody>
        </table>
        <form action={updateLowEntryAction} className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="text-sm">Low-entry cash in, £<input name="maxCashIn" type="text" inputMode="numeric" defaultValue={settings.lowEntry.maxCashIn} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1" /></label>
          <label className="text-sm">Search price cap, £<input name="searchMaxPrice" type="text" inputMode="numeric" defaultValue={settings.lowEntry.searchMaxPrice} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1" /></label>
          <label className="text-sm">Weekly search cap, pence<input name="weeklyCapPence" type="text" inputMode="numeric" defaultValue={settings.lowEntry.weeklyCapPence} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1" /></label>
          <label className="text-sm">Bedrooms, at least<input name="minBedrooms" type="text" inputMode="numeric" defaultValue={settings.lowEntry.minBedrooms} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1" /></label>
          <label className="text-sm">Areas a pass<input name="areasPerPass" type="text" inputMode="numeric" defaultValue={settings.lowEntry.areasPerPass} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1" /></label>
          <div className="flex items-end"><button type="submit" className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Save low-entry settings</button></div>
        </form>
      </section>

      <section className="mt-8 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">Nationwide low-entry search</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {lowEntrySearchEnabled() ? "ON" : "OFF (LOW_ENTRY_SEARCH_ENABLED is not 'true'; the buttons work either way)"} · three passes at 03:00, 03:10 and 03:20 UTC, each the next {settings.lowEntry.areasPerPass} of every UK postcode area: sale listings up to {pounds(settings.lowEntry.searchMaxPrice)} with {settings.lowEntry.minBedrooms}+ bedrooms, so each area comes round about weekly. An area with no card of its own is screened on its region’s figures at low confidence. This UK week: {gbp(lowEntryWeekSpent)} of the {gbp(settings.lowEntry.weeklyCapPence)} cap. A dry run lists the areas the next pass would search and its worst-case cost, and spends nothing.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <form action={dryRunLowEntryAction}><button type="submit" className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Dry-run low-entry search</button></form>
          <form action={runLowEntryPassAction}><button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Run a low-entry pass</button></form>
        </div>
        <table className="mt-3 w-full text-xs">
          <thead className="text-left text-muted-foreground"><tr><th className="py-1">When</th><th>By</th><th>Searched</th><th>Cached</th><th>Listings</th><th>New</th><th>Raw p</th><th>Stopped</th></tr></thead>
          <tbody>
            {lowEntryRuns.slice(0, 7).map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="py-1">{new Date(r.started_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                <td>{String(r.summary.triggeredBy ?? "")}</td>
                <td>{n(r.summary.searched)}/{n(r.summary.pending)}</td>
                <td>{n(r.summary.cached)}</td>
                <td>{n(r.summary.listings)}</td>
                <td>{n(r.summary.newDeals)}</td>
                <td>{Math.round(n(r.summary.rawCostPence) * 10) / 10}</td>
                <td>{String(r.summary.stoppedBy ?? "")}</td>
              </tr>
            ))}
            {lowEntryRuns.length === 0 && <tr><td className="py-2 text-muted-foreground" colSpan={8}>No pass has run yet.</td></tr>}
          </tbody>
        </table>
      </section>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">Sweep, last 7 passes</h2>
          <table className="mt-3 w-full text-xs">
            <thead className="text-left text-muted-foreground"><tr><th className="py-1">When</th><th title="Searches finished today by the end of this pass, out of the sweep's list">Done today</th><th>Cached</th><th>Listings</th><th>New</th><th>Retired</th><th>Raw p</th></tr></thead>
            <tbody>
              {sweeps.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-1">{new Date(r.started_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                  <td>{sweepDoneToday(r.summary)}/{n(r.summary.queries)}</td>
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
