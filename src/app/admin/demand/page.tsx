import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin";
import { pmiAccount, pmiConfigured } from "@/lib/broker/providers/pmi";
import { COST_PENCE } from "@/lib/broker/config";
import { getUnitCostTable } from "@/lib/credit/unit-costs";
import { unitKey } from "@/lib/credit/costs";
import { londonDay, londonMonthStart } from "@/lib/sms/uk-time";
import { loadScreenContext } from "@/lib/marketplace/server";
import { sweepEnabled } from "@/lib/marketplace/sweep-plan";
import { LAST_SEARCHES_SHOWN, MAX_SEARCHES_PER_PASS, NEW_DEALS_WINDOW_DAYS, SNAPSHOT_WAIT_MS } from "@/lib/sourcing-demand/config";
import { reservePence } from "@/lib/sourcing-demand/cost";
import { cellKey, planSearches, type DemandPlan, type SkipReason } from "@/lib/sourcing-demand/demand";
import { DEFAULT_DEMAND_SETTINGS } from "@/lib/sourcing-demand/settings";
import { demandSourcingEnabled } from "@/lib/sourcing-demand/run";
import { addedSince, areaDataFrom, cachedAnswerKeys, lastSearches, livePool, loadDemand, monthFigures, readDemandSettings, sweepAreaSet, sweepDoneToday, todaysSearches } from "@/lib/sourcing-demand/server";
import { defaultDir, demandRows, isSortKey, planView, sortRows, STATUS_LABELS, supplyFrom, type SortDir, type SortKey } from "@/lib/sourcing-demand/table";
import { calibrationView } from "@/lib/deal-quality/calibrate-run";
import { CALIBRATION_GATE_PCT, CALIBRATION_MAX_CALLS, VARIANTS, VARIANT_LABELS } from "@/lib/deal-quality/calibration";
import { runDealCalibrationAction, runDemandPassAction, updateDemandSettingsAction } from "./actions";
import { oneOf } from "../picks/responses/windows";

// Mirrored in actions.ts: a 'use server' module may only export async functions.
const FLASH_COOKIE = "sf_demand_flash";

