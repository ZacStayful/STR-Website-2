"use client";

import { gbpCompact, pct } from "@/lib/market/format";
import { MONTH_SHORT } from "@/lib/market/seasonality";
import { COMPETITION_LABELS, MIN_RATED_REPORTS, competitionMeaning } from "@/lib/market/competition";
import { MIN_SEASONALITY_REPORTS } from "@/lib/market/seasonality";
import { MIN_DISTRICT_SAMPLES } from "@/lib/market/confidence";
import type { DistrictCardData, LevelFigures } from "@/lib/market/explorer";
import { Gauge, SeasonalityBars } from "./Charts";
import { Kv, Working } from "./VerdictBits";

/**
 * The folds every level (region, area, district) shares: competition from
 * the comparables' reviews, seasonality from the monthly breakdown, and
 * the sub-market list. One implementation so the three drawers never
 * drift apart.
 */

export function CompetitionFold({ f }: { f: LevelFigures }) {
  const c = f.competition;
  return (
    <Working title="Competition" small={c ? `${c.label.toLowerCase()} · ${c.rating !== null ? `${c.rating.toFixed(2)}★` : "no rating"} · ${c.reviews !== null ? `${c.reviews} reviews` : "no review count"}` : `needs ${MIN_RATED_REPORTS} rated reports`}>
      <div className="mx-gauges">
        {c ? (
          <Gauge value={c.intensity} label={c.label} sub={c.explanation} amber />
        ) : (
          <div className="mx-gauge mx-gauge--empty"><div className="mx-gauge-label">Competition</div><div className="mx-gauge-sub">Needs {MIN_RATED_REPORTS} reports with review data ({f.ratedReports} so far).</div></div>
        )}
        {f.directBooking ? (
          <Gauge value={f.directBooking.score} label={`${f.directBooking.label} direct-booking potential`} sub={f.directBooking.contractorTrend ? `Contractor projects ${f.directBooking.contractorTrend === "up" ? "rising" : f.directBooking.contractorTrend === "down" ? "falling" : "steady"}` : "From local demand drivers"} />
        ) : (
          <div className="mx-gauge mx-gauge--empty"><div className="mx-gauge-label">Direct-booking potential</div><div className="mx-gauge-sub">No demand-driver data yet.</div></div>
        )}
      </div>
      {c && (
        <Kv rows={[
          { k: "Average rating of comparables", v: c.rating !== null ? `${c.rating.toFixed(2)} out of 5` : "—" },
          { k: "Average reviews per comparable", v: c.reviews !== null ? String(c.reviews) : "—" },
          { k: "Reports with review data", v: String(c.sampleCount) },
        ]} />
      )}
      {f.directBooking && <Kv rows={f.directBooking.components.map((k) => ({ k: k.label, v: k.earned === null ? "—" : `${Math.round(k.earned)} / ${k.weight}` }))} />}
      <p className="mx-muted-p">
        {COMPETITION_LABELS.map((l) => `${l}: ${competitionMeaning(l)}`).join(". ")}. 100+ reviews on average marks an established market; a rating of 4.8★ or better with fewer reviews is the opening.
      </p>
    </Working>
  );
}

export function SeasonalityFold({ f }: { f: LevelFigures }) {
  const s = f.seasonality;
  return (
    <Working title="Seasonality" small={s ? `${s.score} / 100 · ${s.label.toLowerCase()}` : `needs ${MIN_SEASONALITY_REPORTS} reports with monthly figures`}>
      {s ? (
        <>
          <p>{s.explanation} A score of 100 is a perfectly even year; the lower it goes, the more the income bunches into a few months.</p>
          <SeasonalityBars seasonality={s} />
          <Kv rows={[
            { k: "Consistency score", v: `${s.score} / 100 · ${s.label}` },
            { k: "Peak month", v: `${MONTH_SHORT[s.peakMonth]} · ${Math.round(s.peakShare * 100)}% of the year` },
            { k: "Quietest month", v: `${MONTH_SHORT[s.lowMonth]} · ${Math.round(s.lowShare * 100)}% of the year` },
            { k: "Reports with a monthly breakdown", v: String(s.sampleCount) },
          ]} />
        </>
      ) : (
        <p className="mx-muted-p">Needs {MIN_SEASONALITY_REPORTS} reports with a month-by-month breakdown ({f.monthlyReports} so far). Every full analyser report adds one.</p>
      )}
    </Working>
  );
}

/** One sub-market row: figures when ready, "Early" when not. */
export function DistrictRow({ d, onOpen }: { d: DistrictCardData; onOpen: (code: string) => void }) {
  return (
    <div
      className={"mx-vrow mx-vrow--district" + (d.ready ? "" : " mx-vrow--early")}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(d.code)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(d.code);
        }
      }}
    >
      <div className="mx-vrow-main">
        <div className="mx-vrow-title">
          <strong>{d.code}</strong>
          <em>{d.headline.totalSamples} report{d.headline.totalSamples === 1 ? "" : "s"}</em>
        </div>
        {d.ready ? (
          <div className="mx-vrow-stats">
            <span>{pct(d.headline.occupancy, 0)} occupied</span>
            <span>{gbpCompact(d.headline.adr)} a night</span>
            {d.competition && <span className={`mx-key-chip mx-key-chip--${d.competition.tone}`}>{d.competition.label}</span>}
            {d.seasonality && <span className="mx-key-chip">{d.seasonality.label}</span>}
          </div>
        ) : (
          <div className="mx-vrow-why"><span>Early — {d.headline.totalSamples} of {MIN_DISTRICT_SAMPLES} reports needed</span></div>
        )}
      </div>
      <div className="mx-vrow-end">
        <span className="mx-vrow-big">{d.ready ? gbpCompact(d.headline.grossRevenue) : "—"}</span>
        <span className="mx-vrow-lbl">{d.ready ? "avg rev / yr" : "early"}</span>
      </div>
    </div>
  );
}

export function SubMarketsFold({ districts, areaName, onOpen }: { districts: DistrictCardData[]; areaName: string; onOpen: (code: string) => void }) {
  const ready = districts.filter((d) => d.ready).length;
  return (
    <Working title="Sub-markets" small={districts.length === 0 ? "no postcode districts yet" : `${ready} of ${districts.length} district${districts.length === 1 ? "" : "s"} with figures`} defaultOpen={districts.length > 0}>
      {districts.length === 0 ? (
        <p className="mx-muted-p">Reports for {areaName} do not carry a full postcode yet, so it cannot be split into districts. New analyser reports add one automatically.</p>
      ) : (
        <>
          <p className="mx-muted-p">Postcode districts inside {areaName}, from the reports run there. A district needs {MIN_DISTRICT_SAMPLES} reports before its figures show.</p>
          <div className="mx-districts" role="list">
            {districts.map((d) => <DistrictRow key={d.code} d={d} onOpen={onOpen} />)}
          </div>
        </>
      )}
    </Working>
  );
}
