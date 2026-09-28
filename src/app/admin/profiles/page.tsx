import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { loadProfileMetrics } from "@/lib/profiles/admin-server";
import { pct } from "@/lib/activity/metrics";

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
export default async function AdminProfilesPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/profiles");
  if (!isAdminEmail(user.email)) notFound();

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
      </div>
    </main>
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
