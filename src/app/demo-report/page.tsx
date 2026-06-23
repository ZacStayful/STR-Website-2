import type { Metadata } from "next";
import EstimatePage from "@/app/estimate/page";
import { DEMO_MAP } from "@/lib/demo-data";

// ─── TEMPORARY public preview route ──────────────────────────────────────
// Renders the /estimate analyser UI with a seeded demo report injected as
// initial state, so the report (including the self-managed expense toggle and
// the matching PDF) renders immediately for anyone — no login, no live API
// calls, no redirect/URL-param dance. It sits OUTSIDE the /estimate route
// tree, so it skips the Supabase auth layout + middleware gate.
//
// Only ever shows hard-coded demo properties (DEMO_MAP) — no user data.
// noindex. Remove this folder when the design review is done.

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
  const result = (demo && DEMO_MAP[demo]) || DEMO_MAP.manchester;
  return <EstimatePage initialResult={result} />;
}
