"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import type { AnalysisResult, RiskLevel } from "@/lib/types";
import { deriveReportData, type PdfExpenses } from "@/lib/pdf/derive";
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

function competitivenessOf(listings: number): { score: number; rating: RiskLevel; summary: string } {
  const score = Math.min(95, Math.max(10, Math.round((listings - 180) * 0.4)));
  if (score <= 35)
    return { score, rating: "low", summary: `With ${listings} active listings nearby, supply is relatively light — there's room for a well-presented property to stand out and command strong occupancy.` };
  if (score <= 60)
    return { score, rating: "moderate", summary: `At ${listings} active listings, the area is moderately competitive. Professional photography, dynamic pricing and a complete amenity list will be what separates you from the pack.` };
  return { score, rating: "high", summary: `${listings} active listings makes this a busy, competitive market. Winning here depends on a polished listing, sharp pricing and excellent reviews — achievable, but it has to be done well.` };
}

export function PresentationDeck({
  result,
  expenses,
  mortgage,
}: {
  result: AnalysisResult;
  expenses?: PdfExpenses;
  mortgage: number | null;
}) {
  const [active, setActive] = useState(0);
  const [ownerName, setOwnerName] = useState("");

  const data = useMemo(() => deriveReportData(result, expenses), [result, expenses]);

  const netMonthly = data.overview.netMonthly;
  const grossMonthly = data.overview.grossMonthly;
  const ltlMonthly = Math.round(data.longLetAnnual.net / 12);
  const coversMortgage = mortgage != null ? netMonthly - mortgage : null;
  const monthlyNet = data.monthly.map((m) => m.net);
  const quietest = Math.min(...monthlyNet);
  const maxNet = Math.max(...monthlyNet, 1);
  const comp = competitivenessOf(result.shortLet.activeListings);
  const dbScore = data.directBookingScore;
  const breakEven = Math.round((result.financials.breakEvenOccupancy ?? 0) * 100);
  const topDriver = data.demandDrivers[0];

  // Verdict
  const fit = result.verdict.fit;
  const ANSWER: Record<typeof fit, { label: string; color: string }> = {
    strong: { label: "Yes — strong short-let potential", color: C.green },
    moderate: { label: "Worth considering — it's a closer call", color: C.amber },
    weak: { label: "No — long letting likely wins here", color: C.red },
  };
  const answer = ANSWER[fit];

  const summaryRows: { label: string; value: string; color?: string }[] = [
    { label: "Income vs long let", value: `${gbp(netMonthly)} vs ${gbp(ltlMonthly)}/mo · ${data.strVsLtl.percentUplift >= 0 ? "+" : ""}${data.strVsLtl.percentUplift}%`, color: data.strVsLtl.percentUplift >= 20 ? C.green : data.strVsLtl.percentUplift >= 10 ? C.amber : C.red },
    ...(coversMortgage != null ? [{ label: "Covers your mortgage", value: `${coversMortgage >= 0 ? "+" : "−"}${gbp(Math.abs(coversMortgage))}/mo`, color: coversMortgage >= 0 ? C.green : C.red }] : []),
    { label: "Market & competition", value: `${result.shortLet.activeListings} listings · ${comp.rating} competition` },
    { label: "Demand strength", value: `${dbScore}/100 direct-booking${topDriver ? ` · ${topDriver.type.toLowerCase()}` : ""}` },
    { label: "Risk level", value: `${result.risk.overallScore}/100 · ${data.risk.label}`, color: riskScoreColors(result.risk.overallScore).fill },
    { label: "Break-even occupancy", value: `${breakEven}%` },
  ];

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
        {/* 1. Property */}
        <section className="sr-pres-slide" style={{ display: active === 0 ? "block" : "none" }}>
          <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: "0.08em", color: C.gray400, textTransform: "uppercase" }}>Prepared for</div>
          <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Add owner name" aria-label="Owner name" style={{ fontSize: 24, fontWeight: 500, color: C.gray900, border: "none", outline: "none", padding: 0, marginTop: 4, width: "100%", background: "transparent" }} />
          <div style={{ fontSize: 14, color: C.gray500, marginTop: 2 }}>{result.property.address}</div>
          <div style={{ ...card, marginTop: 18, padding: 0, overflow: "hidden" }}>
            {[
              ["Monthly revenue (gross)", gbp(grossMonthly)],
              ["Net income / month", gbp(netMonthly)],
              ["Average occupancy", `${Math.round(data.overview.occupancy * 100)}%`],
              ["Nightly rate", gbp(data.overview.adr)],
              ["Long-let net / month", gbp(ltlMonthly)],
              ["Mortgage / month", mortgage != null ? gbp(mortgage) : "—"],
            ].map((row, i) => (
              <div key={row[0]} style={{ display: "flex", justifyContent: "space-between", padding: "11px 16px", borderTop: i === 0 ? "none" : `1px solid ${C.gray100}`, fontSize: 14 }}>
                <span style={{ color: C.gray500 }}>{row[0]}</span>
                <span style={{ fontWeight: 500, color: C.gray900 }}>{row[1]}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 13, color: C.gray400, marginTop: 12 }}>Every figure below is built from this analysis. The owner name is editable and only used to address this presentation.</p>
        </section>

        {/* 2. Market */}
        <section className="sr-pres-slide" style={{ display: active === 1 ? "block" : "none" }}>
          <h2 style={slideTitle}>Your local market</h2>
          <p style={slideSub}>What the short-let market looks like around {result.property.postcode} right now.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <div style={tile}><div style={tileLabel}>Active listings nearby</div><div style={{ ...tileValue, color: C.green }}>{result.shortLet.activeListings}</div></div>
            <div style={tile}><div style={tileLabel}>Avg nightly (comparables)</div><div style={tileValue}>{gbp(data.compsBenchmark.avgNightly)}</div></div>
            <div style={tile}><div style={tileLabel}>Avg occupancy</div><div style={tileValue}>{Math.round(data.compsBenchmark.avgOccupancy * 100)}%</div></div>
            <div style={tile}><div style={tileLabel}>Comparables analysed</div><div style={tileValue}>{data.compsBenchmark.count}<span style={{ fontSize: 11, color: C.gray400, fontWeight: 400 }}> · {data.compsBenchmark.radiusKm}km</span></div></div>
          </div>
          <div style={{ ...card, marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: C.gray800 }}>How competitive the area is</span>
              <span style={{ background: riskLevelColors(comp.rating).bg, color: riskLevelColors(comp.rating).tx, fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 999, textTransform: "capitalize" }}>{comp.rating} competition</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: C.gray200, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${comp.score}%`, background: riskLevelColors(comp.rating).fill }} />
            </div>
            <p style={{ fontSize: 13, color: C.gray500, lineHeight: 1.7, margin: "10px 0 0" }}>{comp.summary}</p>
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

        {/* 4. Income */}
        <section className="sr-pres-slide" style={{ display: active === 3 ? "block" : "none" }}>
          <h2 style={slideTitle}>Your numbers, your income, your mortgage</h2>
          <p style={slideSub}>How short-let net income stacks up against long letting and your mortgage.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <div style={tile}><div style={tileLabel}>Short-let net / month</div><div style={{ ...tileValue, color: C.green }}>{gbp(netMonthly)}</div></div>
            <div style={tile}><div style={tileLabel}>Long-let net / month</div><div style={{ ...tileValue, color: C.gray400 }}>{gbp(ltlMonthly)}</div></div>
            {coversMortgage != null ? (
              <div style={tile}><div style={tileLabel}>{coversMortgage >= 0 ? "Covers mortgage by" : "Short of mortgage by"}</div><div style={{ ...tileValue, color: coversMortgage >= 0 ? C.green : C.red }}>{coversMortgage >= 0 ? "+" : "−"}{gbp(Math.abs(coversMortgage))}</div></div>
            ) : (
              <div style={tile}><div style={tileLabel}>Uplift vs long let</div><div style={{ ...tileValue, color: C.green }}>{data.strVsLtl.percentUplift >= 0 ? "+" : ""}{data.strVsLtl.percentUplift}%</div></div>
            )}
            <div style={tile}><div style={tileLabel}>Quietest month (net)</div><div style={tileValue}>{gbp(quietest)}</div></div>
          </div>
          <div style={{ ...card, marginTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: C.gray800, marginBottom: 12 }}>Net income through the year</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 110 }}>
              {monthlyNet.map((n, i) => (
                <div key={MONTHS[i]} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
                  <div style={{ width: "70%", height: `${Math.max(6, (n / maxNet) * 90)}px`, background: n === quietest ? C.amber : C.green, borderRadius: "3px 3px 0 0" }} />
                  <span style={{ fontSize: 8, color: C.gray400, marginTop: 3 }}>{MONTHS[i]}</span>
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
            <div style={{ fontSize: 44, fontWeight: 500, color: riskScoreColors(result.risk.overallScore).fill, lineHeight: 1.1 }}>{result.risk.overallScore}</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: riskScoreColors(result.risk.overallScore).fill }}>{riskScoreLabel(result.risk.overallScore)} risk · out of 100, lower is better</div>
          </div>
          <div style={card}>
            {RISK_LABELS.map(({ key, label }) => {
              const level = result.risk[key] as RiskLevel;
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

        {/* 7. Worth it? — condensed answer, no CTA */}
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
