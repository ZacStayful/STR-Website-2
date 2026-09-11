"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ArrowRight, Download, Star, X } from "lucide-react";
import { gbp, pct } from "@/lib/market/format";
import { trendLabel } from "@/lib/market/trend";
import { Gauge, BedroomBars } from "./Charts";
import { ManagedEnquiry } from "./ManagedEnquiry";
import { TrendCharts } from "./TrendCharts";
import { VerdictLabel } from "../VerdictLabel";
import { KeyTiles, Kv, VerdictBlock, Working } from "./VerdictBits";
import { areaVerdictFor } from "./verdicts";
import type { ExplorerRow, MarketGoals } from "./types";

function points(earned: number | null, weight: number): string {
  return earned === null ? "excluded" : `${Math.round(earned * 10) / 10} / ${Math.round(weight * 10) / 10}`;
}

/** The area card: one verdict, four tiles, then the working folded away. */
export function DetailDrawer({
  row,
  bedroom,
  goals,
  comparing,
  compareDisabled,
  userEmail,
  onClose,
  onToggleCompare,
  onToggleSaved,
}: {
  row: ExplorerRow;
  bedroom: number | null;
  goals: MarketGoals | null;
  comparing: boolean;
  compareDisabled: boolean;
  userEmail: string | null;
  onClose: () => void;
  onToggleCompare: () => void;
  onToggleSaved: () => void;
}) {
  const c = row.card;
  const h = c.headline;
  const lic = c.licensing;
  const p = row.personal;
  const av = c.verdict;
  const v = areaVerdictFor(row, bedroom, goals);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const trendWord = trendLabel(row.trend?.enquiries.direction)?.toLowerCase() ?? null;
  const metaLine = [trendWord, c.competition ? `${c.competition.label.toLowerCase()} competition` : null, lic.headline.toLowerCase()].filter(Boolean).join(" · ");

  return (
    <aside className="mx-drawer mx-deal" aria-label={`${c.name} details`}>
      <div className="mx-deal-head mx-deal-head--area">
        <div className="mx-deal-title">
          <div className="mx-eyebrow">{c.code} postcode area · {lic.regionLabel}</div>
          <h2>{c.name}</h2>
          <div className="mx-deal-meta">{metaLine}{c.managedByStayful && <> · <span className="mx-managed">Stayful manages here</span></>}</div>
        </div>
        <button type="button" className="mx-cmp-close mx-deal-close" aria-label="Close" onClick={onClose}><X size={20} /></button>
      </div>

      <div className="mx-drawer-body mx-deal-body">
        <VerdictBlock v={v} eyebrow={p ? `Your fit ${p.score} / 100 · ${p.gradeLabel}` : c.score ? `Stayful score ${c.score.score} / 100 · ${c.score.gradeLabel}` : `${c.confidence.label} data`} />
        <KeyTiles keys={v.keys} />
        {v.ceiling && <div className="mx-ceiling">{v.ceiling}</div>}

        <div className="mx-actions">
          <button type="button" className={"mx-btn" + (row.saved ? "" : " mx-btn--primary")} aria-pressed={row.saved} onClick={onToggleSaved}>
            <Star size={14} fill={row.saved ? "currentColor" : "none"} aria-hidden /> {row.saved ? "Saved" : "Save area"}
          </button>
          <button type="button" className={"mx-btn" + (comparing ? " mx-btn--on" : "")} aria-pressed={comparing} disabled={!comparing && compareDisabled} onClick={onToggleCompare}>
            {comparing ? "✓ Comparing" : "Compare"}
          </button>
          <a className="mx-btn mx-btn--ghost" href={`/api/market-pdf?area=${encodeURIComponent(c.code)}`} target="_blank" rel="noopener"><Download size={14} aria-hidden /> PDF</a>
          <Link className="mx-btn mx-btn--ghost" href={`/markets/${c.slug}`}>Full page ↗</Link>
        </div>

        <div className="mx-working">
          <span className="mx-eyebrow">Show the working</span>

          {c.score && (
            <Working title={`Stayful score ${c.score.score} · ${c.score.grade}`} small={c.score.partial ? "partial: no property-value data" : "yield, occupancy, revenue, competition, licensing"}>
              <Kv rows={c.score.components.map((k) => ({ k: k.label, v: points(k.earned, k.weight) }))} />
              <p className="mx-muted-p">{c.score.components.map((k) => k.detail).join(" · ")}</p>
            </Working>
          )}

          {p && (
            <Working title={`Your fit ${p.score} · ${p.grade}`} small="the Stayful score re-weighted by your goals">
              <Kv rows={p.components.map((k) => ({ k: k.label, v: points(k.earned, k.weight) }))} />
              <p className="mx-muted-p">{p.components.map((k) => k.detail).join(" · ")}</p>
            </Working>
          )}

          <Working title="Competition and direct bookings" small={[c.competition ? `${c.competition.label.toLowerCase()} market` : null, c.directBooking ? `${c.directBooking.label.toLowerCase()} direct-booking potential` : null].filter(Boolean).join(" · ") || "not enough data yet"}>
            <div className="mx-gauges">
              {c.competition ? (
                <Gauge value={c.competition.percentile} label={`${c.competition.label} market`} sub={`More competitive than ${c.competition.percentile}% of ${c.competition.areasRanked} areas`} amber />
              ) : (
                <div className="mx-gauge mx-gauge--empty"><div className="mx-gauge-label">Competition</div><div className="mx-gauge-sub">Not enough areas with listing data to compare yet.</div></div>
              )}
              {c.directBooking ? (
                <Gauge value={c.directBooking.score} label={`${c.directBooking.label} direct-booking potential`} sub={c.directBooking.contractorTrend ? `Contractor projects ${c.directBooking.contractorTrend === "up" ? "rising" : c.directBooking.contractorTrend === "down" ? "falling" : "steady"}` : "From local demand drivers"} />
              ) : (
                <div className="mx-gauge mx-gauge--empty"><div className="mx-gauge-label">Direct-booking potential</div><div className="mx-gauge-sub">No demand-driver data for this area yet.</div></div>
              )}
            </div>
            {c.competition && <Kv rows={c.competition.components.map((k) => ({ k: k.label, v: k.percentile === null ? "—" : `${k.percentile}th pct` }))} />}
            {c.directBooking && <Kv rows={c.directBooking.components.map((k) => ({ k: k.label, v: k.earned === null ? "—" : `${Math.round(k.earned)} / ${k.weight}` }))} />}
          </Working>

          {row.trend && (
            <Working title="Enquiry trend" small={trendWord ?? undefined}>
              <TrendCharts trend={row.trend} name={c.name} />
            </Working>
          )}

          <Working title="By bedroom count" small={`${c.byBedrooms.length} size${c.byBedrooms.length === 1 ? "" : "s"} · ${h.totalSamples} reports`}>
            <BedroomBars stats={c.byBedrooms} highlight={bedroom} />
            <table className="mx-table mx-table--tight">
              <thead><tr><th>Beds</th><th>Samples</th><th>ADR</th><th>Occ.</th><th>Gross rev</th><th>Value</th></tr></thead>
              <tbody>
                {c.byBedrooms.map((b) => (
                  <tr key={b.bedrooms} className={bedroom === b.bedrooms ? "is-hl" : undefined}>
                    <td>{b.bedrooms}</td><td>{b.samples}</td><td>{gbp(b.adr)}</td><td>{pct(b.occupancy, 0)}</td><td>{gbp(b.grossRevenue)}</td>
                    <td>{b.propertyValueMid !== null ? gbp(b.propertyValueMid) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Working>

          <Working title="Short-let vs long-let" small={av ? (av.winner === "short-let" ? "short-let ahead" : av.winner === "long-let" ? "long-let ahead" : "close call") : "no long-let comparator yet"}>
            <p><VerdictLabel verdict={av} /></p>
            {av ? (
              <Kv
                rows={[
                  { k: "Short-let net income / yr", v: gbp(av.financials.shortLetNetAnnual) },
                  { k: "Long-let net income / yr", v: gbp(av.financials.longLetNetAnnual) },
                  { k: "Area long-let rent", v: `${gbp(av.longLetMonthlyRent)}/mo` },
                  { k: "Break-even occupancy", v: `${av.breakEvenOccupancyPct}%` },
                ]}
              />
            ) : (
              <p className="mx-muted-p">No area long-let comparator for {c.name} yet.</p>
            )}
          </Working>

          <Working title="Licensing and regulation" small={lic.headline.toLowerCase()}>
            <p>{lic.detail}</p>
            {lic.changeIncoming && <p className="mx-note">Heads-up: {lic.changeIncoming}</p>}
            {lic.straddle && <p className="mx-note">This postcode area straddles a jurisdiction boundary, so rules can differ within it; treat this as unconfirmed and check the specific local authority.</p>}
            {lic.sources.length > 0 && (
              <div className="mx-sources">
                Sources: {lic.sources.map((s, i) => <span key={s}>{i > 0 && " · "}<a href={s} target="_blank" rel="noopener noreferrer">{new URL(s).hostname}</a></span>)}
                <div>Last verified: {lic.lastVerified}</div>
              </div>
            )}
          </Working>

          <Working title="Data confidence" small={`${c.confidence.label.toLowerCase()} · ${h.totalSamples} reports`}>
            <p>{c.confidence.blurb}{c.confidence.tier !== "confirmed" && " As more analyser reports come in for this area, these figures will firm up."}</p>
          </Working>

          {c.managedByStayful && (
            <Working title="Stayful already manages here" small="hands-off setup">
              <p>We run short-lets in {c.name} today, so we know the guests, the cleaners and the rules. Want a hands-off setup?</p>
              <ManagedEnquiry areaCode={c.code} areaName={c.name} email={userEmail} />
            </Working>
          )}
        </div>

        <div className="mx-ceiling mx-ceiling--cta">
          These are area averages. To model a specific address, run it through the analyser.
          <Link href="/estimate" className="mx-btn mx-btn--primary mx-btn--sm">Analyse an address <ArrowRight size={14} aria-hidden /></Link>
        </div>

        <p className="mx-src-line">
          {c.name} figures are averages from {h.totalSamples} Stayful analyser samples across the {c.code} postcode area; indicative, not a guarantee of returns. Licensing is a general guide; confirm with the local authority before buying.
        </p>
      </div>
    </aside>
  );
}
