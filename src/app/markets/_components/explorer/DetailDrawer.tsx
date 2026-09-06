"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ArrowRight, Download, Star, X } from "lucide-react";
import { gbp, pct } from "@/lib/market/format";
import { ScoreBadge } from "../ScoreBadge";
import { ScoreBreakdown } from "../ScoreBreakdown";
import { ConfidenceBadge } from "../ConfidenceBadge";
import { LicensingBadge } from "../LicensingBadge";
import { VerdictLabel } from "../VerdictLabel";
import { Gauge, BedroomBars } from "./Charts";
import { ManagedEnquiry } from "./ManagedEnquiry";
import type { ExplorerRow } from "./types";

function Breakdown({ title, intro, rows }: { title: string; intro: string; rows: { label: string; detail: string; earned: number | null; weight: number }[] }) {
  return (
    <div className="mx-panel">
      <h2>{title}</h2>
      <p style={{ color: "var(--mx-muted)" }}>{intro}</p>
      <table className="mx-table">
        <thead><tr><th>Factor</th><th>What it measures</th><th>Points</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td style={{ textAlign: "left", color: "var(--mx-muted)" }}>{r.detail}</td>
              <td>{r.earned === null ? <span style={{ color: "var(--mx-muted)" }}>excluded</span> : <><strong>{Math.round(r.earned * 10) / 10}</strong><span style={{ color: "var(--mx-muted)" }}> / {Math.round(r.weight * 10) / 10}</span></>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DetailDrawer({
  row,
  bedroom,
  comparing,
  compareDisabled,
  userEmail,
  onClose,
  onToggleCompare,
  onToggleSaved,
}: {
  row: ExplorerRow;
  bedroom: number | null;
  comparing: boolean;
  compareDisabled: boolean;
  userEmail: string | null;
  onClose: () => void;
  onToggleCompare: () => void;
  onToggleSaved: () => void;
}) {
  const c = row.card;
  const h = c.headline;
  const y = c.yieldOnCost;
  const v = c.verdict;
  const lic = c.licensing;
  const p = row.personal;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="mx-drawer" aria-label={`${c.name} details`}>
      <div className="mx-drawer-head">
        <div className="mx-drawer-title">
          <div className="mx-breadcrumb">{c.code} postcode area · {lic.regionLabel}</div>
          <h2>{c.name}</h2>
          <div className="mx-card-badges">
            <ConfidenceBadge confidence={c.confidence} samples={h.totalSamples} />
            <LicensingBadge status={lic.status} label={lic.headline} />
            {c.managedByStayful && <span className="mx-managed">Stayful manages here</span>}
          </div>
        </div>
        <div className="mx-drawer-scores">
          {c.score && (
            <div className="mx-detail-score">
              <ScoreBadge score={c.score} size={72} />
              <div className="mx-detail-score-lbl">Stayful · {c.score.grade}</div>
            </div>
          )}
          {p && (
            <div className="mx-detail-score mx-detail-score--personal">
              <div className="mx-personal-ring"><b>{p.score}</b><span>{p.grade}</span></div>
              <div className="mx-detail-score-lbl">Your fit · {p.gradeLabel}</div>
            </div>
          )}
        </div>
        <button type="button" className="mx-cmp-close mx-drawer-close" aria-label="Close" onClick={onClose}><X size={20} /></button>
      </div>

      <div className="mx-drawer-actions">
        <button type="button" className={"mx-pill mx-pill--sm" + (row.saved ? " on" : "")} aria-pressed={row.saved} onClick={onToggleSaved}>
          <Star size={13} fill={row.saved ? "currentColor" : "none"} /> {row.saved ? "Saved" : "Save area"}
        </button>
        <button type="button" className={"mx-pill mx-pill--sm" + (comparing ? " on" : "")} aria-pressed={comparing} disabled={!comparing && compareDisabled} onClick={onToggleCompare}>
          {comparing ? "✓ Comparing" : "+ Compare"}
        </button>
        <a className="mx-pill mx-pill--sm" href={`/api/market-pdf?area=${encodeURIComponent(c.code)}`} target="_blank" rel="noopener">
          <Download size={13} /> PDF report
        </a>
        <Link className="mx-pill mx-pill--sm" href={`/markets/${c.slug}`}>Open full page</Link>
      </div>

      <div className="mx-drawer-body">
        {p && (p.fit.inBudget === false || p.fit.hasBedrooms === false || p.fit.inRange === false) && (
          <div className="mx-conf-callout mx-conf-callout--building">
            {p.fit.inBudget === false && <span>Average values here sit above your budget.</span>}
            {p.fit.hasBedrooms === false && <span>No data yet for your bedroom count.</span>}
            {p.fit.inRange === false && <span>{p.fit.distanceMiles} miles from home, beyond your range.</span>}
          </div>
        )}

        <div className="mx-bigstats mx-bigstats--drawer">
          <div className="mx-bigstat"><div className="v">{gbp(h.grossRevenue)}</div><div className="l">Avg gross revenue / yr</div></div>
          <div className="mx-bigstat"><div className="v">{gbp(h.adr)}</div><div className="l">Average daily rate</div></div>
          <div className="mx-bigstat"><div className="v">{pct(h.occupancy, 0)}</div><div className="l">Occupancy</div></div>
          <div className="mx-bigstat">
            <div className="v">{y ? pct(y.grossYieldPct, 1) : "—"}</div>
            <div className="l">Gross yield-on-cost</div>
            <div className="sub">{y ? `on ~${gbp(y.propertyValueMid)} property value` : "no area property-value data"}</div>
          </div>
        </div>

        <div className={`mx-conf-callout mx-conf-callout--${c.confidence.tier}`}>
          <ConfidenceBadge confidence={c.confidence} samples={h.totalSamples} />
          <span>{c.confidence.blurb}{c.confidence.tier !== "confirmed" && " As more analyser reports come in for this area, these figures will firm up."}</span>
        </div>

        <div className="mx-panel">
          <h2>Competition &amp; direct bookings</h2>
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
          {c.competition && (
            <table className="mx-table mx-table--tight">
              <tbody>
                {c.competition.components.map((k) => (
                  <tr key={k.key}><td>{k.label}</td><td style={{ textAlign: "left", color: "var(--mx-muted)" }}>{k.detail}</td><td>{k.percentile === null ? "—" : `${k.percentile}th pct`}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {c.directBooking && (
            <table className="mx-table mx-table--tight">
              <tbody>
                {c.directBooking.components.map((k) => (
                  <tr key={k.key}><td>{k.label}</td><td style={{ textAlign: "left", color: "var(--mx-muted)" }}>{k.detail}</td><td>{k.earned === null ? "—" : `${Math.round(k.earned)} / ${k.weight}`}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {p && (
          <Breakdown
            title={`Your fit: ${p.score}/100 · ${p.grade} (${p.gradeLabel})`}
            intro="The Stayful score, re-weighted by your goals. Every point is shown."
            rows={p.components.map((k) => ({ label: k.label, detail: k.detail, earned: k.earned, weight: k.weight }))}
          />
        )}
        {c.score && <ScoreBreakdown score={c.score} />}

        <div className="mx-panel">
          <h2>By bedroom count</h2>
          <BedroomBars stats={c.byBedrooms} highlight={bedroom} />
          <table className="mx-table">
            <thead><tr><th>Beds</th><th>Samples</th><th>ADR</th><th>Occupancy</th><th>Gross rev</th><th>Property value</th></tr></thead>
            <tbody>
              {c.byBedrooms.map((b) => (
                <tr key={b.bedrooms} className={bedroom === b.bedrooms ? "is-hl" : undefined}>
                  <td>{b.bedrooms}</td><td>{b.samples}</td><td>{gbp(b.adr)}</td><td>{pct(b.occupancy, 1)}</td><td>{gbp(b.grossRevenue)}</td>
                  <td>{b.propertyValueLow !== null && b.propertyValueHigh !== null ? `${gbp(b.propertyValueLow)}–${gbp(b.propertyValueHigh)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mx-panel">
          <h2>Short-let vs long-let</h2>
          <p><VerdictLabel verdict={v} /></p>
          {v ? (
            <table className="mx-table">
              <tbody>
                <tr><td>Short-let net income / yr</td><td>{gbp(v.financials.shortLetNetAnnual)}</td></tr>
                <tr><td>Long-let net income / yr</td><td>{gbp(v.financials.longLetNetAnnual)}</td></tr>
                <tr><td>Area long-let rent (PropertyData)</td><td>{gbp(v.longLetMonthlyRent)}/mo</td></tr>
                <tr><td>Break-even occupancy</td><td>{v.breakEvenOccupancyPct}%</td></tr>
              </tbody>
            </table>
          ) : (
            <p style={{ color: "var(--mx-muted)" }}>No area long-let comparator for {c.name} yet, so the short-vs-long verdict isn’t available.</p>
          )}
        </div>

        <div className="mx-panel">
          <h2>Licensing &amp; regulation</h2>
          <LicensingBadge status={lic.status} />
          <p style={{ marginTop: 12 }}>{lic.detail}</p>
          {lic.changeIncoming && <p className="mx-note">Heads-up: {lic.changeIncoming}</p>}
          {lic.straddle && <p className="mx-note">This postcode area straddles a jurisdiction boundary, so rules can differ within it — treat this as unconfirmed and check the specific local authority.</p>}
          {lic.sources.length > 0 && (
            <div className="mx-sources">
              Sources: {lic.sources.map((s, i) => <span key={s}>{i > 0 && " · "}<a href={s} target="_blank" rel="noopener noreferrer">{new URL(s).hostname}</a></span>)}
              <div>Last verified: {lic.lastVerified}</div>
            </div>
          )}
        </div>

        {c.managedByStayful && (
          <div className="mx-panel" style={{ background: "var(--mx-sage-mint)", borderColor: "var(--mx-sage-mint)" }}>
            <h2>Stayful already manages here</h2>
            <p>We run short-lets in {c.name} today, so we know the guests, the cleaners and the rules. Want a hands-off setup?</p>
            <ManagedEnquiry areaCode={c.code} areaName={c.name} email={userEmail} />
          </div>
        )}

        <div className="mx-panel" style={{ background: "var(--mx-sage-mint)", borderColor: "var(--mx-sage-mint)" }}>
          <h2>Analyse a specific property in {c.name}</h2>
          <p>These are area averages. To model a specific address — with its own comparables, risk profile and 12-month forecast — run it through the Stayful analyser.</p>
          <div className="mx-cta-row"><Link href="/estimate" className="mx-cta">Analyse an address <ArrowRight size={16} /></Link></div>
        </div>

        <p className="mx-disclaimer">
          {c.name} figures are averages from {h.totalSamples} Stayful analyser samples across the {c.code} postcode area — indicative, not a guarantee of returns. Licensing is a general guide; confirm with the local authority before buying.
        </p>
      </div>
    </aside>
  );
}
