import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sharedListingByToken } from "@/lib/listing/share";
import { SOURCE_LABELS } from "@/lib/listing/detect";
import { PIPELINE_STATUSES } from "@/lib/listing/pipeline";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Deal sheet — Stayful Intelligence",
  robots: { index: false, follow: false },
};

function gbp(n: number): string {
  return `£${Math.round(n).toLocaleString("en-GB")}`;
}

/**
 * Public, read-only deal sheet for a shared listing. Figures and deal maths
 * only: no member details, notes or report links. 404 for unknown or
 * revoked tokens.
 */
export default async function DealSheetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const l = await sharedListingByToken(token);
  if (!l) notFound();
  const est = l.quick?.estimate ?? null;
  const area = l.quick?.area ?? null;
  const d = l.deal;
  const status = PIPELINE_STATUSES.find((s) => s.key === l.status);
  const price = l.price ? `${gbp(l.price.amount)}${l.price.period === "pcm" ? " pcm" : l.price.period === "night" ? " / night" : ""}` : null;

  return (
    <main className="min-h-screen bg-[#f7f8f4] text-[#2e3d2b]">
      <div className="mx-auto max-w-3xl px-5 py-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#5d8156]">Stayful deal sheet</p>
        <h1 className="mt-1 text-2xl font-bold">{l.title}</h1>
        <p className="mt-1 text-sm text-[#7a8274]">
          {l.displayAddress ?? l.postcode ?? ""}{l.bedrooms !== null ? ` · ${l.bedrooms} bed` : ""}{price ? ` · ${price}` : ""} ·{" "}
          <a href={l.canonicalUrl} target="_blank" rel="noopener noreferrer" className="underline">View on {SOURCE_LABELS[l.source]}</a>
        </p>
        {status && status.key !== "watching" && <p className="mt-1 text-xs text-[#7a8274]">Pipeline status: {status.label}</p>}

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Est. revenue / yr" value={est ? gbp(est.grossRevenue) : "—"} sub={est?.adr ? `${gbp(est.adr)} / night${est.occupancy !== null ? ` · ${Math.round(est.occupancy)}% occ.` : ""}` : undefined} />
          <Tile label="Area score" value={area?.score !== null && area?.score !== undefined ? `${area.score} · ${area.grade}` : "—"} sub={area ? `${area.name}${area.competition ? ` · ${area.competition.label} competition` : ""}` : undefined} />
          {l.quick?.tracked ? (
            <Tile label="This listing earns" value={gbp(l.quick.tracked.annualRevenue)} sub={`${gbp(l.quick.tracked.adr)} / night · ${Math.round(l.quick.tracked.occupancy * 100)}% · ${l.quick.tracked.reviewCount} reviews`} />
          ) : (
            <Tile label="Trend" value={area?.trend?.label ?? "—"} sub={area?.directBooking ? `${area.directBooking.label} direct-booking potential` : undefined} />
          )}
          <Tile label="Licensing" value={area?.licensing.status === "confirmed-licensed" ? "Licence required" : area?.licensing.status === "confirmed-unrestricted" ? "No licence today" : "Unconfirmed"} sub={area?.licensing.headline} />
        </div>

        {d && (
          <section className="mt-8 rounded-2xl border border-[#e4e7dc] bg-white p-5">
            <h2 className="text-lg font-bold">{d.kind === "purchase" ? "If you bought it" : "If you rented it (rent-to-rent)"}</h2>
            <p className="text-sm text-[#7a8274]">{d.kind === "purchase" ? `On a purchase price of ${gbp(d.askingPrice)} and estimated gross revenue of ${gbp(d.grossRevenue)}.` : `On rent of ${gbp(d.advertisedRentPcm)} pcm and estimated gross revenue of ${gbp(d.grossRevenue)}.`}</p>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {d.kind === "purchase" ? (
                <>
                  <Tile label="Gross yield" value={`${d.grossYieldPct}%`} />
                  <Tile label="Net yield" value={`${d.netYieldPct}%`} sub="after running costs" />
                  <Tile label="Monthly cashflow" value={`${d.cashflowMonthly < 0 ? "−" : ""}${gbp(Math.abs(d.cashflowMonthly))}`} sub={`after ${gbp(d.mortgageMonthly)} mortgage`} />
                  <Tile label="Cash on cash" value={`${d.cashOnCashPct}%`} sub={`on ${gbp(d.cashRequired)} in`} />
                  <Tile label="Stamp duty" value={gbp(d.stampDuty)} />
                  <Tile label="Setup budget" value={gbp(d.setupCost)} />
                  <Tile label={`Max price for ${d.targetYieldPct}% yield`} value={gbp(d.maxPriceForTargetYield)} />
                  <Tile label="Net operating / yr" value={gbp(d.netOperating)} />
                </>
              ) : (
                <>
                  <Tile label="Monthly margin" value={`${d.monthlyMargin < 0 ? "−" : ""}${gbp(Math.abs(d.monthlyMargin))}`} />
                  <Tile label="Annual margin" value={`${d.annualMargin < 0 ? "−" : ""}${gbp(Math.abs(d.annualMargin))}`} />
                  <Tile label="Breakeven occupancy" value={d.breakevenOccupancyPct === null ? "—" : `${d.breakevenOccupancyPct}%`} />
                  <Tile label="Payback of setup" value={d.paybackMonths === null ? "Never" : `${d.paybackMonths} months`} />
                  <Tile label="Monthly gross" value={gbp(d.monthlyGross)} />
                  <Tile label="Running costs" value={gbp(d.monthlyOperating)} />
                  <Tile label="Net before rent" value={gbp(d.monthlyNetBeforeRent)} />
                  <Tile label={`Max rent for ${gbp(d.targetMarginPcm)} margin`} value={gbp(d.maxRentForTargetMargin)} />
                </>
              )}
            </div>
            <a href={`/api/deal-pdf?token=${encodeURIComponent(token)}`} className="mt-4 inline-block rounded-md border border-[#e4e7dc] px-3 py-1.5 text-sm font-medium hover:bg-[#f3f5ee]">Download as PDF</a>
          </section>
        )}

        <p className="mt-6 text-xs text-[#7a8274]">
          {est ? `${est.note}. ` : ""}Estimates from Stayful Intelligence and its data partners. Running costs assume 15% platform fees, 15% management, 18% cleaning and £250 a month bills. Not financial advice.
        </p>
        <div className="mt-8 rounded-2xl bg-[#2e3d2b] p-5 text-white">
          <p className="text-lg font-semibold">Want this for any listing?</p>
          <p className="mt-1 text-sm text-white/80">Paste a Rightmove, OnTheMarket or Airbnb link into Stayful Intelligence and get a full report with live comparables.</p>
          <Link href="/signup?next=/markets" className="mt-3 inline-block rounded-md bg-[#b9d5c6] px-4 py-2 text-sm font-semibold text-[#2e3d2b]">Start free trial</Link>
        </div>
      </div>
    </main>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-[#e4e7dc] bg-white p-3">
      <p className="text-[10px] uppercase tracking-wider text-[#7a8274]">{label}</p>
      <p className="mt-0.5 text-lg font-bold">{value}</p>
      {sub && <p className="text-[10px] text-[#7a8274]">{sub}</p>}
    </div>
  );
}
