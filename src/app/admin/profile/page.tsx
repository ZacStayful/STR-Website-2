import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { loadProfileStats } from "@/lib/admin/profile-server";
import { pctLabel, type QuestionCount } from "@/lib/admin/profile";

export const metadata: Metadata = { title: "Profile quiz — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="text-3xl font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function CountTable({ rows, empty, what }: { rows: QuestionCount[]; empty: string; what: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const max = rows[0].count;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
          <th className="py-1 pr-3 font-medium">Question</th>
          <th className="py-1 pr-3 font-medium">{what}</th>
          <th className="py-1 font-medium"> </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.question} className="border-t border-border">
            <td className="py-1.5 pr-3 text-foreground">{r.label}</td>
            <td className="py-1.5 pr-3 tabular-nums text-foreground">{r.count}</td>
            <td className="py-1.5">
              <div className="h-2 w-full max-w-40 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((r.count / max) * 100)}%` }} />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Batch 12's admin page: how many members have started and completed the
 * profile quiz, how far the rest have got, the question where they most
 * often stop, and where "Not sure" is chosen most. The accounts Weekly
 * active leaves out (admins, staff, switched off) are left out here too.
 */
export default async function AdminProfilePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/profile");
  if (!isAdminEmail(user.email)) notFound();

  const load = await loadProfileStats();

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <div className="mb-8 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Profile quiz</h1>
          <p className="mt-1 text-sm text-muted-foreground">Who has completed their profile, how far the rest have got, and where they stop.</p>
        </div>
        <Link href="/admin" className="text-sm font-medium text-primary hover:underline">
          ← Admin
        </Link>
      </div>

      {load.status !== "ok" ? (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          {load.status === "schema_missing" ? "Not tracking yet: run the Batch 12 section of supabase/schema.sql." : load.status === "no_service_role" ? "SUPABASE_SERVICE_ROLE_KEY is not set." : `Couldn’t load the figures: ${load.message}`}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <Stat label="Completion rate" value={pctLabel(load.stats.completionRate)} sub={`${load.stats.completed} of ${load.stats.started} who started`} />
            <Stat label="Started" value={load.stats.started} sub={`${load.stats.notStarted} of ${load.stats.members} members not started`} />
            <Stat label="Completed" value={load.stats.completed} />
            <Stat label="Incomplete: typical progress" value={load.stats.medianPercent === null ? "—" : `${Math.round(load.stats.medianPercent)}%`} sub={load.stats.averagePercent === null ? undefined : `average ${Math.round(load.stats.averagePercent)}%`} />
          </div>
          {load.truncated && <p className="mt-3 text-xs text-muted-foreground">More than 5,000 rows: the figures cover the first 5,000.</p>}

          <h2 className="mt-10 mb-3 text-lg font-semibold text-foreground">Where members stop</h2>
          <p className="mb-3 text-sm text-muted-foreground">The last question each member with an unfinished profile was on. The top row is where the quiz most often loses people.</p>
          <div className="rounded-xl border border-border bg-card p-4">
            <CountTable rows={load.stats.dropOff.slice(0, 15)} empty="Nobody has stopped part-way yet." what="Members" />
          </div>

          <h2 className="mt-10 mb-3 text-lg font-semibold text-foreground">“Not sure” by question</h2>
          <p className="mb-3 text-sm text-muted-foreground">Questions members most often skip. A high count may mean the wording or the options need work.</p>
          <div className="rounded-xl border border-border bg-card p-4">
            <CountTable rows={load.stats.notSure.slice(0, 15)} empty="No “Not sure” answers yet." what="Answers" />
          </div>
        </>
      )}
    </div>
  );
}
