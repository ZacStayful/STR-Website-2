"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import type { AnalysisResult, RiskLevel } from "@/lib/types";
import { deriveReportData, type PdfExpenses } from "@/lib/pdf/derive";
import { overallRiskScore100 } from "@/lib/scores";
import { C, gbp, riskLevelColors, riskScoreColors, riskScoreLabel, scoreColors } from "./_lib/tokens";
import { CASE_STUDIES, averageAccuracy } from "./_lib/caseStudies";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const TABS = [
  { id: "property", label: "Property" },
  { id: "market", label: "Market" },
  { id: "who", label: "Who books?" },
  { id: "income", label: "Income" },
  { id: "risk", label: "Risk" },
  { id: "proof", label: "Proof" },
  { id: "worth", label: "Worth it?" },
] as const;

const RISK_LABELS: { key: keyof AnalysisResult["risk"]; label: string }[] = [
  { key: "incomeVolatility", label: "Income volatility" },
  { key: "seasonality", label: "Seasonality" },
  { key: "regulatory", label: "Local regulation" },
  { key: "competition", label: "Competition" },
  { key: "locationDemand", label: "Location demand" },
  { key: "guestDamage", label: "Guest damage" },
  { key: "platformDependency", label: "Platform dependency" },
  { key: "setupCost", label: "Setup cost" },
];

const card: React.CSSProperties = { background: C.white, border: `1px solid ${C.gray200}`, borderRadius: 12, padding: "1.1rem 1.25rem" };
const tile: React.CSSProperties = { background: C.gray50, borderRadius: 8, padding: "0.85rem 0.9rem" };
const tileLabel: React.CSSProperties = { fontSize: 11, color: C.gray400 };
const tileValue: React.CSSProperties = { fontSize: 20, fontWeight: 500, color: C.gray900, marginTop: 2 };
const slideTitle: React.CSSProperties = { fontSize: 22, fontWeight: 500, color: C.gray900, margin: "0 0 4px" };
const slideSub: React.CSSProperties = { fontSize: 14, color: C.gray500, margin: "0 0 16px", lineHeight: 1.6 };

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function competitivenessOf(listings: number, avgReviews: number, avgRating: number, monthsToEstablished: number | null): { score: number; rating: RiskLevel; takeaway: string } {
  const listingScore = clamp((listings - 180) * 0.3, 0, 55);
  const incumbent = clamp((avgReviews / 120) * 16 + (avgRating - 4.2) * 20, 0, 30);
  // The longer it takes a new listing to reach the market's review count, the
  // more entrenched the competition — so a slow ramp raises the score.
  const rampTerm = monthsToEstablished != null ? clamp((monthsToEstablished - 12) * 0.5, 0, 20) : 0;
  const score = clamp(Math.round(listingScore + incumbent + rampTerm), 10, 96);
  const rating: RiskLevel = score <= 35 ? "low" : score <= 60 ? "moderate" : "high";
  const takeaway =
    rating === "low"
      ? "Light supply — a well-presented property can stand out quickly."
      : rating === "moderate"
        ? "A reviewed, established field — strong listing & pricing needed to win."
        : "Busy market with well-reviewed incumbents — it takes time to establish.";
  return { score, rating, takeaway };
}

function Stars({ rating, size = 24 }: { rating: number; size?: number }) {
  const pct = clamp((rating / 5) * 100, 0, 100);
  return (
    <span style={{ position: "relative", display: "inline-block", fontSize: size, lineHeight: 1, letterSpacing: 3 }} aria-label={`${rating} out of 5`}>
      <span style={{ color: C.gray200 }}>★★★★★</span>
      <span style={{ position: "absolute", left: 0, top: 0, width: `${pct}%`, overflow: "hidden", whiteSpace: "nowrap", color: "#e6a817" }}>★★★★★</span>
    </span>
  );
}

function NumField({ value, onChange, prefix, suffix, step = 1, max, width = 64 }: { value: number; onChange: (n: number) => void; prefix?: string; suffix?: string; step?: number; max?: number; width?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
      {prefix ? <span style={{ fontSize: 12, color: C.gray500 }}>{prefix}</span> : null}
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={0}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= 0 && (max === undefined || n <= max)) onChange(n);
        }}
        style={{ width, border: `1px solid ${C.gray200}`, borderRadius: 6, padding: "4px 6px", fontSize: 13, fontWeight: 500, color: C.gray900, outline: "none" }}
      />
      {suffix ? <span style={{ fontSize: 12, color: C.gray500 }}>{suffix}</span> : null}
    </span>
  );
}

