"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ArrowRight, X } from "lucide-react";
import { areaVerdict } from "@/lib/listing/verdict";
import { gbp, pct } from "@/lib/market/format";
import { areaTrend, trendLabel } from "@/lib/market/trend";
import { MIN_DISTRICT_SAMPLES } from "@/lib/market/confidence";
import type { AreaCardData, DistrictCardData } from "@/lib/market/explorer";
import { BedroomBars } from "./Charts";
import { Breadcrumb } from "./Breadcrumb";
import { CompetitionFold, SeasonalityFold } from "./LevelFolds";
import { TrendCharts } from "./TrendCharts";
import { KeyTiles, VerdictBlock, Working } from "./VerdictBits";
import type { Crumb } from "./types";

/**
 * A postcode district inside an area: the same tiles and folds as the area
 * drawer, from the reports run in that district alone. Licensing comes
 * from the area (rules are set per local authority, not per district).
 */
export function DistrictDrawer({ district, area, bedroom, crumbs, onClose }: {
  district: DistrictCardData;
  area: AreaCardData;
  bedroom: number | null;
  crumbs: Crumb[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const d = district;
  const name = `${area.name} ${d.code}`;
  const trend = d.ready ? areaTrend(d.series) : null;
  const bed = bedroom != null ? d.byBedrooms.find((b) => b.bedrooms === bedroom) ?? null : null;
  const v = areaVerdict({
    name,
    code: d.code,
    bedroom: bed ? bed.bedrooms : null,
    grossRevenue: bed ? bed.grossRevenue : d.headline.grossRevenue,
    occupancy: bed ? bed.occupancy : d.headline.occupancy,
    adr: bed ? bed.adr : d.headline.adr,
    yieldPct: bed ? bed.grossYieldPct : d.yieldOnCost?.grossYieldPct ?? null,
    samples: bed ? bed.samples : d.headline.totalSamples,
    grade: null,
    gradeLabel: null,
    competition: d.competition?.label ?? null,
    directBooking: d.directBooking?.label ?? null,
    directBookingScore: d.directBooking?.score ?? null,
    seasonality: d.seasonality ? { score: d.seasonality.score, label: d.seasonality.label } : null,
    licensing: { status: area.licensing.status, headline: area.licensing.headline, regionLabel: area.licensing.regionLabel },
    trend: trend?.enquiries.direction ?? null,
    fit: null,
    targetYieldPct: null,
  });
  const trendWord = trendLabel(trend?.enquiries.direction)?.toLowerCase() ?? null;
  const metaLine = [trendWord, d.competition ? `${d.competition.label.toLowerCase()} competition` : null, d.seasonality ? d.seasonality.label.toLowerCase() : null].filter(Boolean).join(" · ");

  return (
    <aside className="mx-drawer mx-deal" aria-label={`${name} details`}>
      <div className="mx-deal-head mx-deal-head--area">
        <div className="mx-deal-title">
          <Breadcrumb crumbs={crumbs} />
          <div className="mx-eyebrow">{d.code} postcode district · {area.name}</div>
          <h2>{name}</h2>
          <div className="mx-deal-meta">{metaLine || `${d.confidence.label} data`}</div>
        </div>
        <button type="button" className="mx-cmp-close mx-deal-close" aria-label="Back to the area" onClick={onClose}><X size={20} /></button>
      </div>

      <div className="mx-drawer-body mx-deal-body">
        {d.ready ? (
          <>
            <VerdictBlock v={v} eyebrow={`${d.confidence.label} data · ${d.headline.totalSamples} reports`} />
            <KeyTiles keys={v.keys} />
            {v.ceiling && <div className="mx-ceiling">{v.ceiling}</div>}

            <div className="mx-working">
              <span className="mx-eyebrow">Show the working</span>
              <CompetitionFold f={d} />
              <SeasonalityFold f={d} />
              {trend && (
                <Working title="Trend" small={trendWord ?? undefined}>
                  <TrendCharts trend={trend} name={name} />
                </Working>
              )}
              <Working title="By bedroom count" small={`${d.byBedrooms.length} size${d.byBedrooms.length === 1 ? "" : "s"} · ${d.headline.totalSamples} reports`}>
                <BedroomBars stats={d.byBedrooms} highlight={bedroom} />
                <table className="mx-table mx-table--tight">
                  <thead><tr><th>Beds</th><th>Samples</th><th>ADR</th><th>Occ.</th><th>Gross rev</th><th>Value</th></tr></thead>
                  <tbody>
                    {d.byBedrooms.map((b) => (
                      <tr key={b.bedrooms} className={bedroom === b.bedrooms ? "is-hl" : undefined}>
                        <td>{b.bedrooms}</td><td>{b.samples}</td><td>{gbp(b.adr)}</td><td>{pct(b.occupancy, 0)}</td><td>{gbp(b.grossRevenue)}</td>
                        <td>{b.propertyValueMid !== null ? gbp(b.propertyValueMid) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Working>
              <Working title="Data confidence" small={`${d.confidence.label.toLowerCase()} · ${d.headline.totalSamples} reports`}>
                <p>{d.confidence.blurb}{d.confidence.tier !== "confirmed" && " As more analyser reports come in for this district, these figures will firm up."}</p>
              </Working>
            </div>
          </>
        ) : (
          <div className="mx-empty">
            <h2>Early — {d.headline.totalSamples} of {MIN_DISTRICT_SAMPLES} reports</h2>
            <p>{d.code} needs {MIN_DISTRICT_SAMPLES - d.headline.totalSamples} more Stayful analyser report{MIN_DISTRICT_SAMPLES - d.headline.totalSamples === 1 ? "" : "s"} before its own figures are shown. Until then, {area.name} as a whole is the guide.</p>
          </div>
        )}

        <div className="mx-ceiling mx-ceiling--cta">
          These are district averages. To model a specific address, run it through the analyser.
          <Link href="/estimate" className="mx-btn mx-btn--primary mx-btn--sm">Analyse an address <ArrowRight size={14} aria-hidden /></Link>
        </div>

        <p className="mx-src-line">
          {name} figures are averages from {d.headline.totalSamples} Stayful analyser reports in the {d.code} postcode district; indicative, not a guarantee of returns. Licensing follows the {area.name} entry; confirm with the local authority before buying.
        </p>
      </div>
    </aside>
  );
}
