import type { Metadata } from "next";

/**
 * Batch 21 (C26): the neutral frame for every prospect report URL, so a
 * purged or unknown report link shows nothing of Stayful's; the report page
 * overrides this with the customer's branding.
 */
export const metadata: Metadata = {
  title: "Your property report",
  description: "Your short-term let income analysis.",
  robots: { index: false, follow: false },
  icons: { icon: "/icon-neutral.svg" },
};

export default function ReportLayout({ children }: { children: React.ReactNode }) {
  return children;
}
