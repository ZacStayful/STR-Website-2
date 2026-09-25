import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ownerIdOrNull } from "@/lib/leads/scope";
import { getFunnel } from "@/lib/funnels";
import { funnelWalls } from "@/lib/funnels/alerts";
import { WallBanner } from "../../WallBanner";
import { siteUrl } from "@/lib/url";
import { SATURATION_GUIDE } from "@/lib/market/competition";
import { FunnelSettings } from "./FunnelSettings";
import { CostEstimator } from "./CostEstimator";
import { funnelCost } from "@/lib/funnels/cost";
import { getUnitCostTable, getBillingSettings } from "@/lib/credit/unit-costs";

export const metadata: Metadata = {
  title: "Funnel settings — Stayful Intelligence",
  robots: { index: false, follow: false },
};

export default async function FunnelSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  // The account owner's to manage; a team member works the leads.
  if (!(await ownerIdOrNull(user))) redirect("/leads");

  const funnel = await getFunnel(user.id, id);
  if (!funnel) notFound();

  // Priced on the server with the SAME table, markup and spend rates the
  // analyse route charges a real lead with, so the quote and the charge
  // cannot disagree. The browser only multiplies by the lead count.
  const [table, settings, walls] = await Promise.all([
    getUnitCostTable(),
    getBillingSettings(),
    // A paused funnel is not hitting a limit or running dry; the page already
    // says it is paused, and the link section says what that means.
    funnel.active ? funnelWalls(funnel) : Promise.resolve([]),
  ]);
  const priceFor = (enhanced: boolean) =>
    funnelCost({
      leadsPerMonth: 0,
      enhanced,
      table,
      markup: settings.funnelMarkup,
      spendRates: settings.spendRates,
      topupPresetsPence: settings.topupPresetsPence,
    });

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 pb-10 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{funnel.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {funnel.active ? "Live — this link is accepting enquiries." : "Paused — the link returns a not-found page."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/leads?funnel=${funnel.id}`} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
              This funnel&apos;s leads →
            </Link>
            <Link href="/leads/funnels" className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
              ← Funnels
            </Link>
          </div>
        </div>

        <WallBanner notices={walls.map((w) => ({ ...w, funnelId: funnel.id, funnelName: funnel.name }))} />

        <FunnelSettings
          funnel={{
            id: funnel.id,
            name: funnel.name,
            brand: funnel.brand,
            leadRules: funnel.leadRules,
            reportDepth: funnel.reportDepth,
            unqualifiedPolicy: funnel.unqualifiedPolicy,
            dailyCap: funnel.dailyCap,
            dailySpendCapPence: funnel.dailySpendCapPence,
            active: funnel.active,
          }}
          publicUrl={siteUrl(`/f/${funnel.publicToken}`)}
          rotatedAt={funnel.rotatedAt}
          saturationGuide={SATURATION_GUIDE}
        />

        <CostEstimator
          perLead={{ standard: priceFor(false), enhanced: priceFor(true) }}
          reportDepth={funnel.reportDepth}
          presets={settings.topupPresetsPence}
        />
      </div>
    </main>
  );
}
