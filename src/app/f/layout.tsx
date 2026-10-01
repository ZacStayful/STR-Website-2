import type { Metadata } from "next";

/**
 * Batch 21 (C26): the neutral frame for every funnel URL. A bad or retired
 * token falls to not-found.tsx under this layout, so it carries no Stayful
 * title and no Stayful icon; a live funnel's page overrides all of this with
 * the customer's own branding in its generateMetadata.
 */
export const metadata: Metadata = {
  title: "Property income analysis",
  description: "Find out what a property could earn as a short-term let.",
  robots: { index: false, follow: false },
  icons: { icon: "/icon-neutral.svg" },
};

export default function FunnelLayout({ children }: { children: React.ReactNode }) {
  return children;
}
