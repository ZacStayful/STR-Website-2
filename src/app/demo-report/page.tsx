import { redirect } from "next/navigation";
import type { Metadata } from "next";
import EstimatePage from "@/app/estimate/page";

// ─── TEMPORARY public preview route ──────────────────────────────────────
// Renders the /estimate analyser UI with seeded demo data so the report
// (including the new self-managed expense toggle and PDF download) can be
// reviewed without logging in. This deliberately sits OUTSIDE the /estimate
// route tree, so it skips the Supabase auth layout + middleware gate.
//
// It only ever shows hard-coded demo properties (DEMO_MAP) — no live API
// calls, no user data. Remove this folder when the design review is done.
// noindex so it never shows up in search.

export const metadata: Metadata = {
  title: "Demo report (preview) — Stayful Intelligence",
  robots: { index: false, follow: false },
};

export default async function DemoReportPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const { demo } = await searchParams;
  // Default the bare URL straight to a seeded report so the link lands on the
  // analyser rather than the empty property-input form.
  if (!demo) redirect("/demo-report?demo=manchester");
  return <EstimatePage />;
}
