import { redirect } from "next/navigation";

/**
 * The saved reports list moved to My deals' Reports tab. A search carries
 * over. Report pages (/reports/[id]) stay where they are: emails and PDFs
 * link to them.
 */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { q } = await searchParams;
  const term = (Array.isArray(q) ? q[0] : q)?.trim();
  redirect(term ? `/my-deals?tab=reports&q=${encodeURIComponent(term)}` : "/my-deals?tab=reports");
}
