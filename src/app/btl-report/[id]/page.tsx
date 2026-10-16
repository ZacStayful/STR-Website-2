import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { btlReportFor } from "@/lib/btl/report-server";
import { readBtlSettingsCached } from "@/lib/btl/settings-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { btlFlags, btlNumbers } from "@/lib/btl/card";
import { btlSheet, CASH_BAND_LABELS } from "@/lib/btl/sheet";
import { BTL_PRIORITY_LABELS } from "@/lib/btl/rules";
import { BuyToLetSection } from "@/app/deals/_components/BuyToLetSection";

export const metadata: Metadata = {
  title: "Buy-to-let report — Stayful Intelligence",
  robots: { index: false, follow: false },
};

const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

/**
 * Batch 28, Part G: a £2 buy-to-let report, as its member (or their team)
 * bought it: the summary, the figures with the rent valuation and the EPC
 * folded in, the sale valuation, sold prices nearby and the flood and
 * planning checks. Web only (decided). Never an address, a full postcode or
 * a link: the outcode only.
 */
export default async function BtlReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=${encodeURIComponent(`/btl-report/${id}`)}`);
  const found = await btlReportFor(user.id, id);
  if (!found) notFound();
  const { report: r, createdAt, dealId } = found;
  const { settings } = await readBtlSettingsCached(createAdminClient());
  const sheet = btlSheet(r.card, { priority: r.priority, benchmark: r.benchmark, regionName: r.regionName, settings });
  const made = new Date(createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <p className="mb-3 text-xs">
          <Link href={dealId ? `/deals/${dealId}` : "/my-deals"} className="text-muted-foreground hover:underline">← {dealId ? "The deal" : "My deals"}</Link>
        </p>
        <h1 className="text-2xl font-bold text-foreground">Buy-to-let report: {r.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Asking {gbp(r.price)} · judged for “{BTL_PRIORITY_LABELS[r.priority]}”{r.band ? ` with ${CASH_BAND_LABELS[r.band]} cash in` : ""} · made {made}
        </p>

        <section className="mt-5 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">In short</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-foreground">
            {r.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        <BuyToLetSection numbers={btlNumbers(r.card, r.priority)} flags={btlFlags(r.card)} sheet={sheet} pending={false} />

        <section className="mt-4 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">Valuations and sold prices</h2>
          <dl className="mt-2 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dd className="font-bold text-foreground">{r.rentValuation ? `${gbp(r.rentValuation)} a month` : "Not available"}</dd>
              <dt className="text-xs text-muted-foreground">Rent valuation (PropertyData)</dt>
            </div>
            <div>
              <dd className="font-bold text-foreground">{r.saleValuation ? `${gbp(r.saleValuation.low)}–${gbp(r.saleValuation.high)}` : "Not available"}</dd>
              <dt className="text-xs text-muted-foreground">Sale valuation (PropertyData){r.saleValuation?.confidence ? `, ${r.saleValuation.confidence} confidence` : ""}</dt>
            </div>
            <div>
              <dd className="font-bold text-foreground">{r.sold ? `${gbp(r.sold.low)}–${gbp(r.sold.high)}` : "None found"}</dd>
              <dt className="text-xs text-muted-foreground">{r.sold ? `The middle half of ${r.sold.count} sales nearby, last ${r.sold.months} months (median ${gbp(r.sold.median)})` : "Sold prices nearby"}</dt>
            </div>
          </dl>
        </section>

        {r.checks.length > 0 && (
          <section className="mt-4 rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">Checks</h2>
            <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
              {r.checks.map((c) => (
                <div key={c.label} className="flex justify-between gap-2 border-b border-border/60 py-1 last:border-0">
                  <dt className="text-muted-foreground">{c.label}</dt>
                  <dd className={"font-medium " + (c.tone === "warn" ? "text-warning" : "text-foreground")}>{c.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <p className="mt-6 text-xs text-muted-foreground">{sheet.disclaimer}</p>
      </div>
    </main>
  );
}
