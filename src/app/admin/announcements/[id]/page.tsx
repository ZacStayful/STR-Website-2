import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { announcementState, clickThrough } from "@/lib/feedback/announcements";
import { getAnnouncement } from "@/lib/feedback/announcements-server";
import { feedbackSettings } from "@/lib/feedback/settings-server";
import { AnnouncementEditor, type EditorInitial } from "../AnnouncementEditor";

export const metadata: Metadata = { title: "Announcement — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Writing, previewing and publishing one announcement (Batch 18). /admin/announcements/new starts a draft. */
export default async function AdminAnnouncementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { id } = await params;
  if (!user) redirect(`/login?redirect=${encodeURIComponent(`/admin/announcements/${id}`)}`);
  if (!isAdminEmail(user.email)) notFound();
  const { saved } = await searchParams;

  let initial: EditorInitial = { id: null, kind: "feature", title: "", body: "", link: "", refs: "", state: "draft" };
  let stats: { shown: number; dismissed: number; clicked: number } | null = null;
  if (id !== "new") {
    if (!UUID.test(id)) notFound();
    const [{ status, row }, settings] = await Promise.all([getAnnouncement(id.toLowerCase()), feedbackSettings()]);
    if (status === "schema_missing") {
      return (
        <main className="min-h-screen bg-background">
          <div className="mx-auto max-w-3xl px-4 py-8">
            <p role="alert" className="rounded-lg border border-border bg-card p-4 text-sm text-foreground">
              The Batch 18 section of supabase/schema.sql hasn’t been run yet.
            </p>
          </div>
        </main>
      );
    }
    if (!row) notFound();
    initial = {
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      link: row.linkPath ?? "",
      refs: row.reportRefs.map((r) => `#${r}`).join(", "),
      state: announcementState(row, new Date(), settings.announcementMaxAgeDays),
    };
    stats = { shown: row.shown, dismissed: row.dismissed, clicked: row.clicked };
  }
  const ctr = stats ? clickThrough(stats.shown, stats.clicked) : null;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          <Link href="/admin" className="hover:underline">
            Admin
          </Link>
          {" / "}
          <Link href="/admin/announcements" className="hover:underline">
            Announcements
          </Link>
        </p>
        <header>
          <h1 className="text-2xl font-bold text-foreground">{initial.id ? "Announcement" : "New announcement"}</h1>
          {stats && (
            <p className="mt-1 text-sm text-muted-foreground">
              {initial.state === "draft" ? "Not published yet." : `Shown to ${stats.shown} · dismissed by ${stats.dismissed} · ${stats.clicked} took a look${ctr === null ? "" : ` (${ctr}% click-through)`}.`}
            </p>
          )}
          {saved === "1" && <p className="mt-2 text-sm text-foreground">Saved as a draft. Check the preview, then publish.</p>}
        </header>
        <AnnouncementEditor initial={initial} />
      </div>
    </main>
  );
}
