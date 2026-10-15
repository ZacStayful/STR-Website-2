import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { loadWeeklyActive } from "@/lib/activity/admin-server";
import { WeeklyActiveView } from "./WeeklyActiveView";

export const metadata: Metadata = { title: "Weekly active — Stayful Intelligence", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Batch 9's admin page: weekly active by billing group against its targets,
 * how members use the app, the per-member drill-down with the "Exclude from
 * metrics" switch, the backfill and the retention count
 * (src/lib/activity; the figures are worked out in metrics.ts).
 */
export default async function WeeklyActivePage({ searchParams }: { searchParams: Promise<{ msg?: string; all?: string }> }) {
  const { msg, all } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/admin/weekly-active");
  if (!isAdminEmail(user.email)) notFound();

  const { status, message, report } = await loadWeeklyActive({ weeks: 12 });
  return <WeeklyActiveView status={status} message={message} report={report} msg={msg ?? null} showAll={all === "1"} />;
}
