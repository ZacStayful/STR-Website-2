import type { Metadata } from "next";
import EstimatePage from "@/app/estimate/page";
import { DEMO_MAP } from "@/lib/demo-data";

// ─── The sample report ────────────────────────────────────────────────────
// Renders the /estimate analyser UI with a seeded demo report injected as
// initial state, so a complete report (the expense toggle, the matching PDF)
// renders for anyone — no login, no live API calls. It sits OUTSIDE the
// /estimate route tree, so it skips the members' layout and the proxy's gate.
//
// Public on purpose: it is the "see a sample report" link on every deal sheet
// (src/app/deals/[id]/page.tsx, SAMPLE_REPORT) and the public demo. Only ever
// shows hard-coded demo properties (DEMO_MAP) — no member data. noindex.

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
  // Open the "Customise expenses" panel on load so the new self-managed
  // management-fee toggle is immediately visible to reviewers.
  return <EstimatePage initialResult={result} initialExpensesExpanded />;
}
