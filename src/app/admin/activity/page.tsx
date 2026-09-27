import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin";
import { planName } from "@/lib/access";
import { ACTIVITY_WINDOW_DAYS, HIGH_INTENT_OPENS, HIGH_INTENT_REPORTS, aggregateActivity, defaultDir, isHighIntent, isSortKey, sortMembers, type MemberActivity, type SortDir, type SortKey } from "@/lib/admin/activity";
import { oneOf } from "../picks/responses/windows";

export const metadata: Metadata = { title: "High intent — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const LIMIT = 10000;

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
}

function gbp(pence: number): string {
  return pence === 0 ? "—" : `£${(pence / 100).toFixed(2)}`;
}

const COLUMNS: { key: SortKey; label: string; right?: boolean }[] = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "mobile", label: "Mobile" },
  { key: "plan", label: "Plan" },
  { key: "opens", label: "Deal opens", right: true },
  { key: "reports", label: "Reports", right: true },
  { key: "picks", label: "Picks", right: true },
  { key: "spent", label: "Credit spent", right: true },
  // Batch 7: deals at these stages right now.
  { key: "offer", label: "At Offer", right: true },
  { key: "secured", label: "At Secured", right: true },
  { key: "lastActive", label: "Last active" },
];

/**
 * Members ranked by what they did in the last 30 days, flagged at 10+ deal
 * opens or 5+ reports. Sortable by every column through the URL, in the
 * admin's usual server-rendered style. Admin only; nothing here notifies
 * anyone.
 */
export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/activity");
  if (!isAdminEmail(user.email)) notFound();

  const sortParam = oneOf(params.sort);
  const sort: SortKey = isSortKey(sortParam) ? sortParam : "activity";
  const dirParam = oneOf(params.dir);
  const dir: SortDir = dirParam === "asc" || dirParam === "desc" ? dirParam : sort === "activity" ? "desc" : defaultDir(sort);

  const now = new Date();
  const since = new Date(now.getTime() - ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const admin = createAdminClient();
  const [profiles, opens, reports, picks, debits, stages] = await Promise.all([
    admin.from("profiles").select("id, email, full_name, mobile, plan_code, last_seen_at").limit(LIMIT),
    admin.from("deal_opens").select("user_id, opened_at").eq("status", "open").or("verified_via.is.null,verified_via.neq.pick").gte("opened_at", since).limit(LIMIT),
    admin.from("saved_searches").select("user_id, created_at").gte("created_at", since).limit(LIMIT),
    admin.from("sourcing_sent").select("user_id, sent_at").eq("status", "sent").gte("sent_at", since).limit(LIMIT),
    admin.from("credit_transactions").select("user_id, amount_pence, at").eq("kind", "debit").gte("at", since).limit(LIMIT),
    // Batch 7: current stage, not windowed. Offer and Secured always have a pipeline row (Batch 5).
    admin.from("checked_listings").select("user_id, status").in("status", ["offer", "secured"]).limit(LIMIT),
  ]);
  const errors = [profiles.error, opens.error, reports.error, picks.error, debits.error, stages.error].filter((e): e is NonNullable<typeof e> => Boolean(e));
  for (const e of errors) console.error("[admin/activity] query failed:", e.message);

  const rows: MemberActivity[] = sortMembers(
    aggregateActivity({
      profiles: (profiles.data ?? []) as never,
      opens: (opens.data ?? []) as never,
      reports: (reports.data ?? []) as never,
      picks: (picks.data ?? []) as never,
      debits: (debits.data ?? []) as never,
      stages: (stages.data ?? []) as never,
    }),
    sort,
    dir,
  );
  const flagged = rows.filter(isHighIntent).length;
  const truncated = [profiles, opens, reports, picks, debits, stages].some((r) => (r.data?.length ?? 0) >= LIMIT);

  const href = (key: SortKey) => {
    const next: SortDir = key === sort ? (dir === "asc" ? "desc" : "asc") : key === "activity" ? "desc" : defaultDir(key);
    return `/admin/activity?sort=${key}&dir=${next}`;
  };
  const arrow = (key: SortKey) => (key === sort ? (dir === "asc" ? " ↑" : " ↓") : "");

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">High intent</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every member by what they did in the last {ACTIVITY_WINDOW_DAYS} days. {flagged} flagged: {HIGH_INTENT_OPENS}+ deal opens or {HIGH_INTENT_REPORTS}+ reports. Deal opens exclude the automatic open a daily pick makes; credit spent is the paying account&#8217;s, so a team owner&#8217;s figure includes their members. At Offer and At Secured count the member&#8217;s deals at that stage now, not in the window.
          </p>
        </div>
        <Link href="/admin" className="text-sm font-medium text-primary hover:underline">← Dashboard</Link>
      </div>

      {errors.length > 0 && <div className="mb-6 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">Some counts could not be read (schema behind?): {errors.map((e) => e.message).join("; ")}</div>}
      {truncated && <div className="mb-6 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">More than {LIMIT.toLocaleString("en-GB")} rows in one source; the counts below are a floor. Time to move this page onto a SQL view.</div>}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="p-3 font-medium">
                <Link href={href("activity")} className="hover:underline">#{arrow("activity")}</Link>
              </th>
              {COLUMNS.map((c) => (
                <th key={c.key} className={`p-3 font-medium ${c.right ? "text-right" : ""}`}>
                  <Link href={href(c.key)} className="hover:underline">{c.label}{arrow(c.key)}</Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="p-3 text-muted-foreground" colSpan={COLUMNS.length + 1}>No members yet.</td>
              </tr>
            ) : (
              rows.map((r, i) => {
                const hot = isHighIntent(r);
                return (
                  <tr key={r.id} className={`border-b border-border/60 last:border-0 ${hot ? "bg-primary/5" : ""}`}>
                    <td className="p-3 text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="p-3 text-foreground">
                      {r.name ?? "—"}
                      {hot && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">High intent</span>}
                    </td>
                    <td className="p-3 text-muted-foreground">{r.email ?? "—"}</td>
                    <td className="p-3 text-muted-foreground">{r.mobile ?? "—"}</td>
                    <td className="p-3">
                      <span className={r.planCode ? "font-medium text-primary" : "text-muted-foreground"}>{r.planCode ? planName(r.planCode) : "free"}</span>
                    </td>
                    <td className={`p-3 text-right tabular-nums ${r.dealOpens >= HIGH_INTENT_OPENS ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{r.dealOpens}</td>
                    <td className={`p-3 text-right tabular-nums ${r.reports >= HIGH_INTENT_REPORTS ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{r.reports}</td>
                    <td className="p-3 text-right tabular-nums text-muted-foreground">{r.picks}</td>
                    <td className="p-3 text-right tabular-nums text-muted-foreground">{gbp(r.creditSpentPence)}</td>
                    <td className={`p-3 text-right tabular-nums ${r.atOffer > 0 ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{r.atOffer}</td>
                    <td className={`p-3 text-right tabular-nums ${r.atSecured > 0 ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{r.atSecured}</td>
                    <td className="p-3 text-muted-foreground">{fmtDate(r.lastActiveAt)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
