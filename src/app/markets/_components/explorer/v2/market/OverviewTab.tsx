"use client";

import { ChevronRight } from "lucide-react";
import type { AreaCardData, LevelFigures } from "@/lib/market/explorer";
import type { PersonalScore } from "@/lib/market/personalise";
import type { AreaTrend } from "@/lib/market/trend";
import { formatMonth } from "@/lib/market/trend";
import { gbp, gbpCompact, pct } from "@/lib/market/format";
import { districtLabel } from "@/lib/market/labels";
import type { CheckedListingRow } from "@/lib/listing/pipeline";
import type { MarketGoals } from "../../types";
import { PerformanceCard } from "./PerformanceCard";
import { SignalsStrip } from "./SignalsStrip";
import { YourDealsHere } from "./YourDealsHere";
import { KpiCard } from "../shared/KpiCard";
import { DataTable } from "../shared/DataTable";
import { LineCard, MIN_REPORTS } from "../shared/LineCard";
import { BarCard } from "../shared/BarCard";
import { DeltaTag } from "../shared/Tag";
import { AreaMiniMap } from "../shared/AreaMiniMap";

export function OverviewTab({
  area,
  scope,
  scopeName,
  personal,
  trend,
  goals,
  listings,
  dataCodes,
  onTab,
  onOpenDistrict,
  onOpenListing,
  onSetGoals,
}: {
  area: AreaCardData;
  scope: LevelFigures;
  scopeName: string;
  personal: PersonalScore | null;
  trend: AreaTrend | null;
  goals: MarketGoals | null;
  listings: CheckedListingRow[];
  dataCodes: ReadonlySet<string>;
  onTab: (t: "submarkets" | "listings" | "occupancy" | "revenue" | "rates" | "deals") => void;
  onOpenDistrict: (code: string) => void;
  onOpenListing: (id: string) => void;
  onSetGoals: () => void;
}) {
  const h = scope.headline;
  const topDistricts = area.districts.filter((d) => d.ready).sort((a, b) => (b.headline.grossRevenue ?? -1) - (a.headline.grossRevenue ?? -1)).slice(0, 4);
  const recentEnquiries = trend && trend.enquiries.direction !== "insufficient" && trend.enquiries.recent !== null ? String(Math.round(trend.enquiries.recent)) : "—";

  return (
    <div className="mx2-tabbody mx2-overview">
      <div className="mx2-grid-5-7">
        <PerformanceCard score={area.score} personal={personal} hasGoals={!!goals} onSetGoals={onSetGoals} />
        <div className="mx2-kpi-grid mx2-kpi-grid--2">
          <KpiCard label="Annual revenue" value={gbp(h.grossRevenue)} sub={<DeltaTag trend={trend?.revenue} />} info="Average gross revenue per listing a year, from the comparables in each analyser report" />
          <KpiCard label="Enquiries, last 3 months" value={recentEnquiries} sub={<DeltaTag trend={trend?.enquiries} />} info="Stayful analyser reports run for addresses here in the last three full months" />
          <KpiCard label="Average daily rate" value={gbp(h.adr)} sub={<DeltaTag trend={trend?.adr} />} info="Average rate per booked night" />
          <KpiCard label="Occupancy rate" value={pct(h.occupancy, 0)} sub={<DeltaTag trend={trend?.occupancy} />} info="Share of available nights booked" />
        </div>
      </div>

      <SignalsStrip area={area} scope={scope} trend={trend} targetYieldPct={goals?.finance.targetYieldPct ?? null} />

      <div className="mx2-grid-5-7 mx2-grid-5-7--stretch">
        <div className="mx2-map-card">
          <AreaMiniMap code={area.code} dataCodes={dataCodes} label={`${area.name} on the UK map`} />
          <span className="mx2-map-card-badge">{area.code} postcode area</span>
        </div>
        <div className="mx2-card mx2-card--table">
          <div className="mx2-card-head">
            <h4 className="mx2-h4">Top sub-markets</h4>
            <button type="button" className="mx2-btn mx2-btn--ghost" onClick={() => onTab("submarkets")}>View all <ChevronRight size={14} aria-hidden /></button>
          </div>
          <DataTable
            cols={["District", "Confidence", "Revenue", "Occ.", "RevPAR", "ADR"]}
            rows={topDistricts.map((d) => ({
              key: d.code,
              onClick: () => onOpenDistrict(d.code),
              cells: [<span key="c"><b>{districtLabel(d)}</b> <small className="mx2-muted">· {d.headline.totalSamples} reports</small></span>, d.confidence.label, gbpCompact(d.headline.grossRevenue), pct(d.headline.occupancy, 0), gbp(d.headline.adr !== null && d.headline.occupancy !== null ? (d.headline.adr * d.headline.occupancy) / 100 : null), gbp(d.headline.adr)],
            }))}
            empty={area.districts.length === 0 ? <>Reports for {area.name} do not carry a full postcode yet, so it cannot be split into districts.</> : <>No district has 3 reports yet. {area.districts.length} district{area.districts.length === 1 ? " is" : "s are"} building up.</>}
          />
        </div>
      </div>

      <section className="mx2-section">
        <div className="mx2-section-head">
          <div><h3>Listing overview</h3><p>The comparables behind these figures and how many reports members have run here, month by month.</p></div>
          <button type="button" className="mx2-btn mx2-btn--ghost" onClick={() => onTab("listings")}>See listings <ChevronRight size={14} aria-hidden /></button>
        </div>
        <div className="mx2-grid-3-9">
          <div className="mx2-stack">
            <KpiCard label="Listing density" value={scope.listingDensity === null ? "—" : `${scope.listingDensity.toFixed(1)}`} sub={scope.listingDensity === null ? "no density data yet" : "listings per km² around the analysed addresses"} />
            <KpiCard label="Analyser reports" value={String(h.totalSamples)} sub={`behind these figures · ${scope.confidence.label}`} />
          </div>
          <BarCard
            title="Reports per month"
            ariaLabel={`Stayful analyser reports run in ${scopeName}, by month`}
            data={scope.series.map((b) => ({ label: formatMonth(b.month).split(" ")[0], value: b.reports, tone: b.reports < MIN_REPORTS ? ("thin" as const) : undefined }))}
            format={(v) => String(Math.round(v))}
            tag={<DeltaTag trend={trend?.enquiries} />}
          />
        </div>
      </section>

      <section className="mx2-section">
        <div className="mx2-section-head"><div><h3>Revenue, rates and occupancy</h3><p>Twelve months of averages from the reports run in {scopeName}. Open a tab for the breakdown by bedroom count.</p></div></div>
        <div className="mx2-grid-3">
          <LineCard title="Average listing revenue" series={scope.series} metric="avg_gross_revenue" format={gbpCompact} legend="Monthly revenue" tag={<DeltaTag trend={trend?.revenue} />} onClick={() => onTab("revenue")} />
          <LineCard title="Average daily rate" series={scope.series} metric="avg_adr" format={gbp} legend="Avg rate" tag={<DeltaTag trend={trend?.adr} />} onClick={() => onTab("rates")} />
          <LineCard title="Occupancy" series={scope.series} metric="avg_occupancy" format={(v) => pct(v, 0)} legend="Occupancy" tag={<DeltaTag trend={trend?.occupancy} />} onClick={() => onTab("occupancy")} />
        </div>
      </section>

      <YourDealsHere listings={listings.filter((l) => l.postcodeArea === area.code)} areaName={area.name} onOpen={onOpenListing} onViewAll={() => onTab("deals")} />
    </div>
  );
}
