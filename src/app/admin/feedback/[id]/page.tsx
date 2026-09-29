import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { kindLabel, memberPath, planLine, screenLine, statusLabel, versionLine, type ReportContext } from "@/lib/feedback/rules";
import { loadAdminReport } from "@/lib/feedback/admin-server";
import { DuplicateForm, NoteForm, StatusForm } from "../Forms";

export const metadata: Metadata = { title: "Feedback report — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
// Saving a status emails its reporters from here (a batch that stops after
// 45 seconds and asks to be pressed again), so allow the full minute.
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "—";
}

const STATE: Record<string, string> = { sent: "sent", failed: "failed", skipped: "skipped (no email address)", claimed: "sending…" };

/**
 * One report in full (Batch 18): what the member wrote, the screenshots
 * (links that stop working after five minutes; the images are never public),
 * what the form captured, who sent it, and everything admin can do: the
 * status (with the status emails and their preview), a private note, and
 * marking it a duplicate.
 */
export default async function AdminFeedbackReportPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { id } = await params;
  if (!user) redirect(`/login?redirect=${encodeURIComponent(`/admin/feedback/${id}`)}`);
  if (!isAdminEmail(user.email)) notFound();
  if (!UUID.test(id)) notFound();

  const { status, report: r } = await loadAdminReport(id.toLowerCase());
  if (status === "schema_missing" || status === "no_service_role" || status === "failed") {
    return (
      <main className="min-h-screen bg-background">
        <div className="mx-auto max-w-3xl px-4 py-8">
          <p role="alert" className="rounded-lg border border-border bg-card p-4 text-sm text-foreground">
            {status === "schema_missing" ? "The Batch 18 section of supabase/schema.sql hasn’t been run yet." : "This report can’t be read right now."}
          </p>
        </div>
      </main>
    );
  }
  if (!r) notFound();

  const ctx = r.context as Partial<ReportContext>;
  const page = typeof ctx.page === "string" ? ctx.page : null;
  const pageLink = page ? memberPath(page) : null;
  const rows: [string, React.ReactNode][] = [
    ["Sent", when(r.createdAt)],
    [
      "Page",
      page ? (
        pageLink ? (
          <Link href={pageLink} prefetch={false} className="break-all text-primary hover:underline">
            {page}
          </Link>
        ) : (
          <span className="break-all">{page}</span>
        )
      ) : (
        "Not captured"
      ),
    ],
    ["Device", ctx.device ?? "Unknown"],
    ["Screen", screenLine(ctx as ReportContext) ?? "Not captured"],
    ["Time zone", ctx.timeZone ?? "—"],
    ["Language", ctx.language ?? "—"],
    ["App version", versionLine(ctx as ReportContext) ?? "unknown"],
    ["Browser", <span key="ua" className="break-all text-xs text-muted-foreground">{ctx.userAgent ?? "—"}</span>],
    ["Email to admin", r.adminEmailedAt ? `sent ${when(r.adminEmailedAt)}` : "not sent yet (the daily run retries it)"],
  ];
  const hasFailed = r.statusEmails.some((e) => e.state === "failed" || e.state === "claimed");

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          <Link href="/admin" className="hover:underline">
            Admin
          </Link>
          {" / "}
          <Link href="/admin/feedback" className="hover:underline">
            Feedback
          </Link>
        </p>
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-bold text-foreground">
            {kindLabel(r.kind, "long")} #{r.ref}
          </h1>
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-foreground">{r.duplicateOf ? `Duplicate of #${r.duplicateOf.ref}` : statusLabel(r.kind, r.status)}</span>
        </header>

        <section className="rounded-xl border border-border bg-card p-5">
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{r.body}</p>
          <p className="mt-4 text-xs text-muted-foreground">
            From <span className="text-foreground">{r.member.name ? `${r.member.name} · ` : ""}</span>
            {r.member.email ? (
              <a href={`mailto:${r.member.email}`} className="text-primary hover:underline">
                {r.member.email}
              </a>
            ) : (
              "no email"
            )}
            {" · "}
            {planLine(ctx.plan ? (ctx as ReportContext) : null)}
            {r.profileName ? ` · active profile “${r.profileName}”` : ""}
          </p>
        </section>

        {r.screenshots.length > 0 && (
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Screenshots</h2>
            <p className="mt-1 text-xs text-muted-foreground">These links stop working after five minutes; reload the page for fresh ones.</p>
            <div className="mt-3 flex flex-wrap gap-3">
              {r.screenshots.map((s, i) =>
                s.url ? (
                  <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a private image behind a signed link: never through the image optimiser, which would cache it publicly */}
                    <img src={s.url} referrerPolicy="no-referrer" alt={`Screenshot ${i + 1}`} className="h-44 max-w-[16rem] rounded-lg border border-border bg-background object-contain" />
                  </a>
                ) : (
                  <p key={s.id} className="flex h-44 w-40 items-center justify-center rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                    {s.deletedAt ? `Deleted ${when(s.deletedAt)} (kept for the retention period only)` : "Couldn’t load this one"}
                  </p>
                ),
              )}
            </div>
          </section>
        )}

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">What the form captured</h2>
          <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1.5 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="min-w-0 text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">Status</h2>
          {r.duplicateOf ? (
            <p className="text-sm text-muted-foreground">
              A duplicate of{" "}
              <Link href={`/admin/feedback/${r.duplicateOf.id}`} className="text-primary hover:underline">
                #{r.duplicateOf.ref}
              </Link>
              : it follows that report’s status, and its reporter is emailed when that one changes.
            </p>
          ) : null}
          <StatusForm id={r.id} kind={r.kind} status={r.status} message={r.statusMessage} locked={Boolean(r.duplicateOf)} hasFailed={hasFailed} />
          {r.statusEmails.length > 0 && (
            <div>
              <h3 className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status emails</h3>
              <ul className="mt-1 space-y-0.5 text-sm">
                {r.statusEmails.map((e, i) => (
                  <li key={`${e.reportRef}-${e.status}-${i}`}>
                    #{e.reportRef} · {e.email ?? "no email"} · {statusLabel(r.kind, e.status)} — {STATE[e.state] ?? e.state}
                    {e.sentAt ? `, ${when(e.sentAt)}` : ""}
                    {e.error && e.state === "failed" ? ` (${e.error})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">Duplicates</h2>
          <DuplicateForm id={r.id} duplicateOfRef={r.duplicateOf?.ref ?? null} />
          {r.duplicates.length > 0 && (
            <ul className="space-y-0.5 text-sm">
              {r.duplicates.map((d) => (
                <li key={d.id}>
                  <Link href={`/admin/feedback/${d.id}`} className="text-primary hover:underline">
                    #{d.ref}
                  </Link>{" "}
                  · {d.email ?? "no email"} · {when(d.createdAt)}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">Private note</h2>
          <NoteForm id={r.id} note={r.adminNote} />
        </section>

        {r.announcements.length > 0 && (
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Announced in</h2>
            <ul className="mt-2 space-y-0.5 text-sm">
              {r.announcements.map((a) => (
                <li key={a.id}>
                  <Link href={`/admin/announcements/${a.id}`} className="text-primary hover:underline">
                    {a.title}
                  </Link>{" "}
                  · {a.publishedAt ? `published ${when(a.publishedAt)}` : "draft"}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