export const metadata: Metadata = { title: "Demand vs supply — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
// "Run a pass now" runs a real pass inside the request.
export const maxDuration = 60;

interface Flash {
  kind: string;
  at: string;
  body: Record<string, unknown>;
}

async function readFlash(): Promise<Flash | null> {
  try {
    const raw = (await cookies()).get(FLASH_COOKIE)?.value;
    if (!raw) return null;
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Flash;
  } catch {
    return null;
  }
}

/** Pence as money: pennies with a decimal under a pound, pounds and pence above. */
function money(pence: number | null): string {
  if (pence === null || !Number.isFinite(pence)) return "—";
  return pence < 100 ? `${(Math.round(pence * 10) / 10).toString()}p` : `£${(pence / 100).toFixed(2)}`;
}

function nextMonthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

const KIND_LABEL: Record<string, string> = { sale: "Buy", rent: "R2R" };
const TYPE_LABEL: Record<string, string> = { house: "House", flat: "Flat" };
const SKIP_LABEL: Record<SkipReason, string> = { below_threshold: "below the threshold", in_sweep: "in the sweep", no_data: "no screening data", searched_today: "searched today", no_answer_today: "no answer twice today, tried again tomorrow" };

const COLUMNS: { key: SortKey; label: string; right?: boolean; title?: string }[] = [
  { key: "area", label: "Area" },
  { key: "kind", label: "Kind" },
  { key: "type", label: "Type" },
  { key: "members", label: "Members", right: true, title: "Members wanting it (a team counts once)" },
  { key: "paying", label: "Paying", right: true, title: "Of those, paying members" },
  { key: "profiles", label: "Profiles", right: true, title: "Running profiles wanting it" },
  { key: "live", label: "Live deals", right: true },
  { key: "new", label: `New ${NEW_DEALS_WINDOW_DAYS}d`, right: true, title: `Deals added to the pool in the last ${NEW_DEALS_WINDOW_DAYS} days, whatever their status now` },
  { key: "status", label: "In sourcing" },
  { key: "gap", label: "Gap", right: true, title: "Profiles wanting it minus live deals: above 0, demand outstrips supply" },
];

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="text-3xl font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

/**
 * Demand vs supply: per postcode area × kind × type, the members and
 * profiles that want it beside the deals the pool holds, whether it is
 * searched (by the sweep or the demand-led searches) and the gap. Plus this
 * month's spend against the cap, the next pass's plan, the settings and the
 * latest searches. Admin only. Areas and counts only: no member, no deal
 * address, postcode or link.
 */
export default async function DemandAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/demand");
  if (!isAdminEmail(user.email)) notFound();

  const sortParam = oneOf(params.sort);
  const sort: SortKey = isSortKey(sortParam) ? sortParam : "gap";
  const dirParam = oneOf(params.dir);
  const dir: SortDir = dirParam === "asc" || dirParam === "desc" ? dirParam : defaultDir(sort);
  const kindParam = oneOf(params.kind);
  const kindFilter = kindParam === "sale" || kindParam === "rent" ? kindParam : null;
  const showAll = oneOf(params.all) === "1";

  const admin = createAdminClient();
  const now = new Date();
  const month = londonMonthStart(now);
  const settings = await readDemandSettings(admin);
  const since = new Date(now.getTime() - NEW_DEALS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const [ctx, demand, figures, today, live, added, doneToday, searches, cached, table, pmi, flash, calibration] = await Promise.all([
    loadScreenContext(SNAPSHOT_WAIT_MS),
    loadDemand(admin, settings, now),
    monthFigures(admin, month),
    todaysSearches(admin, londonDay(now)),
    livePool(admin),
    addedSince(admin, since),
    sweepDoneToday(admin, now),
    lastSearches(admin, LAST_SEARCHES_SHOWN),
    cachedAnswerKeys(admin, now),
    getUnitCostTable(),
    pmiConfigured() ? pmiAccount().catch(() => null) : Promise.resolve(null),
    readFlash(),
    calibrationView(admin, now),
  ]);

  const schemaReady = figures !== null && searches !== null;
  const reserve = reservePence((p, u) => table.get(unitKey(p, u))?.unitCostPence ?? null, COST_PENCE.pmiListings);
  const spent = figures?.spentPence ?? 0;
  const capReached = schemaReady && settings.capPence - spent < reserve;
  const liveSupply = supplyFrom(live ?? []);
  const liveDeals = new Map<string, number>();
  for (const [key, c] of liveSupply.byCell) liveDeals.set(key, c.house + c.flat);
  for (const [key, n] of liveSupply.unknown) liveDeals.set(key, (liveDeals.get(key) ?? 0) + n);
  const sweepAreas = ctx ? sweepAreaSet(ctx.cards) : new Set<string>();
  const plan: DemandPlan = demand && ctx ? planSearches(demand, { minMembers: settings.minMembers, payingWeight: settings.payingWeight, sweepAreas, areaData: areaDataFrom(ctx.cards), searchedToday: today?.searched ?? new Set(), gaveUpToday: today?.gaveUp ?? new Set(), liveDeals }) : { searches: [], skipped: [] };
  const view = planView(plan, reserve, cached, MAX_SEARCHES_PER_PASS);
  const rows = demand ? sortRows(demandRows({ demand, plan, sweepAreas, sweepDoneToday: doneToday, live: liveSupply, added: supplyFrom(added ?? []), capReached, includeUnwanted: showAll }).filter((r) => !kindFilter || r.kind === kindFilter), sort, dir) : [];
  const unknownTypes = [...liveSupply.unknown.entries()].sort((a, b) => b[1] - a[1]);
  const skippedCounts = new Map<SkipReason, number>();
  for (const s of view.skipped) skippedCounts.set(s.reason, (skippedCounts.get(s.reason) ?? 0) + 1);

  const query = (over: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | null> = { sort, dir, kind: kindFilter, all: showAll ? "1" : null, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/admin/demand?${p.toString()}`;
  };
  const href = (key: SortKey) => query({ sort: key, dir: key === sort ? (dir === "asc" ? "desc" : "asc") : defaultDir(key) });
  const arrow = (key: SortKey) => (key === sort ? (dir === "asc" ? " ↑" : " ↓") : "");
  const pct = settings.capPence > 0 ? Math.min(100, Math.round((spent / settings.capPence) * 100)) : 100;

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Demand vs supply</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Demand-led searches are {demandSourcingEnabled() ? "ON" : "OFF (set DEMAND_SOURCING_ENABLED=true)"} · the sweep is {sweepEnabled() ? "ON" : "OFF"}. An area × kind is searched once {settings.minMembers} member{settings.minMembers === 1 ? "" : "s"} want it and the sweep does not cover it; paying members count ×{settings.payingWeight} in the order.
          </p>
        </div>
        <Link href="/admin" className="text-sm font-medium text-primary hover:underline">← Dashboard</Link>
      </div>

      {!schemaReady && (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Not set up yet: run the “Batch 15: demand-led sourcing” section of supabase/schema.sql. Until then nothing is searched and spend is not tracked.
        </p>
      )}
      {!ctx && <p className="mb-4 rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">The market snapshot is still building, so the plan and the sweep columns are empty. Reload in a minute.</p>}
      {capReached && (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          This month’s cap is reached: demand-led searches are paused until {nextMonthLabel(month)}. The sweep and daily picks are not affected.
        </p>
      )}
      {flash && (
        <div className="mb-4 rounded-lg border border-border bg-card p-4 text-sm">
          <p className="font-medium text-foreground">
            {flash.kind === "settings" ? (flash.body.error ? String(flash.body.error) : "Settings saved. The job reads them within a minute.") : flash.kind === "calibration-dry" ? "Comparison dry run (nothing spent)" : flash.kind === "calibration" ? "Comparison run" : "Pass run"} · {new Date(flash.at).toLocaleString("en-GB")}
          </p>
          {(flash.kind === "pass" || flash.kind === "calibration" || flash.kind === "calibration-dry") && <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{JSON.stringify(flash.body, null, 1)}</pre>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Spent this month" value={money(spent)} sub={`of ${money(settings.capPence)} cap (${pct}%) · resets ${nextMonthLabel(month)}`} />
        <Stat label="Demand-led searches this month" value={figures?.searches ?? 0} sub={`${figures?.answered ?? 0} answered · ${figures?.newDeals ?? 0} new deals`} />
        <Stat label="Wanted area × kinds" value={demand?.cells.size ?? 0} sub={`${plan.searches.length} to search · ${demand?.summary.members ?? 0} members, ${demand?.summary.profiles ?? 0} running profiles`} />
        <Stat label="PMI credits left" value={pmi?.credits_remaining ?? "—"} sub={pmi ? `of ${pmi.credits_monthly ?? "?"} (${pmi.plan ?? "plan"})` : pmiConfigured() ? "PMI account unreachable" : "PMI not configured"} />
      </div>
      {demand && (
        <p className="mt-2 text-xs text-muted-foreground">
          Counted: members seen in the last {settings.activeDays} days, not staff or switched off ({demand.summary.leftOut.staff} left out as staff or test). {demand.summary.profilesWithoutAreas} running profile{demand.summary.profilesWithoutAreas === 1 ? "" : "s"} add no areas (“most profitable anywhere”, or no answers yet).
        </p>
      )}

      <section className="mt-8 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">Next pass</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          What the next pass would search, most wanted first (up to {MAX_SEARCHES_PER_PASS} a pass, twelve passes a morning between the sweep’s). Each claims its worst case ({money(reserve)}) against the cap first and is settled to what it really cost.
          {view.skipped.length > 0 && ` Skipped: ${[...skippedCounts.entries()].map(([r, n]) => `${n} ${SKIP_LABEL[r]}`).join(", ")}.`}
        </p>
        {view.wouldSearch.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nothing to search: no area outside the sweep is wanted by {settings.minMembers} or more members yet.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="py-1">Search</th><th className="text-right">Members</th><th className="text-right">Paying</th><th className="text-right">Profiles</th><th>Data</th><th className="text-right">Worst case</th></tr>
            </thead>
            <tbody>
              {view.wouldSearch.map((s) => (
                <tr key={s.key} className={`border-t border-border ${s.thisPass ? "" : "text-muted-foreground"}`}>
                  <td className="py-1">{s.area} · {KIND_LABEL[s.kind]}{s.thisPass ? "" : " (a later pass)"}</td>
                  <td className="text-right">{s.members}</td>
                  <td className="text-right">{s.paying}</td>
                  <td className="text-right">{s.profiles}</td>
                  <td>{s.early ? "early (1–4 reports)" : "confirmed"}</td>
                  <td className="text-right">{s.estPence === 0 ? "free (cached)" : money(s.estPence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form action={runDemandPassAction} className="mt-4">
          <button type="submit" disabled={!schemaReady} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">Run a pass now</button>
          <span className="ml-3 text-xs text-muted-foreground">Real searches, within the cap and the threshold, whatever the switch says. Takes up to a minute.</span>
        </form>
      </section>

      <section className="mt-8 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">Deal checks · Step 0: comparison with past reports</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Re-runs {calibration?.cases || 24} past full analyses (8 urban, 8 rural, 8 coastal; 1–5 beds) through the deal check’s own comparables search, at their own location, and compares the new yearly revenue with the stored one. If the typical gap is over {CALIBRATION_GATE_PCT}%, the deal checks are not built on it. At most {CALIBRATION_MAX_CALLS} Airbtics calls ({money(CALIBRATION_MAX_CALLS * 5)}) for the whole comparison, house spend. Each Run carries on where the last one stopped.
        </p>
        {!calibration ? (
          <p className="mt-3 text-sm text-muted-foreground">The runs could not be read.</p>
        ) : (
          <>
            {calibration.dry && (
              <p className="mt-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
                Dry run {new Date(calibration.dry.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}: {String(calibration.dry.remaining ?? "?")} of {String(calibration.dry.cases ?? "?")} cases to run, at most {money(Number(calibration.dry.maxCostPence ?? 0))} (expect about {money(Number(calibration.dry.expectedCostPence ?? 0))}); {String(calibration.dry.callsUsed ?? 0)} of {CALIBRATION_MAX_CALLS} calls used so far.{calibration.dry.airbticsKey === false ? " No Airbtics key here: a Run would search nothing." : ""}
              </p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Cases done" value={`${calibration.summary.done} of ${calibration.cases || "—"}`} sub={calibration.summary.failed > 0 ? `${calibration.summary.failed} to retry` : undefined} />
              <Stat label="Calls used" value={`${calibration.summary.calls} of ${CALIBRATION_MAX_CALLS}`} sub={`${money(calibration.summary.pence)} spent`} />
              <Stat label="Typical gap (as planned)" value={calibration.summary.medianAbsGap.planned === null ? "—" : `${calibration.summary.medianAbsGap.planned}%`} sub={calibration.summary.medianGapPlanned === null ? undefined : `median signed ${calibration.summary.medianGapPlanned > 0 ? "+" : ""}${calibration.summary.medianGapPlanned}%`} />
              <Stat label="Gate" value={calibration.summary.gate === "pass" ? "Pass" : calibration.summary.gate === "fail" ? "Stop" : "Waiting"} sub={calibration.summary.best ? `closest: ${VARIANT_LABELS[calibration.summary.best]}` : "needs 20 cases"} />
            </div>
            <ul className="mt-3 text-xs text-muted-foreground">
              {VARIANTS.map((v) => (
                <li key={v}>{VARIANT_LABELS[v]}: typical gap {calibration.summary.medianAbsGap[v] === null ? "—" : `${calibration.summary.medianAbsGap[v]}%`}</li>
              ))}
              <li>
                By class (as planned): {Object.entries(calibration.summary.byClass).map(([cls, c]) => `${cls.replace("_", " ")} ${c.medianAbsGap === null ? "—" : `${c.medianAbsGap}%`} (${c.n})`).join(" · ")}
              </li>
              <li>
                Confidence (as planned): {Object.entries(calibration.summary.confidence).map(([c, n]) => `${c} ${n}`).join(" · ") || "—"}{calibration.summary.insufficient > 0 ? ` · ${calibration.summary.insufficient} under the minimum comparables would not be shown` : ""}
              </li>
            </ul>
            {calibration.results.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr><th className="py-1">Area</th><th>Class</th><th className="text-right">Beds</th><th className="text-right">Stored</th><th className="text-right">New</th><th className="text-right">Gap</th><th className="text-right">Comps</th><th className="text-right">Reach</th><th className="text-right">Calls</th><th>Confidence</th><th>Note</th></tr>
                  </thead>
                  <tbody>
                    {calibration.results.map((r) => {
                      const v = r.variants.planned;
                      return (
                        <tr key={r.id} className="border-t border-border">
                          <td className="py-1">{r.area}</td>
                          <td>{r.locationClass.replace("_", " ")}</td>
                          <td className="text-right">{r.bedrooms} ({r.guests}g)</td>
                          <td className="text-right">£{Math.round(r.storedGross).toLocaleString("en-GB")}</td>
                          <td className="text-right">{v?.gross ? `£${v.gross.toLocaleString("en-GB")}` : "—"}</td>
                          <td className={`text-right ${v?.gapPct !== null && v?.gapPct !== undefined && Math.abs(v.gapPct) > CALIBRATION_GATE_PCT ? "font-medium text-foreground" : "text-muted-foreground"}`}>{v?.gapPct === null || v?.gapPct === undefined ? "—" : `${v.gapPct > 0 ? "+" : ""}${v.gapPct}%`}</td>
                          <td className="text-right">{v?.compCount ?? 0} of {r.found}</td>
                          <td className="text-right">{r.radiusKm} km</td>
                          <td className="text-right">{r.calls}</td>
                          <td>{v?.confidence ?? "—"}{v?.spreadPct !== null && v?.spreadPct !== undefined ? ` (±${v.spreadPct}%; past ±${r.storedSpreadPct ?? "?"}%)` : ""}</td>
                          <td className="text-xs text-muted-foreground">{[r.error, r.kindRelaxed ? "any kind" : null, r.filtered ? null : "filters refused", r.filterMatch !== null && r.filterMatch < 0.9 ? `filters ${Math.round(r.filterMatch * 100)}%` : null, r.settingDropped > 0 ? `setting −${r.settingDropped}` : null].filter(Boolean).join(" · ")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        <form action={runDealCalibrationAction} className="mt-4 flex flex-wrap items-center gap-3">
          <button type="submit" name="mode" value="dry" className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Dry run</button>
          <button type="submit" name="mode" value="run" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Run</button>
          <span className="text-xs text-muted-foreground">Dry run spends nothing. Run makes real Airbtics calls within the comparison’s ceiling and takes up to a minute.</span>
        </form>
      </section>

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">By area</h2>
          <div className="flex gap-3 text-sm">
            <Link href={query({ kind: null })} className={kindFilter === null ? "font-semibold text-foreground" : "text-primary hover:underline"}>Both kinds</Link>
            <Link href={query({ kind: "sale" })} className={kindFilter === "sale" ? "font-semibold text-foreground" : "text-primary hover:underline"}>Buy</Link>
            <Link href={query({ kind: "rent" })} className={kindFilter === "rent" ? "font-semibold text-foreground" : "text-primary hover:underline"}>R2R</Link>
            <Link href={query({ all: showAll ? null : "1" })} className="text-primary hover:underline">{showAll ? "Only wanted areas" : "Show areas nobody wants"}</Link>
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            {demand ? (showAll ? "No demand and no deals yet." : "No member’s running profile wants an area yet. “Show areas nobody wants” lists the supply on its own.") : "The members could not be read."}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className={`px-3 py-2 ${c.right ? "text-right" : ""}`} title={c.title}>
                      <Link href={href(c.key)} className="hover:text-foreground">{c.label}{arrow(c.key)}</Link>
                    </th>
                  ))}
                  <th className="px-3 py-2">Wants</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${cellKey(r.area, r.kind)}|${r.type}`} className="border-t border-border">
                    <td className="px-3 py-1.5"><span className="font-medium text-foreground">{r.area}</span> <span className="text-muted-foreground">{r.areaName}</span></td>
                    <td className="px-3">{KIND_LABEL[r.kind]}</td>
                    <td className="px-3">{TYPE_LABEL[r.type]}{r.kind === "sale" && r.type === "flat" ? " *" : ""}</td>
                    <td className="px-3 text-right">{r.members}</td>
                    <td className="px-3 text-right">{r.paying}</td>
                    <td className="px-3 text-right">{r.profiles}</td>
                    <td className="px-3 text-right">{r.liveDeals}</td>
                    <td className="px-3 text-right">{r.newDeals}</td>
                    <td className="px-3">{r.status === "below_threshold" ? `${STATUS_LABELS[r.status]} (${r.members} of ${settings.minMembers})` : STATUS_LABELS[r.status]}{r.early ? " · early data" : ""}</td>
                    <td className={`px-3 text-right font-medium ${r.gap > 0 ? "text-foreground" : "text-muted-foreground"}`}>{r.gap}</td>
                    <td className="px-3 text-xs text-muted-foreground">{r.mustHaves ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          A profile open to either type counts in both rows. * Sale flats are always 0: the short-let check retires a leasehold flat unless its listing says short lets are allowed.
          {unknownTypes.length > 0 && ` Live deals the portal gives no type for (in neither row): ${unknownTypes.slice(0, 12).map(([k, n]) => `${k.replace("|sale", " buy").replace("|rent", " R2R")} ${n}`).join(", ")}.`}
        </p>
      </section>

      <section className="mt-8 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">Saved to billing_settings; the job and this page read them within a minute. There is no admin log: a change records only its time.</p>
        <form action={updateDemandSettingsAction} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-sm">Members needed<input name="minMembers" type="number" min={1} max={100} step={1} defaultValue={settings.minMembers} className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1" /></label>
          <label className="text-sm">Monthly cap (£)<input name="capPounds" type="text" inputMode="decimal" defaultValue={(settings.capPence / 100).toFixed(2)} className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1" /></label>
          <label className="text-sm">Paying member weight<input name="payingWeight" type="number" min={1} max={10} step={0.5} defaultValue={settings.payingWeight} className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1" /></label>
          <label className="text-sm">Areas near home (besides the home area)<input name="radiusAreas" type="number" min={0} max={20} step={1} defaultValue={settings.radiusAreas} className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1" /></label>
          <label className="text-sm">Active in the last (days)<input name="activeDays" type="number" min={1} max={365} step={1} defaultValue={settings.activeDays} className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1" /></label>
          <label className="text-sm">Most areas per profile<input name="maxAreasPerProfile" type="number" min={1} max={50} step={1} defaultValue={settings.maxAreasPerProfile} className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1" /></label>
          <div className="sm:col-span-3">
            <button type="submit" className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Save settings</button>
            <span className="ml-3 text-xs text-muted-foreground">Decided defaults: {DEFAULT_DEMAND_SETTINGS.minMembers} members, {money(DEFAULT_DEMAND_SETTINGS.capPence)} a month, paying ×{DEFAULT_DEMAND_SETTINGS.payingWeight}, {DEFAULT_DEMAND_SETTINGS.radiusAreas} areas near home, {DEFAULT_DEMAND_SETTINGS.activeDays} days, {DEFAULT_DEMAND_SETTINGS.maxAreasPerProfile} areas a profile.</span>
          </div>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold text-foreground">Latest demand-led searches</h2>
        {!searches || searches.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">{schemaReady ? "None yet." : "Nothing recorded until the schema section is run."}</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr><th className="px-3 py-2">When</th><th className="px-3">Search</th><th className="px-3">Result</th><th className="px-3">Provider</th><th className="px-3 text-right">Cost</th><th className="px-3 text-right">Listings</th><th className="px-3 text-right">New deals</th><th className="px-3">By</th></tr>
              </thead>
              <tbody>
                {searches.map((s, i) => (
                  <tr key={`${s.reserved_at}-${i}`} className="border-t border-border">
                    <td className="px-3 py-1.5">{new Date(s.reserved_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-3">{s.postcode_area} · {KIND_LABEL[s.kind] ?? s.kind}</td>
                    <td className="px-3">{s.status}{s.cached ? " (cached)" : ""}</td>
                    <td className="px-3">{s.provider ?? "—"}</td>
                    <td className="px-3 text-right">{money(s.cost_pence === null ? Number(s.reserve_pence) : Number(s.cost_pence))}{s.cost_pence === null ? " (open)" : ""}</td>
                    <td className="px-3 text-right">{s.listings ?? "—"}</td>
                    <td className="px-3 text-right">{s.new_deals ?? "—"}</td>
                    <td className="px-3 text-xs text-muted-foreground">{s.triggered_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
