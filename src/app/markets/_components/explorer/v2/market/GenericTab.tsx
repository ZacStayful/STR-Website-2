"use client";

import Link from "next/link";
import type { TabModel, TabContext } from "@/lib/market/tab-model";
import { gbp, gbpCompact, pct } from "@/lib/market/format";
import { formatMonth } from "@/lib/market/trend";
import { MIN_RATED_REPORTS } from "@/lib/market/competition";
import { KpiCard } from "../shared/KpiCard";
import { DataTable } from "../shared/DataTable";
import { KvCard } from "../shared/KvCard";
import { LineCard, MIN_REPORTS } from "../shared/LineCard";
import { BarCard } from "../shared/BarCard";
import { DeltaTag } from "../shared/Tag";
import { BedroomBars, Gauge, SeasonalityBars } from "../../Charts";

const FORMATS = { gbp, gbpCompact, pct: (v: number) => pct(v, 0) };

/** Renders a TabModel: title, KPI tiles, an optional chart, table and key/value list. */
export function GenericTab({ model, ctx, onOpenDistrict }: { model: TabModel; ctx: TabContext; onOpenDistrict: (code: string) => void }) {
  const { scope, trend } = ctx;
  return (
    <div className="mx2-tabbody">
      <div className="mx2-section-head"><div><h3>{model.title}</h3><p>{model.desc}</p></div></div>

      {model.empty ? (
        <p className="mx2-note">{model.empty}</p>
      ) : (
        <>
          {model.kpis.length > 0 && (
            <div className="mx2-kpi-grid">
              {model.kpis.map((k) => <KpiCard key={k.label} size="md" label={k.label} value={k.value} sub={k.sub} colour={k.tone === "works" ? "var(--mx-sage-deep-2)" : k.tone === "muted" ? "var(--mx-muted)" : undefined} />)}
            </div>
          )}

          {model.line && (
            <LineCard title={model.line.title} series={scope.series} metric={model.line.metric} format={FORMATS[model.line.format]} legend={model.line.legend} tag={<DeltaTag trend={trend?.[model.line.delta]} />} />
          )}

          {model.extra === "reports" && (
            <BarCard
              title="Reports per month"
              ariaLabel="Stayful analyser reports run in this market, by month"
              data={scope.series.map((b) => ({ label: formatMonth(b.month).split(" ")[0], value: b.reports, tone: b.reports < MIN_REPORTS ? ("thin" as const) : undefined }))}
              format={(v) => String(Math.round(v))}
              tag={<DeltaTag trend={trend?.enquiries} />}
              note={`Where Stayful members are looking, month by month. Months with fewer than ${MIN_REPORTS} reports are drawn hollow.`}
            />
          )}

          {model.extra === "seasonality" && scope.seasonality && (
            <div className="mx2-card mx2-chart">
              <div className="mx2-chart-head"><h4 className="mx2-h4">Share of annual revenue by month</h4></div>
              <SeasonalityBars seasonality={scope.seasonality} />
            </div>
          )}

          {model.extra === "bedrooms" && scope.byBedrooms.length > 0 && (
            <div className="mx2-card mx2-chart">
              <div className="mx2-chart-head"><h4 className="mx2-h4">Revenue by bedroom count</h4></div>
              <BedroomBars stats={scope.byBedrooms} highlight={ctx.bedroom} />
            </div>
          )}

          {model.extra === "competition" && (
            <div className="mx2-card mx2-chart">
              <div className="mx-gauges">
                {scope.competition ? (
                  <Gauge value={scope.competition.intensity} label={scope.competition.label} sub={scope.competition.explanation} amber />
                ) : (
                  <div className="mx-gauge mx-gauge--empty"><div className="mx-gauge-label">Competition</div><div className="mx-gauge-sub">Needs {MIN_RATED_REPORTS} reports with review data ({scope.ratedReports} so far).</div></div>
                )}
                {scope.directBooking ? (
                  <Gauge value={scope.directBooking.score} label={`${scope.directBooking.label} direct-booking potential`} sub={scope.directBooking.contractorTrend ? `Contractor projects ${scope.directBooking.contractorTrend === "up" ? "rising" : scope.directBooking.contractorTrend === "down" ? "falling" : "steady"}` : "From local demand drivers"} />
                ) : (
                  <div className="mx-gauge mx-gauge--empty"><div className="mx-gauge-label">Direct-booking potential</div><div className="mx-gauge-sub">No demand-driver data yet.</div></div>
                )}
              </div>
              {scope.directBooking && (
                <KvCard title="Direct-booking drivers" rows={scope.directBooking.components.map((k) => ({ k: k.label, v: k.earned === null ? "—" : `${Math.round(k.earned)} / ${k.weight}` }))} className="mx2-card--flat" />
              )}
            </div>
          )}

          {model.table && (
            <div className="mx2-card mx2-card--table">
              <div className="mx2-card-head"><h4 className="mx2-h4">{model.table.title}</h4></div>
              <DataTable
                cols={model.table.cols}
                rows={model.table.rows.map((r) => ({ key: r.key, cells: r.cells.map((c, i) => (i === 0 ? <b key={i}>{c}</b> : c)), muted: r.muted, highlight: r.highlight, onClick: r.district ? () => onOpenDistrict(r.district!) : undefined }))}
                empty={<>No figures by bedroom count yet.</>}
              />
            </div>
          )}

          {model.kv && <KvCard title={model.kv.title} rows={model.kv.rows} note={model.kv.note} />}

          {model.links && model.links.length > 0 && (
            <p className="mx2-note">
              Sources: {model.links.map((l, i) => <span key={l.href}>{i > 0 && " · "}<Link href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</Link></span>)}
            </p>
          )}
        </>
      )}
    </div>
  );
}
