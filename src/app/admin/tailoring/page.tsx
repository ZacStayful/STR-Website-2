import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { loadTailoringAdmin } from "@/lib/tailoring/admin-server";
import { pct, type AnalysisRow, type RateRow } from "@/lib/tailoring/admin-stats";

export const metadata: Metadata = { title: "Tailoring — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function RateTable({ title, rows }: { title: string; rows: RateRow[] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-1 pr-3 font-medium"> </th>
            <th className="py-1 pr-3 font-medium">Members</th>
            <th className="py-1 pr-3 font-medium">Shown</th>
            <th className="py-1 pr-3 font-medium">Kept</th>
            <th className="py-1 font-medium">Keep rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-border">
              <td className="py-1.5 pr-3 text-foreground">{r.label}</td>
              <td className="py-1.5 pr-3 tabular-nums">{r.members}</td>
              <td className="py-1.5 pr-3 tabular-nums">{r.shown}</td>
              <td className="py-1.5 pr-3 tabular-nums">{r.kept}</td>
              <td className="py-1.5 tabular-nums font-medium text-foreground">{pct(r.rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AnalysisTable({ rows }: { rows: AnalysisRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
          <th className="py-1 pr-3 font-medium">Holding them back</th>
          <th className="py-1 pr-3 font-medium">Members</th>
          <th className="py-1 pr-3 font-medium">Deals opened</th>
          <th className="py-1 pr-3 font-medium">With a Full analysis</th>
          <th className="py-1 font-medium">Share</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-t border-border">
            <td className="py-1.5 pr-3 text-foreground">{r.label}</td>
            <td className="py-1.5 pr-3 tabular-nums">{r.members}</td>
            <td className="py-1.5 pr-3 tabular-nums">{r.opened}</td>
            <td className="py-1.5 pr-3 tabular-nums">{r.analysed}</td>
            <td className="py-1.5 tabular-nums font-medium text-foreground">{pct(r.rate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Batch 14's admin page (Part G): whether tailoring is working. The keep
 * rate on Today's 5 by role, by how complete the profile is and by the
 * deals the member wants; open → Full analysis by what holds them back; and
 * how often each tailoring action happened. The accounts Weekly active
 * leaves out (admins, staff, switched off) are left out here too.
 */
export default async function AdminTailoringPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/tailoring");
  if (!isAdminEmail(user.email)) notFound();

  const load = await loadTailoringAdmin();

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <div className="mb-8 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Tailoring</h1>
          <p className="mt-1 text-sm text-muted-foreground">Whether members keep more of Today’s 5 as their profiles fill in, and what they do with the tailoring.</p>
        </div>
        <Link href="/admin" className="text-sm font-medium text-primary hover:underline">
          ← Admin
        </Link>
      </div>

      {load.status !== "ok" ? (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          {load.status === "no_service_role" ? "The service role key is not configured." : `Could not load the figures: ${load.message}`}
        </div>
      ) : (
        <div className="space-y-8">
          <p className="text-sm text-muted-foreground">
            The last {load.days} days · {load.members} members counted · keep rate {pct(load.keep.total.rate)} ({load.keep.total.kept} of {load.keep.total.shown} deals shown).
            {load.capped ? " More events than were read: the figures cover the most recent part only." : ""}
          </p>

          <section>
            <h2 className="mb-1 text-lg font-semibold text-foreground">Keep rate on Today’s 5</h2>
            <p className="mb-3 text-xs text-muted-foreground">Of the deals on a member’s Today (the stored list and the day’s pick), the share they kept the same day: on the grid, on Today, or with the email’s “Yes, more like this”.</p>
            <div className="grid gap-4 lg:grid-cols-2">
              <RateTable title="By main role" rows={load.keep.byRole} />
              <RateTable title="By how complete the profile is" rows={load.keep.byCompleteness} />
              <RateTable title="By deals wanted in 12 months" rows={load.keep.byDealsWanted} />
            </div>
          </section>

          <section>
            <h2 className="mb-1 text-lg font-semibold text-foreground">Open → Full analysis</h2>
            <p className="mb-3 text-xs text-muted-foreground">Of the deals members opened themselves, the share that then got a Full analysis (the same pairing as Weekly active), by what they said holds them back.</p>
            <div className="rounded-xl border border-border bg-card p-4">
              <AnalysisTable rows={load.analysis} />
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-foreground">Tailoring actions</h2>
            <div className="rounded-xl border border-border bg-card p-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-1 pr-3 font-medium">Action</th>
                    <th className="py-1 pr-3 font-medium">Times</th>
                    <th className="py-1 pr-3 font-medium">Members</th>
                    <th className="py-1 font-medium">By step or answer</th>
                  </tr>
                </thead>
                <tbody>
                  {load.actions.map((a) => (
                    <tr key={a.kind} className="border-t border-border">
                      <td className="py-1.5 pr-3 text-foreground">{a.label}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{a.total}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{a.members}</td>
                      <td className="py-1.5 text-muted-foreground">
                        {Object.entries(a.by)
                          .sort((x, y) => y[1] - x[1])
                          .map(([k, n]) => `${k} ${n}`)
                          .join(" · ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
