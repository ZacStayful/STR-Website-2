import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getFunnel } from "@/lib/funnels";
import { siteUrl } from "@/lib/url";
import { SATURATION_GUIDE } from "@/lib/market/competition";
import { FunnelSettings } from "./FunnelSettings";

export const metadata: Metadata = {
  title: "Funnel settings — Stayful Intelligence",
  robots: { index: false, follow: false },
};

export default async function FunnelSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const funnel = await getFunnel(user.id, id);
  if (!funnel) notFound();

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
          <Link href="/leads/funnels" className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
            ← Funnels
          </Link>
        </div>

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
      </div>
    </main>
  );
}
