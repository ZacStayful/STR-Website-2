import type { Metadata } from "next";
import Link from "next/link";

/**
 * The presentation deck opens in a new tab from a member's own report
 * (Stayful-branded: a funnel's report never offers it). It renders the
 * analysis handed over in localStorage, or a seeded demo (?demo=), so there
 * is nothing here for a search engine, and the one way back is the tab the
 * report is still open in.
 */
export const metadata: Metadata = {
  title: "Presentation view — Stayful Intelligence",
  robots: { index: false, follow: false },
};

export default function PresentationLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <p style={{ margin: 0, padding: "6px 16px", fontSize: 12, textAlign: "center", color: "#7a8274", background: "#f7f8f4", borderBottom: "1px solid #e4e7dc" }}>
        Opened from your report, which is still in the other tab.{" "}
        <Link href="/estimate" style={{ color: "#2e3d2b", fontWeight: 600 }}>
          Back to the analyser
        </Link>
      </p>
      {children}
    </>
  );
}
