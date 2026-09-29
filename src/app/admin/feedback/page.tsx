import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { REPORT_STATUSES, isReportKind, isReportStatus, type ReportKind, type ReportStatus } from "@/lib/feedback/config";
import { kindLabel, statusLabel } from "@/lib/feedback/rules";
import { loadAdminOverview, type StatusFilter } from "@/lib/feedback/admin-server";
import { feedbackSettings } from "@/lib/feedback/settings-server";
import { SettingsForm } from "./Forms";

export const metadata: Metadata = { title: "Feedback — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const WHY: Record<string, string> = {
  no_service_role: "The service role key isn’t set, so nothing can be read.",
  schema_missing: "The Batch 18 section of supabase/schema.sql hasn’t been run yet.",
  failed: "The read failed.",
};

type Search = { kind?: string | string[]; status?: string | string[]; page?: string | string[] };

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }) : "—";
}

/**
 * Batch 18's admin page: every bug report and idea members have sent. Totals
 * by kind and status (a duplicate counts once, as its original), this week
 * against last, submissions per week, then the list, newest first, filtered
 * by kind and status in the address. Each report opens in full at
 * /admin/feedback/[id]. The settings are at the foot.
 */
export default async function AdminFeedbackPage({ searchParams }: { searchParams: Promise<Search> }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/feedback");
  if (!isAdminEmail(user.email)) notFound();

  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const kind: ReportKind | null = isReportKind(one(sp.kind)) ? (one(sp.kind) as ReportKind) : null;
  const rawStatus = one(sp.status);
  const status: StatusFilter = rawStatus === "duplicate" ? "duplicate" : isReportStatus(rawStatus) ? rawStatus : null;
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const [overview, settings] = await Promise.all([loadAdminOverview({ kind, status, page }), feedbackSettings()]);

  const qs = (over: { kind?: string | null; status?: string | null; page?: number | null }) => {
    const p = new URLSearchParams();
    const k = over.kind === undefined ? kind : over.kind;
    const s = over.status === undefined ? status : over.status;
    const n = over.page === undefined ? null : over.page;
    if (k) p.set("kind", k);
    if (s) p.set("status", s);
    if (n && n > 1) p.set("page", String(n));
    const q = p.toString();
    return q ? `/admin/feedback?${q}` : "/admin/feedback";
  };
  const chip = (href: string, label: string, on: boolean) => (
    <Link key={label} href={href} className={`rounded-full border px-3 py-1 text-xs font-medium ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted"}`}>
      {label}
    </Link>
  );
  const statusChip = (s: ReportStatus) => (kind ? statusLabel(kind, s) : s === "done" ? "Fixed / Built" : statusLabel("bug", s));

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          <Link href="/admin" className="hover:underline">
            Admin
          </Link>
        </p>
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Feedback</h1>
            <p className="mt-1 text-sm text-muted-foreground">Bug reports and ideas from members. Each one is emailed to {settings.adminEmail} as it arrives.</p>
          </div>
          <Link href="/admin/announcements" className="text-sm font-medium text-primary hover:underline">
            Announcements →
          </Link>
        </header>

        {overview.status !== "ok" || !overview.totals ? (
          <p role="alert" className="rounded-lg border border-border bg-card p-4 text-sm text-foreground">
            {WHY[overview.status] ?? "No figures."}
            {overview.message ? <span className="mt-1 block text-xs text-muted-foreground">{overview.message}</span> : null}
          </p>
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2">
              {(["bug", "feature"] as const).map((k) => {
                const t = overview.totals![k];
                return (
                  <div key={k} className="rounded-xl border border-border bg-card p-5">
                    <div className="flex items-baseline justify-between">
                      <h2 className="text-sm font-semibold text-foreground">{kindLabel(k, "long")}s</h2>
                      <span className="text-3xl font-semibold text-foreground">{t.total}</span>
                    </div>
                    <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
                      {REPORT_STATUSES.map((s) => (
                        <div key={s} className="rounded-lg bg-muted/40 px-1 py-2">
                          <dt className="text-[11px] text-muted-foreground">{statusLabel(k, s)}</dt>
                          <dd className="text-lg font-semibold text-foreground">{t.byStatus[s]}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className="mt-3 text-xs text-muted-foreground">
                      This week {t.thisWeek} · last week {t.lastWeek} · duplicates counted once
                    </p>
                  </div>
                );
              })}
            </section>

            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-sm font-semibold text-foreground">Submissions per week</h2>
              <p className="mt-1 text-xs text-muted-foreground">Every report sent, duplicates included (UK weeks, Monday to Sunday).</p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-4 font-medium">Week of</th>
                      <th className="py-1 pr-4 font-medium">Bugs</th>
                      <th className="py-1 pr-4 font-medium">Ideas</th>
                      <th className="py-1 font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...overview.weeks].reverse().map((w) => (
                      <tr key={w.week} className="border-t border-border/60">
                        <td className="py-1 pr-4">{w.label}</td>
                        <td className="py-1 pr-4">{w.bugs}</td>
                        <td className="py-1 pr-4">{w.ideas}</td>
                        <td className="py-1 font-medium">{w.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {chip(qs({ kind: null, page: null }), "All kinds", kind === null)}
                {chip(qs({ kind: "bug", page: null }), "Bugs", kind === "bug")}
                {chip(qs({ kind: "feature", page: null }), "Ideas", kind === "feature")}
              </div>
              <div className="flex flex-wrap gap-2">
                {chip(qs({ status: null, page: null }), "Any status", status === null)}
                {REPORT_STATUSES.map((s) => chip(qs({ status: s, page: null }), statusChip(s), status === s))}
                {chip(qs({ status: "duplicate", page: null }), "Duplicates", status === "duplicate")}
              </div>

              {overview.rows.length === 0 ? (
                <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">No reports{kind || status ? " match these filters" : " yet"}.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border bg-card">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">#</th>
                        <th className="px-3 py-2 font-medium">Sent</th>
                        <th className="px-3 py-2 font-medium">Kind</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium">What they said</th>
                        <th className="px-3 py-2 font-medium">Member</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.rows.map((r) => (
                        <tr key={r.id} className="border-t border-border/60 align-top">
                          <td className="px-3 py-2">
                            <Link href={`/admin/feedback/${r.id}`} className="font-medium text-primary hover:underline">
                              #{r.ref}
                            </Link>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{fmt(r.createdAt)}</td>
                          <td className="px-3 py-2">{kindLabel(r.kind)}</td>
                          <td className="whitespace-nowrap px-3 py-2">{r.duplicateOfRef ? `Duplicate of #${r.duplicateOfRef}` : statusLabel(r.kind, r.status)}</td>
                          <td className="px-3 py-2">
                            <Link href={`/admin/feedback/${r.id}`} className="text-foreground hover:underline">
                              {r.excerpt}
                            </Link>
                            {(r.screenshots > 0 || r.emailPending) && (
                              <span className="mt-1 block text-xs text-muted-foreground">
                                {r.screenshots > 0 ? `${r.screenshots} screenshot${r.screenshots === 1 ? "" : "s"}` : ""}
                                {r.screenshots > 0 && r.emailPending ? " · " : ""}
                                {r.emailPending ? "email to admin not sent yet" : ""}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            <span className="block text-foreground">{r.memberEmail ?? "—"}</span>
                            <span className="text-muted-foreground">{r.plan}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {overview.pages > 1 && (
                <div className="flex items-center justify-between text-sm">
                  {overview.page > 1 ? (
                    <Link href={qs({ page: overview.page - 1 })} className="text-primary hover:underline">
                      ← Newer
                    </Link>
                  ) : (
                    <span />
                  )}
                  <span className="text-muted-foreground">
                    Page {overview.page} of {overview.pages} · {overview.total} reports
                  </span>
                  {overview.page < overview.pages ? (
                    <Link href={qs({ page: overview.page + 1 })} className="text-primary hover:underline">
                      Older →
                    </Link>
                  ) : (
                    <span />
                  )}
                </div>
              )}
            </section>
          </>
        )}

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">Settings</h2>
          <p className="mt-1 mb-3 text-xs text-muted-foreground">Saved to billing_settings; every server picks a change up within a minute.</p>
          <SettingsForm settings={settings} />
        </section>
      </div>
    </main>
  );
}
