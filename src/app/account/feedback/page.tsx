import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity/log";
import { isEmailedStatus } from "@/lib/feedback/config";
import { activityKey, kindLabel, statusLabel } from "@/lib/feedback/rules";
import { reportsFor, type MemberReport } from "@/lib/feedback/server";
import { FeedbackTrigger } from "@/components/feedback/FeedbackTrigger";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your feedback — Stayful Intelligence",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TONE: Record<MemberReport["status"], string> = {
  new: "bg-[#eef1e8] text-[#4b5a45]",
  planned: "bg-[#e6eef8] text-[#1e3a5f]",
  done: "bg-[#e3f1e5] text-[#1f5130]",
  not_doing: "bg-[#f1efe9] text-[#6b5f4a]",
};

function sentOn(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "";
}

/**
 * "Your feedback" (Batch 18; Account → More): every bug report and idea the
 * member has sent, newest first, where each has got to, and the one line we
 * sent with its status. Never admin's private note, the page it was sent
 * from, the device, or the screenshots themselves: only how many there were.
 * Status emails link here (?via=email&report=&status=): opening one is
 * recorded as feedback_email_click, for the member's own report only.
 */
export default async function YourFeedbackPage({ searchParams }: { searchParams: Promise<{ via?: string | string[]; report?: string | string[]; status?: string | string[] }> }) {
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/account/feedback");

  const { status, reports } = await reportsFor(user.id);

  const fromReport = first(params.report);
  const fromStatus = first(params.status);
  const highlight = fromReport && UUID.test(fromReport) ? fromReport.toLowerCase() : null;
  if (first(params.via) === "email" && highlight && isEmailedStatus(fromStatus) && reports.some((r) => r.id === highlight)) {
    logActivity(user.id, "feedback_email_click", { source: "email_link", dedupeKey: activityKey.emailClick(highlight, fromStatus) });
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl space-y-5 px-4 py-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          <Link href="/account" className="hover:underline">
            Your account
          </Link>
        </p>
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Your feedback</h1>
            <p className="mt-1 text-sm text-muted-foreground">What you’ve sent us, and where it’s got to.</p>
          </div>
          <FeedbackTrigger variant="button" />
        </header>

        {status !== "ok" ? (
          <p role="alert" className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
            Your feedback can’t be shown right now. Please try again shortly.
          </p>
        ) : reports.length === 0 ? (
          <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">Nothing sent yet. Use Feedback at the top of any page to tell us about a bug or an idea.</p>
        ) : (
          <ul className="space-y-3">
            {reports.map((r) => (
              <li key={r.id} id={`report-${r.ref}`} className={`scroll-mt-6 rounded-xl border bg-card p-5 ${r.id === highlight ? "border-primary ring-2 ring-primary/30" : "border-border"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {kindLabel(r.kind)} #{r.ref} · {sentOn(r.createdAt)}
                  </p>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[r.status]}`}>{statusLabel(r.kind, r.status, "member")}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground">{r.body}</p>
                {r.statusMessage && <p className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-sm text-foreground">A note from us: “{r.statusMessage}”</p>}
                {r.screenshotCount > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {r.screenshotCount} screenshot{r.screenshotCount === 1 ? "" : "s"} attached
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