export function PresentationDeck({
  result,
  expenses,
  mortgage: mortgageProp,
}: {
  result: AnalysisResult;
  expenses?: PdfExpenses;
  mortgage: number | null;
}) {
  const [active, setActive] = useState(0);
  const [ownerName, setOwnerName] = useState("");

  // Editable operating costs (the 3 factors between gross and net).
  const defaultCleaning = Math.max(0, Math.round((result.financials.shortLetGrossAnnual / 12) * 0.18));
  const [platformPct, setPlatformPct] = useState(expenses?.platformPct ?? 15);
  const [mgmtPct, setMgmtPct] = useState(expenses?.mgmtPct ?? 15);
  const [cleaningMonthly, setCleaningMonthly] = useState(expenses?.cleaningMonthly ?? defaultCleaning);

  // Editable personal costs → profit.
  const [mortgage, setMortgage] = useState(mortgageProp ?? 0);
  const [bills, setBills] = useState(0);

  // Editable assumptions for the time-to-competitive estimate.
  const [avgStayNights, setAvgStayNights] = useState(3);
  const [reviewOneIn, setReviewOneIn] = useState(3);

  const data = useMemo(
    () => deriveReportData(result, { platformPct, mgmtPct, cleaningMonthly, selfManaged: false }),
    [result, platformPct, mgmtPct, cleaningMonthly],
  );

  const grossMonthly = data.overview.grossMonthly;
  const netMonthly = data.overview.netMonthly;
  const otaMonthly = Math.round(data.shortLetAnnual.platformFee / 12);
  const mgmtMonthly = Math.round(data.shortLetAnnual.managementFee / 12);
  const profit = netMonthly - mortgage - bills;
  const ltlMonthly = Math.round(data.longLetAnnual.net / 12);

  const monthlyNet = data.monthly.map((m) => m.net);
  const maxNet = Math.max(...monthlyNet, 1);
  const bestIdx = monthlyNet.indexOf(Math.max(...monthlyNet));
  const worstIdx = monthlyNet.indexOf(Math.min(...monthlyNet));

  const avgRating = data.compsBenchmark.avgRating;
  const avgReviews = data.compsBenchmark.avgReviews;
  const reviewPct = clamp((avgReviews / 150) * 100, 3, 100);

  // Time-to-competitive: how long to accumulate reviews at this property's
  // projected occupancy. Bookings = occupied nights ÷ avg stay; reviews =
  // bookings ÷ "1 in N". Beginner = 10 reviews; Established = market average.
  const BEGINNER_REVIEWS = 10;
  const targetReviews = Math.round(avgReviews);
  const nightsPerMonth = data.overview.occupancy * 30.4;
  const bookingsPerMonth = avgStayNights > 0 ? nightsPerMonth / avgStayNights : 0;
  const reviewsPerMonth = reviewOneIn > 0 ? bookingsPerMonth / reviewOneIn : 0;
  const monthsToBeginner = reviewsPerMonth > 0 ? Math.ceil(BEGINNER_REVIEWS / reviewsPerMonth) : null;
  const monthsToEstablished = reviewsPerMonth > 0 && targetReviews > 0 ? Math.ceil(targetReviews / reviewsPerMonth) : null;

  const comp = competitivenessOf(result.shortLet.activeListings, avgReviews, avgRating, monthsToEstablished);
  const dbScore = data.directBookingScore;
  const topDriver = data.demandDrivers[0];

  type Marker = { pos: number; name: string; sub: string; months: number; color: string };
  const timelineMarkers: Marker[] = (() => {
    if (monthsToEstablished == null) return [];
    const m: Marker[] = [{ pos: 4, name: "Launch", sub: "Listed", months: 0, color: C.gray400 }];
    if (targetReviews >= BEGINNER_REVIEWS && monthsToBeginner != null) {
      m.push({ pos: clamp((monthsToBeginner / monthsToEstablished) * 100, 16, 84), name: "Beginner", sub: `${BEGINNER_REVIEWS} reviews`, months: monthsToBeginner, color: C.amber });
    }
    m.push({ pos: 96, name: "Established", sub: `${targetReviews} reviews`, months: monthsToEstablished, color: C.green });
    return m;
  })();

  // Same /100 risk score the dashboard and PDF use — kept identical for consistency.
  const overall100 = overallRiskScore100(result.risk);

  const fit = result.verdict.fit;
  const ANSWER: Record<typeof fit, { label: string; color: string }> = {
    strong: { label: "Yes — strong short-let potential", color: C.green },
    moderate: { label: "Worth considering — it's a closer call", color: C.amber },
    weak: { label: "No — long letting likely wins here", color: C.red },
  };
  const answer = ANSWER[fit];

  const summaryRows: { label: string; value: string; color?: string }[] = [
    { label: "Income vs long let", value: `${gbp(netMonthly)} vs ${gbp(ltlMonthly)}/mo · ${data.strVsLtl.percentUplift >= 0 ? "+" : ""}${data.strVsLtl.percentUplift}%`, color: data.strVsLtl.percentUplift >= 20 ? C.green : data.strVsLtl.percentUplift >= 10 ? C.amber : C.red },
    { label: "Profit after mortgage & bills", value: `${profit >= 0 ? "+" : "−"}${gbp(Math.abs(profit))}/mo`, color: profit >= 0 ? C.green : C.red },
    { label: "Market & competition", value: `${result.shortLet.activeListings} listings · ${avgRating > 0 ? `${avgRating.toFixed(1)}★ · ` : ""}${comp.rating} competition` },
    { label: "Demand strength", value: `${dbScore}/100 direct-booking${topDriver ? ` · ${topDriver.type.toLowerCase()}` : ""}` },
    { label: "Risk level", value: `${overall100}/100 · ${riskScoreLabel(overall100)}`, color: riskScoreColors(overall100).fill },
    { label: "Break-even occupancy", value: `${Math.round((result.financials.breakEvenOccupancy ?? 0) * 100)}%` },
  ];

  // Reusable breakdown row for the property slide
  const costRow = (label: React.ReactNode, amount: string, amountColor: string, withBorder = true) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: withBorder ? `1px solid ${C.gray100}` : "none", fontSize: 14 }}>
      <span style={{ color: C.gray500, display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>{label}</span>
      <span style={{ fontWeight: 500, color: amountColor }}>{amount}</span>
    </div>
  );

  return (
    <div className="sr-pres">
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, paddingBottom: 14, borderBottom: `1px solid ${C.gray200}`, flexWrap: "wrap" }}>
        <Image src="/assets/stayful-logo.png" alt="Stayful" width={50} height={30} priority />
        <nav className="sr-pres-tabs" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {TABS.map((t, i) => (
            <button key={t.id} type="button" onClick={() => setActive(i)} style={{ background: i === active ? C.greenLt : "transparent", color: i === active ? C.greenTx : C.gray500, border: "none", borderRadius: 999, padding: "6px 12px", fontSize: 12, fontWeight: 500, cursor: "pointer" }}>
              {t.label}
            </button>
          ))}
        </nav>
        <span style={{ fontSize: 12, color: C.gray400 }}>{active + 1} / {TABS.length}</span>
      </div>

      <div style={{ paddingTop: 22 }}>
        {/* 1. Property — gross → net (3 editable factors) → profit */}
        <section className="sr-pres-slide" style={{ display: active === 0 ? "block" : "none" }}>
          <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: "0.08em", color: C.gray400, textTransform: "uppercase" }}>Prepared for</div>
          <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Add owner name" aria-label="Owner name" style={{ fontSize: 24, fontWeight: 500, color: C.gray900, border: "none", outline: "none", padding: 0, marginTop: 4, width: "100%", background: "transparent" }} />
          <div style={{ fontSize: 14, color: C.gray500, marginTop: 2 }}>{result.property.address}</div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 16 }}>
            <div style={tile}><div style={tileLabel}>Occupancy</div><div style={tileValue}>{Math.round(data.overview.occupancy * 100)}%</div></div>
            <div style={tile}><div style={tileLabel}>Nightly rate</div><div style={tileValue}>{gbp(data.overview.adr)}</div></div>
            <div style={tile}><div style={tileLabel}>Long-let net</div><div style={tileValue}>{gbp(ltlMonthly)}</div></div>
          </div>

          {/* Gross → net: the 3 editable factors */}
          <div style={{ ...card, marginTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: C.gray800, marginBottom: 4 }}>Gross to net — edit any cost</div>
            {costRow(<span style={{ fontWeight: 500, color: C.gray900 }}>Gross income</span>, `${gbp(grossMonthly)}/mo`, C.gray900, false)}
            {costRow(<>OTA / platform fees <NumField value={platformPct} onChange={setPlatformPct} suffix="%" max={100} step={0.5} width={56} /></>, `−${gbp(otaMonthly)}/mo`, C.red)}
            {costRow(<>Management fees <NumField value={mgmtPct} onChange={setMgmtPct} suffix="%" max={100} step={0.5} width={56} /></>, `−${gbp(mgmtMonthly)}/mo`, C.red)}
            {costRow(<>Cleaning &amp; laundry (est.) <NumField value={cleaningMonthly} onChange={setCleaningMonthly} prefix="£" step={10} width={72} /></>, `−${gbp(cleaningMonthly)}/mo`, C.red)}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 12px", marginTop: 8, borderRadius: 8, background: C.greenLt }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: C.greenTx }}>Net income</span>
              <span style={{ fontSize: 16, fontWeight: 500, color: C.greenTx }}>{gbp(netMonthly)}/mo</span>
            </div>
          </div>

          {/* Net → profit: personal costs */}
          <div style={{ ...card, marginTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: C.gray800, marginBottom: 4 }}>Net to profit — your costs</div>
            {costRow(<span style={{ fontWeight: 500, color: C.gray900 }}>Net income</span>, `${gbp(netMonthly)}/mo`, C.gray900, false)}
            {costRow(<>Mortgage / rent <NumField value={mortgage} onChange={setMortgage} prefix="£" step={50} width={84} /></>, `−${gbp(mortgage)}/mo`, C.red)}
            {costRow(<>Bills (utilities, council tax, WiFi…) <NumField value={bills} onChange={setBills} prefix="£" step={25} width={84} /></>, `−${gbp(bills)}/mo`, C.red)}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 12px", marginTop: 8, borderRadius: 8, background: profit >= 0 ? C.greenLt : C.redLt }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: profit >= 0 ? C.greenTx : C.redTx }}>Estimated profit / month</span>
              <span style={{ fontSize: 18, fontWeight: 500, color: profit >= 0 ? C.greenTx : C.redTx }}>{profit >= 0 ? "" : "−"}{gbp(Math.abs(profit))}</span>
            </div>
          </div>
        </section>

        {/* 2. Market — review visuals + competitiveness */}
        <section className="sr-pres-slide" style={{ display: active === 1 ? "block" : "none" }}>
          <h2 style={slideTitle}>Your local market</h2>
          <p style={slideSub}>What the short-let market looks like around {result.property.postcode}, and how crowded it already is.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <div style={tile}><div style={tileLabel}>Active listings nearby</div><div style={{ ...tileValue, color: C.green }}>{result.shortLet.activeListings}</div></div>
            <div style={tile}><div style={tileLabel}>Avg nightly (comparables)</div><div style={tileValue}>{gbp(data.compsBenchmark.avgNightly)}</div></div>
            <div style={tile}><div style={tileLabel}>Avg occupancy</div><div style={tileValue}>{Math.round(data.compsBenchmark.avgOccupancy * 100)}%</div></div>
            <div style={tile}><div style={tileLabel}>Comparables analysed</div><div style={tileValue}>{data.compsBenchmark.count}<span style={{ fontSize: 11, color: C.gray400, fontWeight: 400 }}> · {data.compsBenchmark.radiusKm}km</span></div></div>
          </div>

          {/* What you're up against — visual reviews */}
          <div style={{ ...card, marginTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: C.gray800, marginBottom: 12 }}>What you&apos;re up against</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {/* Rating */}
              <div style={{ textAlign: "center", background: C.gray50, borderRadius: 8, padding: "0.9rem" }}>
                <Stars rating={avgRating} />
                <div style={{ fontSize: 22, fontWeight: 500, color: C.gray900, marginTop: 8 }}>{avgRating > 0 ? avgRating.toFixed(2) : "—"} <span style={{ fontSize: 13, color: C.gray400, fontWeight: 400 }}>/ 5</span></div>
                <div style={{ fontSize: 11, color: C.gray500, marginTop: 2 }}>Average review rating nearby</div>
              </div>
              {/* Review volume */}
              <div style={{ background: C.gray50, borderRadius: 8, padding: "0.9rem", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 500, color: C.gray900 }}>{avgReviews > 0 ? avgReviews : "—"}</div>
                <div style={{ fontSize: 11, color: C.gray500, margin: "2px 0 8px" }}>Reviews per listing on average</div>
                <div style={{ height: 8, borderRadius: 4, background: C.gray200, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${reviewPct}%`, background: C.green }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: C.gray400, marginTop: 3 }}><span>new</span><span>established (150+)</span></div>
              </div>
            </div>
          </div>

          {/* Time to become competitive */}
          <div style={{ ...card, marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: C.gray800 }}>How long to become competitive</span>
              {reviewsPerMonth > 0 ? (
                <span style={{ fontSize: 12, color: C.gray500 }}>≈ {reviewsPerMonth.toFixed(1)} reviews / month</span>
              ) : null}
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: C.gray500, marginTop: 6 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Avg stay <NumField value={avgStayNights} onChange={setAvgStayNights} suffix="nts" step={1} max={30} width={48} /></span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>1 in <NumField value={reviewOneIn} onChange={setReviewOneIn} step={1} max={20} width={44} /> guests review</span>
            </div>

            {timelineMarkers.length >= 2 ? (
              <>
                <div style={{ position: "relative", height: 64, marginTop: 22 }}>
                  <div style={{ position: "absolute", left: "4%", right: "4%", top: 27, height: 3, borderRadius: 2, background: C.gray200 }} />
                  <div style={{ position: "absolute", left: "4%", width: "92%", top: 27, height: 3, borderRadius: 2, background: `linear-gradient(to right, ${C.gray300}, ${C.amber}, ${C.green})` }} />
                  {timelineMarkers.map((mk) => (
                    <div key={mk.name} style={{ position: "absolute", left: `${mk.pos}%`, top: 0, transform: "translateX(-50%)", width: 92, textAlign: "center" }}>
                      <div style={{ fontSize: 10, fontWeight: 500, color: mk.color, lineHeight: 1.1 }}>{mk.name}</div>
                      <div style={{ width: 13, height: 13, borderRadius: "50%", background: mk.color, margin: "6px auto 0", boxShadow: `0 0 0 3px ${C.white}` }} />
                      <div style={{ fontSize: 11, fontWeight: 500, color: C.gray800, marginTop: 6 }}>{mk.months === 0 ? "now" : `${mk.months} mo`}</div>
                      <div style={{ fontSize: 9, color: C.gray400 }}>{mk.sub}</div>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: 12, color: C.gray500, lineHeight: 1.6, margin: "4px 0 0" }}>
                  At {Math.round(data.overview.occupancy * 100)}% occupancy, this property reaches the {targetReviews}-review market average in about <strong style={{ fontWeight: 500, color: C.gray800 }}>{monthsToEstablished} months</strong> — where returns become the most predictable and accurate.
                </p>
              </>
            ) : (
              <p style={{ fontSize: 13, color: C.gray500, lineHeight: 1.6, margin: "12px 0 0" }}>
                There isn&apos;t enough review data on nearby listings to estimate a time-to-competitive for this area.
              </p>
            )}
          </div>

          {/* Competitiveness gauge */}
          <div style={{ ...card, marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: C.gray800 }}>How competitive the market is</span>
              <span style={{ background: riskLevelColors(comp.rating).bg, color: riskLevelColors(comp.rating).tx, fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 999, textTransform: "capitalize" }}>{comp.rating} competition</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: C.gray200, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${comp.score}%`, background: riskLevelColors(comp.rating).fill }} />
            </div>
            <p style={{ fontSize: 13, color: C.gray500, lineHeight: 1.6, margin: "10px 0 0" }}>{comp.takeaway}</p>
          </div>
        </section>

        {/* 3. Who books */}
        <section className="sr-pres-slide" style={{ display: active === 2 ? "block" : "none" }}>
          <h2 style={slideTitle}>Who actually stays here</h2>
          <p style={slideSub}>The real demand around {result.property.postcode}, and how strong the direct-booking opportunity is.</p>
          <div style={{ ...card, display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ flexShrink: 0, width: 92, height: 92, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", border: `6px solid ${scoreColors(dbScore).fill}`, color: scoreColors(dbScore).fill, fontSize: 26, fontWeight: 500 }}>{dbScore}</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: C.gray800 }}>Direct booking score</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: scoreColors(dbScore).fill }}>{dbScore >= 70 ? "Strong" : dbScore >= 50 ? "Moderate" : "Limited"} potential · {dbScore}/100</div>
              <p style={{ fontSize: 13, color: C.gray500, lineHeight: 1.6, margin: "6px 0 0" }}>How well this location builds repeat and direct bookings, reducing platform fees over time.</p>
            </div>
          </div>
          <div style={{ ...card, marginTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: C.gray800, marginBottom: 10 }}>Why people book this location</div>
            {data.demandDrivers.length > 0 ? (
              <div style={{ display: "grid", gap: 8 }}>
                {data.demandDrivers.map((d) => (
                  <div key={d.type} style={{ background: C.gray50, borderRadius: 8, padding: "0.7rem 0.85rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: C.gray900 }}>{d.type}</span>
                      <span style={{ background: d.impact === "HIGH" ? C.greenLt : C.amberLt, color: d.impact === "HIGH" ? C.greenTx : C.amberTx, fontSize: 10, fontWeight: 500, padding: "1px 8px", borderRadius: 999, flexShrink: 0 }}>{d.impact}</span>
                    </div>
                    <p style={{ fontSize: 12, color: C.gray500, lineHeight: 1.5, margin: "4px 0 0" }}>Nearest: {d.nearest} · {d.distance} · {d.count}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: 13, color: C.gray500, lineHeight: 1.6, margin: 0 }}>Demand is driven by a mix of leisure and business stays typical of this postcode.</p>
            )}
          </div>
        </section>

        {/* 4. Income — seasonal: best/worst + chart */}
        <section className="sr-pres-slide" style={{ display: active === 3 ? "block" : "none" }}>
          <h2 style={slideTitle}>Your income through the year</h2>
          <p style={slideSub}>Net income is highest in your best months and dips in the quiet season — plan for both.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
            <div style={tile}><div style={tileLabel}>Net / month (avg)</div><div style={{ ...tileValue, color: C.green }}>{gbp(netMonthly)}</div></div>
            <div style={tile}><div style={tileLabel}>Long-let net / month</div><div style={{ ...tileValue, color: C.gray400 }}>{gbp(ltlMonthly)}</div></div>
            <div style={tile}><div style={tileLabel}>Uplift vs long let</div><div style={tileValue}>{data.strVsLtl.percentUplift >= 0 ? "+" : ""}{data.strVsLtl.percentUplift}%</div></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
            <div style={{ ...tile, borderLeft: `3px solid ${C.greenDk}` }}><div style={tileLabel}>Best month · {data.monthly[bestIdx].month}</div><div style={{ ...tileValue, color: C.greenDk }}>{gbp(monthlyNet[bestIdx])}</div></div>
            <div style={{ ...tile, borderLeft: `3px solid ${C.amber}` }}><div style={tileLabel}>Worst month · {data.monthly[worstIdx].month}</div><div style={{ ...tileValue, color: C.amber }}>{gbp(monthlyNet[worstIdx])}</div></div>
          </div>
          <div style={{ ...card, marginTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: C.gray800, marginBottom: 12 }}>Net income by month</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120 }}>
              {monthlyNet.map((n, i) => (
                <div key={MONTHS[i]} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
                  <span style={{ fontSize: 8, fontWeight: 500, color: i === bestIdx ? C.greenDk : i === worstIdx ? C.amber : "transparent", marginBottom: 2 }}>{i === bestIdx ? "Best" : i === worstIdx ? "Low" : "·"}</span>
                  <div style={{ width: "70%", height: `${Math.max(6, (n / maxNet) * 80)}px`, background: i === bestIdx ? C.greenDk : i === worstIdx ? C.amber : C.green, borderRadius: "3px 3px 0 0" }} />
                  <span style={{ fontSize: 8, color: i === bestIdx || i === worstIdx ? C.gray800 : C.gray400, fontWeight: i === bestIdx || i === worstIdx ? 500 : 400, marginTop: 3 }}>{MONTHS[i]}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 5. Risk */}
        <section className="sr-pres-slide" style={{ display: active === 4 ? "block" : "none" }}>
          <h2 style={slideTitle}>Risk profile</h2>
          <p style={slideSub}>The factors that determine how risky this property is to short let.</p>
          <div style={{ ...card, textAlign: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: C.gray500 }}>Overall STR risk score</div>
            <div style={{ fontSize: 44, fontWeight: 500, color: riskScoreColors(overall100).fill, lineHeight: 1.1 }}>{overall100}</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: riskScoreColors(overall100).fill }}>{riskScoreLabel(overall100)} risk · out of 100, lower is better</div>
          </div>
          <div style={card}>
            {RISK_LABELS.map(({ key, label }) => {
              const level: RiskLevel = result.risk[key] as RiskLevel;
              const rc = riskLevelColors(level);
              const width = level === "low" ? 33 : level === "moderate" ? 66 : 100;
              return (
                <div key={String(key)} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <div style={{ width: 140, fontSize: 12, color: C.gray800, flexShrink: 0 }}>{label}</div>
                  <div style={{ flex: 1, height: 5, borderRadius: 3, background: C.gray200, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${width}%`, background: rc.fill }} />
                  </div>
                  <span style={{ background: rc.bg, color: rc.tx, fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 999, flexShrink: 0, textTransform: "capitalize" }}>{level}</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* 6. Proof */}
        <section className="sr-pres-slide" style={{ display: active === 5 ? "block" : "none" }}>
          <h2 style={slideTitle}>Estimate vs actual · 2025</h2>
          <p style={slideSub}>How our estimates held up against the income these managed properties actually achieved — {averageAccuracy()}% average accuracy.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            {CASE_STUDIES.map((cs) => {
              const matched = cs.estimate === cs.actual;
              return (
                <div key={cs.city} style={card}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: C.gray900 }}>{cs.city}</div>
                  <div style={{ fontSize: 12, color: C.gray500, marginTop: 6 }}>Estimate: {gbp(cs.estimate)}</div>
                  <div style={{ fontSize: 12, color: C.green, fontWeight: 500 }}>Actual: {gbp(cs.actual)}{matched ? " · matched" : ""}</div>
                  {cs.file ? <a href={cs.file} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: C.green, textDecoration: "none", display: "inline-block", marginTop: 6 }}>View case study →</a> : null}
                </div>
              );
            })}
          </div>
        </section>

        {/* 7. Worth it? */}
        <section className="sr-pres-slide" style={{ display: active === 6 ? "block" : "none" }}>
          <h2 style={slideTitle}>Is this property worth short letting?</h2>
          <p style={slideSub}>Every finding from this analysis, condensed into one answer.</p>
          <div style={{ ...card, textAlign: "center", border: `2px solid ${answer.color}` }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" style={{ display: "inline-block" }}>
              <circle cx="12" cy="12" r="10" stroke={answer.color} strokeWidth="1.5" />
              {fit === "weak" ? <path d="M15 9l-6 6M9 9l6 6" stroke={answer.color} strokeWidth="1.5" strokeLinecap="round" /> : <path d="M8 12.5l2.5 2.5L16 9" stroke={answer.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
            </svg>
            <div style={{ fontSize: 20, fontWeight: 500, color: answer.color, margin: "8px 0 0" }}>{answer.label}</div>
            <p style={{ fontSize: 14, color: C.gray500, lineHeight: 1.7, margin: "8px 0 0" }}>{result.verdict.recommendation}</p>
          </div>
          <div style={{ ...card, marginTop: 14, padding: 0, overflow: "hidden" }}>
            {summaryRows.map((row, i) => (
              <div key={row.label} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "11px 16px", borderTop: i === 0 ? "none" : `1px solid ${C.gray100}`, fontSize: 13 }}>
                <span style={{ color: C.gray500 }}>{row.label}</span>
                <span style={{ fontWeight: 500, color: row.color ?? C.gray900, textAlign: "right" }}>{row.value}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Footer nav */}
      <div className="sr-pres-nav" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 22, paddingTop: 16, borderTop: `1px solid ${C.gray200}` }}>
        <button type="button" onClick={() => setActive((a) => Math.max(0, a - 1))} disabled={active === 0} style={{ background: "transparent", border: "none", color: active === 0 ? C.gray300 : C.gray500, fontSize: 14, fontWeight: 500, cursor: active === 0 ? "default" : "pointer", minHeight: 44 }}>← Back</button>
        <button type="button" onClick={() => window.print()} style={{ background: "transparent", border: `1px solid ${C.gray200}`, color: C.gray500, borderRadius: 8, fontSize: 13, fontWeight: 500, padding: "8px 14px", cursor: "pointer" }}>↓ Save as PDF</button>
        {active < TABS.length - 1 ? (
          <button type="button" onClick={() => setActive((a) => Math.min(TABS.length - 1, a + 1))} style={{ background: C.green, color: C.white, border: "none", borderRadius: 8, fontSize: 14, fontWeight: 500, padding: "0 20px", minHeight: 44, cursor: "pointer" }}>Continue →</button>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}
