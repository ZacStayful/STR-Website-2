import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin";
import { getBillingSettings } from "@/lib/credit/unit-costs";
import { adminDecisions, memberIdByEmail, recentRuns, type AdminDecision } from "@/lib/standout/admin-server";
import { runStandout, standoutEnabled, type DecisionView } from "@/lib/standout/run";
import { dealCallsEnabled } from "@/lib/standout/notify-server";
import { callStatusLabel, reasonLabel } from "@/lib/standout/reasons";
import { STANDOUT_KEYS, type StandoutSettings } from "@/lib/standout/settings";
import { forceStandoutAction, runStandoutPassAction, updateStandoutSettingsAction } from "./actions";
import { oneOf } from "../picks/responses/windows";

// Mirrored in actions.ts: a 'use server' module may only export async functions.
const FLASH_COOKIE = "sf_standout_flash";

export const metadata: Metadata = { title: "Standout deals — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
// The dry run and "Run a pass now" run a pass inside the request.
export const maxDuration = 120;

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

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "—");
const pounds = (n: number | null) => (n === null ? "—" : `£${Math.round(n).toLocaleString("en-GB")}`);
const BASIS: Record<string, string> = { range: "low end", after_works: "after works", after_refinance: "after refinance" };

const SETTING_FIELDS: { key: keyof StandoutSettings; label: string }[] = [
  { key: "minMatchPct", label: "Minimum match %" },
  { key: "minChecked", label: "Minimum answers checked" },
  { key: "profitOverMinPct", label: "Profit above the member's minimum, %" },
  { key: "liveConfirmHours", label: "Confirmed live within, hours" },
  { key: "callsPerMonth", label: "Deal calls a member, per calendar month" },
  { key: "callMinBalancePence", label: "No call below this balance, pence" },
  { key: "rechecksPerRun", label: "Listings a pass may recheck" },
  { key: "maxPerDay", label: "Standouts a member, per day (0 = no limit)" },
  { key: "beatBestDays", label: "Must beat what they had in the last … days (0 = off)" },
  { key: "keepDays", label: "Keep not-standout decisions, days" },
  { key: "slowerSpenderMinDays", label: "Slower-spender nudge: from day" },
  { key: "slowerSpenderMaxDays", label: "Slower-spender nudge: to day" },
];

function Outcome({ d }: { d: AdminDecision }) {
  if (d.notForMeAt) return <span>Not for me · {when(d.notForMeAt)}</span>;
  if (d.openedAt) return <span>Opened · {when(d.openedAt)}</span>;
  if (d.stageMovedAt) return <span>Moved · {when(d.stageMovedAt)}</span>;
  return <span className="text-muted-foreground">—</span>;
}

/**
 * Standout deals: every decision the standout pass made, with its reason —
 * who was saved a deal and called, and why someone wasn't. Admin only. Deal
 * facts are public ones (town, area, bedrooms, type); no address, no listing.
 */
