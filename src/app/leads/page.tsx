import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listFunnels } from "@/lib/funnels";
import { funnelWalls } from "@/lib/funnels/alerts";
import { WallBanner, type WallNotice } from "./WallBanner";
import { saturationBand } from "@/lib/market/competition";
import { PushLeadButton } from "./PushLeadButton";

export const metadata: Metadata = {
  title: "Leads — Stayful Intelligence",
  robots: { index: false, follow: false },
};

// Qualified and Not qualified are separate views with their own counts, not
// one list behind a filter: a lead that missed the filter needs a different
// decision from one that passed, and the reason it missed is the point.
type Tab = "qualified" | "unqualified" | "queued";
const TABS: { key: Tab; label: string }[] = [
  { key: "qualified", label: "Qualified" },
  { key: "unqualified", label: "Not qualified" },
  { key: "queued", label: "Queued" },
];

interface LeadRow {
  id: string;
  name: string | null;
  email: string | null;
  address: string | null;
  postcode_area: string | null;
  bedrooms: number | null;
  qualified: boolean | null;
  qualification: { summary?: string; unknownChecks?: number } | null;
  status: string;
  created_at: string;
  result: { shortLet?: { annualRevenue?: number; comparables?: { reviewCount: number }[] } } | null;
}

function inTab(l: LeadRow, tab: Tab): boolean {
  if (tab === "queued") return l.status === "queued";
  if (l.status === "queued") return false;
  return tab === "qualified" ? l.qualified !== false : l.qualified === false;
}

const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: tabRaw } = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === tabRaw) ? (tabRaw as Tab) : "qualified";

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // RLS scopes this to the member's own leads; the filter is belt and braces.
  const [{ data }, funnels] = await Promise.all([
    supabase
      .from("leads")
      .select("id, name, email, address, postcode_area, bedrooms, qualified, qualification, status, created_at, result")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200),
    listFunnels(user.id),
  ]);
  const leads = (data ?? []) as unknown as LeadRow[];
  const shown = leads.filter((l) => inTab(l, tab));

  // Only live funnels: a paused one is not turning anybody away or running out
  // of anything, and the app already shows it as paused.
  const notices: WallNotice[] = (
    await Promise.all(
      funnels
        .filter((f) => f.active)
        .map(async (f) =>
          (await funnelWalls(f)).map((w) => ({ ...w, funnelId: f.id, funnelName: f.name })),
        ),
    )
  ).flat();

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 pb-10 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Leads</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enquiries from your funnels. Your own analyser reports live separately, under{" "}
              <Link href="/reports" className="underline underline-offset-2">My reports</Link>.
            </p>
          </div>
          <Link
            href="/leads/funnels"
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            {funnels.length === 0 ? "Create a funnel" : "Manage funnels"}
          </Link>
        </div>

        <WallBanner notices={notices} showFunnelName={funnels.length > 1} />

        {funnels.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-sm font-medium text-foreground">No funnels yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              A funnel gives you a link to put behind your own enquiry form. Whoever fills it in gets a report
              under your branding, and the lead lands here.
            </p>
            <Link
              href="/leads/funnels"
              className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              Create your first funnel
            </Link>
          </div>
        ) : (
          <>
            <nav className="mb-4 flex gap-1 rounded-lg bg-muted p-1 text-sm" aria-label="Filter leads">
              {TABS.map((t) => (
                <Link
                  key={t.key}
                  href={t.key === "qualified" ? "/leads" : `/leads?tab=${t.key}`}
                  className={
                    "flex-1 rounded-md px-3 py-1.5 text-center font-medium " +
                    (tab === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
                  }
                  aria-current={tab === t.key ? "page" : undefined}
                >
                  {t.label} <span className="text-xs opacity-70">{leads.filter((l) => inTab(l, t.key)).length}</span>
                </Link>
              ))}
            </nav>

            {shown.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-10 text-center">
                <p className="text-sm font-medium text-foreground">
                  {leads.length === 0 ? "No leads yet" : `Nothing ${tab === "queued" ? "queued" : tab === "qualified" ? "qualified" : "here"}`}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {leads.length === 0
                    ? "Point your enquiry form at your funnel link and the first lead will appear here."
                    : tab === "queued"
                      ? "Leads land here only when your balance was too low to run the report. They run automatically once you top up."
                      : "Leads that fall outside your filter appear under Not qualified, with the reason."}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {shown.map((l) => (
                  <LeadRowItem key={l.id} lead={l} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function LeadRowItem({ lead }: { lead: LeadRow }) {
  const revenue = lead.result?.shortLet?.annualRevenue;
  const comps = lead.result?.shortLet?.comparables ?? [];
  const reviewed = comps.filter((c) => c.reviewCount > 0);
  const avgReviews = reviewed.length > 0 ? Math.round(reviewed.reduce((s, c) => s + c.reviewCount, 0) / reviewed.length) : null;
  const saturation = saturationBand(avgReviews);

  const facts = [
    lead.bedrooms !== null ? `${lead.bedrooms} bed` : null,
    lead.postcode_area,
    saturation ? `${saturation.headline} market` : null,
    when(lead.created_at),
  ].filter(Boolean);

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{lead.name || lead.email || "Unnamed enquiry"}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{lead.address ?? "No address recorded"}</p>
        <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          {facts.map((f, i) => (
            <span key={i}>{i > 0 ? "· " : ""}{f}</span>
          ))}
        </p>
        {lead.qualified === false && lead.qualification?.summary ? (
          <p className="mt-1 text-xs text-muted-foreground">{lead.qualification.summary}</p>
        ) : null}
        {lead.qualification?.unknownChecks ? (
          <p className="mt-1 text-xs text-warning">
            {lead.qualification.unknownChecks} rule{lead.qualification.unknownChecks === 1 ? "" : "s"} could not be checked.
          </p>
        ) : null}
      </div>
      <div className="flex flex-col items-end gap-1.5 text-right">
        <div>
          <p className="text-sm font-semibold text-foreground">{typeof revenue === "number" && revenue > 0 ? gbp(revenue) : "—"}</p>
          <p className="text-xs text-muted-foreground">projected gross</p>
        </div>
        {/* Only where it can do something: a queued lead has no report to
            send, and a qualified one went automatically. */}
        {lead.status !== "queued" && lead.result ? (
          <PushLeadButton leadId={lead.id} pushed={lead.status === "pushed"} />
        ) : null}
      </div>
    </li>
  );
}
