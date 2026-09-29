import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { loadProfileMetrics } from "@/lib/profiles/admin-server";
import { pct } from "@/lib/activity/metrics";
import { runDealTypesBackfill, type BackfillLine } from "@/lib/profile/deal-types-backfill-run";
import { runDealTypesBackfillAction } from "./actions";

export const metadata: Metadata = { title: "Saved profiles — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const WHY: Record<string, string> = {
  no_service_role: "The service role key isn’t set, so nothing can be read.",
  schema_missing: "The Batch 13 section of supabase/schema.sql hasn’t been run yet.",
  activity_missing: "Batch 9’s weekly-active figures can’t be read, so the split is missing.",
  failed: "The read failed.",
};

/**
 * Batch 13's admin page: how many saved profiles members keep, how many are
 * running, the share with two or more, and weekly active for members with
 * one profile against two or more. Counts only: no profile names (a client
 * profile's name can identify the client), no member list.
 */
export default async function AdminProfilesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/profiles");
  if (!isAdminEmail(user.email)) notFound();

  const params = await searchParams;
  const one = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]) ?? null;
  // Batch 17: the deal-types backfill's dry run is a read, made here when asked for.
  const dealTypesDry = one("dealTypes") === "dry" ? await runDealTypesBackfill({ dry: true, triggeredBy: user.email ?? "admin" }) : null;
  const { status, message, metrics } = await loadProfileMetrics();
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          <Link href="/admin" className="hover:underline">Admin</Link>
        </p>
        <header>
          <h1 className="text-2xl font-bold text-foreground">Saved profiles</h1>
          <p className="mt-1 text-sm text-muted-foreground">Counted members only (as on Weekly active: admin, staff and switched-off accounts left out). A member with no profile row yet counts as one profile.</p>
        </header>
        {!metrics ? (
          <p role="alert" className="rounded-lg border border-border bg-card p-4 text-sm text-foreground">
            {WHY[status] ?? "No figures."}
            {message ? <span className="mt-1 block text-xs text-muted-foreground">{message}</span> : null}
          </p>
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="text-3xl font-semibold text-foreground">{pct(metrics.twoPlus)}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  of members keep two or more profiles ({metrics.twoPlus.active} of {metrics.twoPlus.base})
                </div>
              </div>
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="text-3xl font-semibold text-foreground">{metrics.members}</div>
                <div className="mt-1 text-sm text-muted-foreground">counted members</div>
              </div>
            </section>

            <section className="grid gap-4 sm:grid-cols-2">
              <Distribution title="Profiles per member" rows={[1, 2, 3, 4, 5].map((n) => ({ label: n === 5 ? "5" : String(n), count: metrics.byCount[n] }))} total={metrics.members} />
              <Distribution title="Running profiles per member" note="Not paused or deleted: the ones charged each day." rows={[0, 1, 2, 3, 4, 5].map((n) => ({ label: String(n), count: metrics.byRunning[n] }))} total={metrics.members} />
            </section>

            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-base font-semibold text-foreground">Weekly active: one profile against two or more</h2>
              <p className="mt-1 text-xs text-muted-foreground">Each member is grouped by the profiles they held at the end of that week. Weeks run Monday to Sunday, UK time.</p>
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-1 pr-3 font-medium">Week</th>
                    <th className="py-1 pr-3 font-medium">1 profile</th>
                    <th className="py-1 font-medium">2 or more</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.weeks.map((w) => (
                    <tr key={w.week} className="border-t border-border">
                      <td className="py-1.5 pr-3 text-foreground">{w.label}</td>
                      <td className="py-1.5 pr-3 tabular-nums text-foreground">
                        {pct(w.one)} <span className="text-xs text-muted-foreground">({w.one.active} of {w.one.base})</span>
                      </td>
                      <td className="py-1.5 tabular-nums text-foreground">
                        {pct(w.many)} <span className="text-xs text-muted-foreground">({w.many.active} of {w.many.base})</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}

        <DealTypesBackfill dry={dealTypesDry} done={one("dealTypes")} written={one("written")} left={one("left")} already={one("already")} outOfTime={one("outOfTime") === "1"} />
      </div>
    </main>
  );
}

const typesText = (t: readonly string[] | null | undefined) => (t && t.length > 0 ? t.join(" + ") : "—");

/**
 * Batch 17: moving existing profiles onto "Which deals do you want to see?".
 * The dry run lists every profile's older answers and what they become (short
 * ids and option keys, no addresses or emails); Run writes them. A second run
 * changes nothing.
 */
function DealTypesBackfill({ dry, done, written, left, already, outOfTime }: { dry: { status: number; body: Record<string, unknown> } | null; done: string | null; written: string | null; left: string | null; already: string | null; outOfTime: boolean }) {
  const body = dry?.body as { toMap?: number; alreadyOnTypes?: number; nothingToGoOn?: number; noGoals?: number; profiles?: number; lines?: BackfillLine[]; error?: string } | undefined;
  return (
    <section id="deal-types" className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-semibold text-foreground">Deal types: move existing profiles (Batch 17)</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Maps each profile’s older answers to “Which deals do you want to see?”: investor → Buy and let, rent-to-rent → Rent-to-rent, Condition light refresh or full project → also BRRR (its budget a copy of the buy budget). Profiles with types already are left alone; profiles with nothing to go on meet the question on their next visit.
      </p>
      {done === "done" && (
        <p role="status" className="mt-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm text-foreground">
          Written: {written ?? "0"} · left for the next run: {left ?? "0"} · already on types: {already ?? "0"}{outOfTime ? " · ran out of time: press Run again" : ""}.
        </p>
      )}
      {done === "failed" && <p role="alert" className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">The run could not read the profiles. Nothing was written.</p>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link href="/admin/profiles?dealTypes=dry#deal-types" className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Dry run</Link>
        <form action={runDealTypesBackfillAction}>
          <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Run</button>
        </form>
      </div>
      {dry && dry.status !== 200 && <p role="alert" className="mt-3 text-sm text-destructive">{body?.error ?? "The dry run failed."}</p>}
      {dry && dry.status === 200 && body && (
        <div className="mt-4 overflow-x-auto">
          <p className="text-sm text-foreground">
            {body.profiles ?? 0} profiles: {body.toMap ?? 0} to move, {body.alreadyOnTypes ?? 0} already on types, {body.nothingToGoOn ?? 0} with nothing to go on, {body.noGoals ?? 0} with no answers.
          </p>
          <table className="mt-3 w-full text-xs">
            <thead>
              <tr className="text-left uppercase tracking-wide text-muted-foreground">
                <th className="py-1 pr-2 font-medium">Member</th>
                <th className="py-1 pr-2 font-medium">Profile</th>
                <th className="py-1 pr-2 font-medium">Before</th>
                <th className="py-1 font-medium">After</th>
              </tr>
            </thead>
            <tbody>
              {(body.lines ?? []).map((l) => (
                <tr key={`${l.member}-${l.profile ?? "own"}`} className="border-t border-border align-top">
                  <td className="py-1.5 pr-2 font-mono text-foreground">{l.member}</td>
                  <td className="py-1.5 pr-2 text-foreground">
                    {l.name ?? "(no profile rows)"} {l.profile && <span className="font-mono text-muted-foreground">{l.profile}</span>} {l.active && <span className="text-muted-foreground">· active</span>}
                  </td>
                  <td className="py-1.5 pr-2 text-muted-foreground">
                    roles {typesText(l.before.roles)} · main {l.before.mainRole ?? "—"} · exploring {l.before.exploringPick ?? "—"} · path {l.before.path ?? "—"} · kind {l.before.kind} · source for {l.before.sourceFor ?? "—"} · condition {l.before.condition ?? "—"} · budget {l.before.budget ?? "—"}
                  </td>
                  <td className="py-1.5 text-foreground">
                    {l.after ? (
                      <>
                        {typesText(l.after.types)} · BRRR budget {l.after.brrrBudget ?? "—"} · work {l.after.brrrWork ?? "—"} · r2r min {l.after.r2rMinProfit ?? "—"}
                      </>
                    ) : (
                      <span className="text-muted-foreground">{l.status === "already" ? "already on types" : l.status === "nothing" ? "nothing to go on: asked on next visit" : "no answers"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Distribution({ title, note, rows, total }: { title: string; note?: string; rows: { label: string; count: number }[]; total: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      <table className="mt-3 w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-border first:border-t-0">
              <td className="py-1.5 pr-3 text-foreground">{r.label}</td>
              <td className="py-1.5 pr-3 tabular-nums text-foreground">{r.count}</td>
              <td className="py-1.5 text-xs text-muted-foreground">{pct({ base: total, active: r.count })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
