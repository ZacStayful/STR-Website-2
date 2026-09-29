import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { announcementKindLabel, announcementState, clickThrough } from "@/lib/feedback/announcements";
import { listAnnouncements } from "@/lib/feedback/announcements-server";
import { feedbackSettings } from "@/lib/feedback/settings-server";
import { MaxAgeForm } from "./AnnouncementEditor";

export const metadata: Metadata = { title: "Announcements — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const WHY: Record<string, string> = {
  no_service_role: "The service role key isn’t set, so nothing can be read.",
  schema_missing: "The Batch 18 section of supabase/schema.sql hasn’t been run yet.",
  failed: "The read failed.",
};

const STATE_LABEL = { draft: "Draft", live: "Live", ended: "Ended (past its age)", unpublished: "Taken down" } as const;

function day(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "—";
}

/**
 * Batch 18: announcements. Each one is shown to members as a banner once it
 * is published (to members who joined before then, for as many days as set
 * below), until they dismiss it or tap "Take a look". The figures: members
 * shown it, dismissals, "Take a look" taps, and click-through.
 */
export default async function AdminAnnouncementsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/announcements");
  if (!isAdminEmail(user.email)) notFound();

  const [{ status, message, rows }, settings] = await Promise.all([listAnnouncements(), feedbackSettings()]);
  const now = new Date();

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
            <h1 className="text-2xl font-bold text-foreground">Announcements</h1>
            <p className="mt-1 text-sm text-muted-foreground">New features and fixes, shown to every member (free, paid and team) as one banner until they dismiss it.</p>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/admin/feedback" className="text-sm font-medium text-primary hover:underline">
              Feedback →
            </Link>
            <Link href="/admin/announcements/new" className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">
              New announcement
            </Link>
          </div>
        </header>

        {status !== "ok" ? (
          <p role="alert" className="rounded-lg border border-border bg-card p-4 text-sm text-foreground">
            {WHY[status] ?? "Nothing to show."}
            {message ? <span className="mt-1 block text-xs text-muted-foreground">{message}</span> : null}
          </p>
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">No announcements yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Announcement</th>
                  <th className="px-3 py-2 font-medium">State</th>
                  <th className="px-3 py-2 font-medium">Published</th>
                  <th className="px-3 py-2 text-right font-medium">Shown</th>
                  <th className="px-3 py-2 text-right font-medium">Dismissed</th>
                  <th className="px-3 py-2 text-right font-medium">Took a look</th>
                  <th className="px-3 py-2 text-right font-medium">Click-through</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const ctr = clickThrough(a.shown, a.clicked);
                  return (
                    <tr key={a.id} className="border-t border-border/60 align-top">
                      <td className="px-3 py-2">
                        <Link href={`/admin/announcements/${a.id}`} className="font-medium text-primary hover:underline">
                          {a.title}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {announcementKindLabel(a.kind)}
                          {a.linkPath ? ` · ${a.linkPath}` : ""}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">{STATE_LABEL[announcementState(a, now, settings.announcementMaxAgeDays)]}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{day(a.publishedAt)}</td>
                      <td className="px-3 py-2 text-right">{a.shown}</td>
                      <td className="px-3 py-2 text-right">{a.dismissed}</td>
                      <td className="px-3 py-2 text-right">{a.clicked}</td>
                      <td className="px-3 py-2 text-right">{ctr === null ? "—" : `${ctr}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold text-foreground">How long they show</h2>
          <MaxAgeForm days={settings.announcementMaxAgeDays} />
        </section>
      </div>
    </main>
  );
}