export default async function StandoutAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/standout");
  if (!isAdminEmail(user.email)) notFound();

  const admin = createAdminClient();
  const memberEmail = oneOf(params.member)?.trim() || null;
  const all = oneOf(params.all) === "1";
  const dry = oneOf(params.dry) === "1";
  const memberId = memberEmail ? await memberIdByEmail(admin, memberEmail) : null;
  const [settings, decisions, runs, flash, dryRun] = await Promise.all([
    getBillingSettings(),
    adminDecisions(admin, { memberId, all: all || Boolean(memberId), limit: 300 }),
    recentRuns(admin),
    readFlash(),
    dry ? runStandout({ apply: false, onlyUserId: memberId }) : Promise.resolve(null),
  ]);
  const s = settings.standout;
  const schemaReady = decisions !== null && runs !== null;

  return (
    <div className="mx-auto max-w-7xl px-5 py-10">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Standout deals</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Saving is {standoutEnabled() ? "ON" : "OFF (set STANDOUT_ENABLED=true)"} · deal calls are {dealCallsEnabled() ? "ON" : "OFF (set STANDOUT_CALLS_ENABLED=true; Batch 23's SI_CALLS_ENABLED too)"}. A deal is standout for a member when, on their primary profile and for a deal type it shows, it misses no must-have, checks at least {s.minChecked} answers at {s.minMatchPct}% or better (and at least their signup reveal&rsquo;s best), and the low end of its profit is {s.profitOverMinPct}% or more above their minimum. At most {s.maxPerDay || "any number of"} a day, beating what they already had in the last {s.beatBestDays} days; {s.callsPerMonth} calls a calendar month.
          </p>
        </div>
        <Link href="/admin" className="text-sm font-medium text-primary hover:underline">← Dashboard</Link>
      </div>

      {!schemaReady && (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Not set up yet: run the &ldquo;Batch 25: standout-deal calls&rdquo; section of supabase/schema.sql. Until then nothing is judged or saved.
        </p>
      )}

      {flash && (
        <div className="mb-4 rounded-md border border-border bg-card p-3 text-sm">
          <div className="font-medium text-foreground">{flash.kind === "pass" ? "Pass" : flash.kind === "force" ? "Force a standout" : "Settings"} · {when(flash.at)}</div>
          <div className="mt-1 text-muted-foreground">
            {Object.entries(flash.body)
              .filter(([, v]) => v !== null && v !== "")
              .map(([k, v]) => `${k}: ${String(v)}`)
              .join(" · ")}
          </div>
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <Link href={`/admin/standout?dry=1${memberEmail ? `&member=${encodeURIComponent(memberEmail)}` : ""}`} className="rounded-md border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-muted">
          Dry run
        </Link>
        <form action={runStandoutPassAction}>
          <button className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">Run a pass now</button>
        </form>
        <form method="get" className="flex items-end gap-2">
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground">Member email</span>
            <input name="member" defaultValue={memberEmail ?? ""} className="w-64 rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
          </label>
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" name="all" value="1" defaultChecked={all} /> every decision
          </label>
          <button className="rounded-md border border-border px-3 py-1.5 text-sm">Show</button>
        </form>
      </div>

      {dryRun && (
        <section className="mb-8 rounded-xl border border-border bg-card p-4">
          <h2 className="text-base font-semibold text-foreground">Dry run · nothing written, saved, rung or sent</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {dryRun.deals} new deals · {dryRun.members} members · {dryRun.judged} judged · {dryRun.standouts} would be saved · {dryRun.waiting} waiting on a live check
            {Object.keys(dryRun.memberSkips).length > 0 && ` · skipped: ${Object.entries(dryRun.memberSkips).map(([k, n]) => `${reasonLabel(k)} ×${n}`).join(", ")}`}
          </p>
          {dryRun.errors.length > 0 && <p className="mt-1 text-sm text-red-700">{dryRun.errors.join("; ")}</p>}
          <DryTable rows={dryRun.decisions} />
          {dryRun.notifications && dryRun.notifications.results.length > 0 && (
            <p className="mt-3 text-sm text-muted-foreground">Would tell: {dryRun.notifications.results.map((r) => `${r.outcome}`).join(", ")}</p>
          )}
          {dryRun.nudges && dryRun.nudges.results.length > 0 && <p className="mt-1 text-sm text-muted-foreground">Nudges: {dryRun.nudges.results.map((r) => r.outcome).join(", ")}</p>}
        </section>
      )}

      <section className="mb-8">
        <h2 className="mb-2 text-base font-semibold text-foreground">{all || memberId ? "Every decision" : "Standouts and waiting"}{memberEmail ? ` · ${memberEmail}` : ""}</h2>
        {memberEmail && !memberId && <p className="text-sm text-muted-foreground">No member with that email.</p>}
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Member</th>
                <th className="px-3 py-2">Deal</th>
                <th className="px-3 py-2">Deal type</th>
                <th className="px-3 py-2 text-right">Match</th>
                <th className="px-3 py-2 text-right">Profit vs minimum</th>
                <th className="px-3 py-2">Saved</th>
                <th className="px-3 py-2">Call</th>
                <th className="px-3 py-2">What they did</th>
                <th className="px-3 py-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {(decisions ?? []).map((d) => (
                <tr key={d.id} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <Link href={`/admin/standout?member=${encodeURIComponent(d.email ?? "")}`} className="hover:underline">{d.email ?? d.userId.slice(0, 8)}</Link>
                    <div className="text-xs text-muted-foreground">{d.tier}{d.forced ? " · forced" : ""}</div>
                  </td>
                  <td className="px-3 py-2">{d.dealId ? <Link href={`/deals/${d.dealId}`} className="hover:underline">{d.dealLabel ?? d.dealId.slice(0, 8)}</Link> : <span className="text-muted-foreground">member</span>}</td>
                  <td className="px-3 py-2">{d.dealTypeLabel ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{d.matchPct === null ? "—" : `${d.matchPct}%`}{d.checked !== null && <div className="text-xs text-muted-foreground">{d.checked} checked{d.revealPct !== null ? ` · reveal ${d.revealPct}%` : ""}</div>}</td>
                  <td className="px-3 py-2 text-right">{pounds(d.profitLow)} / {pounds(d.minProfit)}<div className="text-xs text-muted-foreground">{d.profitBasis ? BASIS[d.profitBasis] ?? d.profitBasis : ""}</div></td>
                  <td className="px-3 py-2">{when(d.savedAt)}</td>
                  <td className="px-3 py-2">{d.notify === "email" && !d.callStatus ? "Saved for you (email)" : callStatusLabel(d.callStatus)}</td>
                  <td className="px-3 py-2"><Outcome d={d} /></td>
                  <td className="px-3 py-2">{reasonLabel(d.reason)}</td>
                </tr>
              ))}
              {(decisions ?? []).length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">No decisions yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8 grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-base font-semibold text-foreground">Force a standout (test)</h2>
          <p className="mt-1 text-sm text-muted-foreground">Saves one live deal for one member as a standout, skipping only the thresholds. The member&rsquo;s primary profile and its deal types, the free delay, &ldquo;new to them&rdquo;, the live check and every call rule still apply.</p>
          <form action={forceStandoutAction} className="mt-3 flex flex-wrap items-end gap-2">
            <input name="email" placeholder="member@example.com" className="w-56 rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
            <input name="deal" placeholder="deal id (uuid)" className="w-72 rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
            <button className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">Force</button>
          </form>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-base font-semibold text-foreground">Last passes</h2>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {(runs ?? []).map((r) => (
              <li key={r.startedAt}>
                {when(r.startedAt)} · {r.kind} · {String(r.summary.deals ?? 0)} deals · {String(r.summary.saved ?? 0)} saved · {String(r.summary.waiting ?? 0)} waiting
              </li>
            ))}
            {(runs ?? []).length === 0 && <li>None yet.</li>}
          </ul>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-base font-semibold text-foreground">Settings</h2>
        <form action={updateStandoutSettingsAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SETTING_FIELDS.map((f) => (
            <label key={f.key} className="text-sm">
              <span className="block text-xs text-muted-foreground">{f.label} <code className="text-[10px]">{STANDOUT_KEYS[f.key]}</code></span>
              <input name={f.key} type="number" defaultValue={s[f.key]} className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
            </label>
          ))}
          <div className="sm:col-span-2 lg:col-span-3">
            <button className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">Save settings</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function DryTable({ rows }: { rows: DecisionView[] }) {
  if (rows.length === 0) return <p className="mt-3 text-sm text-muted-foreground">Nothing to judge this pass.</p>;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="py-1 pr-3">Member</th>
            <th className="py-1 pr-3">Deal</th>
            <th className="py-1 pr-3">Type</th>
            <th className="py-1 pr-3 text-right">Match</th>
            <th className="py-1 pr-3 text-right">Profit / minimum</th>
            <th className="py-1 pr-3">Outcome</th>
            <th className="py-1">Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 500).map((d, i) => (
            <tr key={`${d.userId}:${d.dealId}:${i}`} className="border-t border-border">
              <td className="py-1 pr-3">{d.email ?? d.userId.slice(0, 8)}</td>
              <td className="py-1 pr-3">{d.dealId ? <Link href={`/deals/${d.dealId}`} className="hover:underline">{d.dealId.slice(0, 8)}</Link> : "member"}</td>
              <td className="py-1 pr-3">{d.dealType ?? "—"}</td>
              <td className="py-1 pr-3 text-right">{d.matchPct === null ? "—" : `${d.matchPct}%`}</td>
              <td className="py-1 pr-3 text-right">{pounds(d.profitLow)} / {pounds(d.minProfit)}</td>
              <td className="py-1 pr-3">{d.outcome}{d.saved ? ` · ${d.saved}` : ""}</td>
              <td className="py-1">{d.reasonText}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
