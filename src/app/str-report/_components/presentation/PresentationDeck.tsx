"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { C, gbp, ratingColors } from "../../_lib/brand";
import type { PropertyInput } from "../../_lib/types";
import {
  ADR_DEFAULTS,
  calculateIncome,
  ltlEstimate,
  setupCost,
} from "../../_lib/calculations";
import { marketData } from "../../_lib/market";
import { calculateRisk } from "../../_lib/risk";
import { buildVerdict } from "../../_lib/verdict";
import {
  competitiveness,
  directBookingRating,
  directBookingScore,
  localAreaAnalysis,
  whyBookReasons,
} from "../../_lib/location";
import { CASE_STUDIES, averageAccuracy } from "../../_lib/caseStudies";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const TYPE_LABEL: Record<PropertyInput["propertyType"], string> = {
  apartment: "Apartment",
  terraced: "Terraced house",
  "semi-detached": "Semi-detached house",
  detached: "Detached house",
};

const TABS = [
  { id: "property", label: "Property" },
  { id: "market", label: "Market" },
  { id: "who", label: "Who books?" },
  { id: "income", label: "Income" },
  { id: "risk", label: "Risk" },
  { id: "proof", label: "Proof" },
  { id: "verdict", label: "Worth it?" },
] as const;

const card: React.CSSProperties = {
  background: C.white,
  border: `1px solid ${C.gray200}`,
  borderRadius: 12,
  padding: "1.1rem 1.25rem",
};

const tile: React.CSSProperties = { background: C.gray50, borderRadius: 8, padding: "0.85rem 0.9rem" };
const tileLabel: React.CSSProperties = { fontSize: 11, color: C.gray400 };
const tileValue: React.CSSProperties = { fontSize: 20, fontWeight: 500, color: C.gray900, marginTop: 2 };
const slideTitle: React.CSSProperties = { fontSize: 22, fontWeight: 500, color: C.gray900, margin: "0 0 4px" };
const slideSub: React.CSSProperties = { fontSize: 14, color: C.gray500, margin: "0 0 16px", lineHeight: 1.6 };

export function PresentationDeck({ input }: { input: PropertyInput }) {
  const [active, setActive] = useState(0);
  const [ownerName, setOwnerName] = useState(input.ownerName ?? "");

  const data = useMemo(() => {
    const market = marketData(input);
    const income = calculateIncome(input.beds);
    const risk = calculateRisk(input, income, market);
    const verdict = buildVerdict(input, income, risk);
    const ltl = ltlEstimate(input.beds);
    const adr = ADR_DEFAULTS[input.beds] ?? 112;
    const netRatio = income.net / income.gross;
    const monthlyNet = market.monthlyOccupancy.map((occ) =>
      Math.round(adr * 30.4 * (occ / 100) * netRatio),
    );
    return {
      market,
      income,
      risk,
      verdict,
      ltl,
      monthlyNet,
      dbScore: directBookingScore(input, market),
      reasons: whyBookReasons(input, market),
      area: localAreaAnalysis(input, market),
      comp: competitiveness(market),
      setup: setupCost(input.beds),
    };
  }, [input]);

  const { market, income, risk, verdict, ltl, monthlyNet, dbScore, reasons, area, comp, setup } = data;
  const coversMortgage = income.net - input.monthlyMortgage;
  const quietest = Math.min(...monthlyNet);
  const maxNet = Math.max(...monthlyNet, 1);
  const db = directBookingRating(dbScore);

  const ANSWERS: Record<typeof verdict.result, { label: string; color: string }> = {
    "strong-yes": { label: "Yes — strong short-let potential", color: C.green },
    yes: { label: "Yes — worth short letting", color: C.green },
    borderline: { label: "Borderline — proceed with caution", color: C.amber },
    no: { label: "No — not the right move here", color: C.red },
  };
  const answer = ANSWERS[verdict.result];

  // Everything from the report, condensed into evidence rows for the answer.
  const summaryRows: { label: string; value: string; color?: string }[] = [
    {
      label: "Income vs long let",
      value: `${gbp(income.net)} vs ${gbp(ltl)}/mo · ${verdict.upliftPct >= 0 ? "+" : ""}${verdict.upliftPct}%`,
      color: verdict.upliftPct >= 20 ? C.green : verdict.upliftPct >= 10 ? C.amber : C.red,
    },
    {
      label: "Covers your mortgage",
      value: `${coversMortgage >= 0 ? "+" : "−"}${gbp(Math.abs(coversMortgage))}/mo`,
      color: coversMortgage >= 0 ? C.green : C.red,
    },
    { label: "Market & competition", value: `${market.listingCount} listings · ${comp.rating.toLowerCase()} competition` },
    { label: "Demand strength", value: `${dbScore}/100 direct-booking · ${reasons[0].title.toLowerCase()}` },
    {
      label: "Risk level",
      value: `${risk.overall}/100 · ${risk.overallRating.toLowerCase()}`,
      color: ratingColors(risk.overallRating).fill,
    },
    { label: "Setup payback", value: verdict.setupPaybackMonths >= 999 ? "—" : `${verdict.setupPaybackMonths} months` },
  ];

  return (
    <div className="sr-pres">
      {/* ── Top bar ── */}
      <div className="sr-pres-topbar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, paddingBottom: 14, borderBottom: `1px solid ${C.gray200}`, flexWrap: "wrap" }}>
        <Image src="/assets/stayful-logo.png" alt="Stayful" width={50} height={30} priority />
        <nav className="sr-pres-tabs" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {TABS.map((t, i) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(i)}
              style={{
                background: i === active ? C.greenLt : "transparent",
                color: i === active ? C.greenTx : C.gray500,
                border: "none",
                borderRadius: 999,
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <span style={{ fontSize: 12, color: C.gray400 }}>
          {active + 1} / {TABS.length}
        </span>
      </div>

      {/* ── Slides ── */}
      <div style={{ paddingTop: 22 }}>
        {/* 1. Property */}
        <section className="sr-pres-slide" style={{ display: active === 0 ? "block" : "none" }}>
          <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: "0.08em", color: C.gray400, textTransform: "uppercase" }}>
            Prepared for
          </div>
          <input
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            placeholder="Add owner name"
            aria-label="Owner name"
            style={{ fontSize: 24, fontWeight: 500, color: C.gray900, border: "none", outline: "none", padding: 0, marginTop: 4, width: "100%", background: "transparent" }}
          />
          <div style={{ fontSize: 14, color: C.gray500, marginTop: 2 }}>
            {input.beds}-bed {TYPE_LABEL[input.propertyType].toLowerCase()} · {input.postcode}
          </div>

          <div style={{ ...card, marginTop: 18, padding: 0, overflow: "hidden" }}>
            {[
              ["Monthly revenue (gross)", gbp(income.gross)],
              ["Net income / month", gbp(income.net)],
              ["Average occupancy", `${market.avgOccupancy}%`],
              ["Nightly rate", gbp(market.avgDailyRate)],
              ["Long-let net / month", gbp(ltl)],
              ["Mortgage / month", gbp(input.monthlyMortgage)],
            ].map((row, i) => (
              <div key={row[0]} style={{ display: "flex", justifyContent: "space-between", padding: "11px 16px", borderTop: i === 0 ? "none" : `1px solid ${C.gray100}`, fontSize: 14 }}>
                <span style={{ color: C.gray500 }}>{row[0]}</span>
                <span style={{ fontWeight: 500, color: C.gray900 }}>{row[1]}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 13, color: C.gray400, marginTop: 12 }}>
            Every figure below is built from these details. The owner name is editable and only used to address this presentation.
          </p>
        </section>

        {/* 2. Market */}
        <section className="sr-pres-slide" style={{ display: active === 1 ? "block" : "none" }}>
          <h2 style={slideTitle}>Your local market</h2>
          <p style={slideSub}>What the short-let market looks like near {input.postcode} right now.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <div style={tile}><div style={tileLabel}>Active listings nearby</div><div style={{ ...tileValue, color: C.green }}>{market.listingCount}</div></div>
            <div style={tile}><div style={tileLabel}>Nightly rate ({input.beds}-bed)</div><div style={tileValue}>{gbp(market.avgDailyRate)}</div></div>
            <div style={tile}><div style={tileLabel}>Average occupancy</div><div style={tileValue}>{market.avgOccupancy}%</div></div>
            <div style={tile}><div style={tileLabel}>Median gross / month</div><div style={tileValue}>{gbp(market.medianGrossMonthly)}</div></div>
          </div>
          <div style={{ ...card, marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: C.gray800 }}>How competitive the area is</span>
              <span style={{ background: ratingColors(comp.rating).bg, color: ratingColors(comp.rating).tx, fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 999 }}>{comp.rating} competition</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: C.gray200, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${comp.score}%`, background: ratingColors(comp.rating).fill }} />
            </div>
            <p style={{ fontSize: 13, color: C.gray500, lineHeight: 1.7, margin: "10px 0 0" }}>{comp.summary}</p>
          </div>
        </section>

        {/* 3. Who books */}
        <section className="sr-pres-slide" style={{ display: active === 2 ? "block" : "none" }}>
          <h2 style={slideTitle}>Who actually stays here</h2>
          <p style={slideSub}>Who books in {input.postcode}, why they come, and the direct-booking opportunity.</p>
          <div style={{ ...card, display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ flexShrink: 0, width: 92, height: 92, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", border: `6px solid ${ratingColors(db.rating).fill}`, color: ratingColors(db.rating).fill, fontSize: 26, fontWeight: 500 }}>
              {dbScore}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: C.gray800 }}>Direct booking score</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: ratingColors(db.rating).fill }}>{db.label} potential · {dbScore}/100</div>
              <p style={{ fontSize: 13, color: C.gray500, lineHeight: 1.6, margin: "6px 0 0" }}>How well this location builds repeat and direct bookings, reducing platform fees over time.</p>
            </div>
          </div>
          <div style={{ ...card, marginTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: C.gray800, marginBottom: 10 }}>Why people book this location</div>
            <div style={{ display: "grid", gap: 8 }}>
              {reasons.map((r) => (
                <div key={r.title} style={{ background: C.gray50, borderRadius: 8, padding: "0.7rem 0.85rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: C.gray900 }}>{r.title}</span>
                    <span style={{ background: C.greenLt, color: C.greenTx, fontSize: 11, fontWeight: 500, padding: "1px 8px", borderRadius: 999, flexShrink: 0 }}>{r.share}%</span>
                  </div>
                  <p style={{ fontSize: 12, color: C.gray500, lineHeight: 1.6, margin: "4px 0 0" }}>{r.detail}</p>
                </div>
              ))}
            </div>
          </div>
          <div style={{ ...card, marginTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: C.gray800, marginBottom: 8 }}>Local area analysis</div>
            <p style={{ fontSize: 13, color: C.gray500, lineHeight: 1.7, margin: 0 }}>{area.summary}</p>
          </div>
        </section>

        {/* 4. Income */}
        <section className="sr-pres-slide" style={{ display: active === 3 ? "block" : "none" }}>
          <h2 style={slideTitle}>Your numbers, your income, your mortgage</h2>
          <p style={slideSub}>Here&apos;s how short-let net income stacks up against long letting and your mortgage.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <div style={tile}><div style={tileLabel}>Short-let net / month</div><div style={{ ...tileValue, color: C.green }}>{gbp(income.net)}</div></div>
            <div style={tile}><div style={tileLabel}>Long-let net / month</div><div style={{ ...tileValue, color: C.gray400 }}>{gbp(ltl)}</div></div>
            <div style={tile}><div style={tileLabel}>{coversMortgage >= 0 ? "Covers mortgage by" : "Short of mortgage by"}</div><div style={{ ...tileValue, color: coversMortgage >= 0 ? C.green : C.red }}>{coversMortgage >= 0 ? "+" : "−"}{gbp(Math.abs(coversMortgage))}</div></div>
            <div style={tile}><div style={tileLabel}>Quietest month (net)</div><div style={tileValue}>{gbp(quietest)}</div></div>
            <div style={tile}><div style={tileLabel}>Setup payback</div><div style={tileValue}>{verdict.setupPaybackMonths >= 999 ? "—" : `${verdict.setupPaybackMonths} mo`}</div></div>
            <div style={tile}><div style={tileLabel}>Uplift vs long let</div><div style={{ ...tileValue, color: C.green }}>{verdict.upliftPct >= 0 ? "+" : ""}{verdict.upliftPct}%</div></div>
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
          <p style={slideSub}>The six factors that determine how risky this property is to short let.</p>
          <div style={{ ...card, textAlign: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: C.gray500 }}>Overall STR risk score</div>
            <div style={{ fontSize: 44, fontWeight: 500, color: ratingColors(risk.overallRating).fill, lineHeight: 1.1 }}>{risk.overall}</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: ratingColors(risk.overallRating).fill }}>{risk.overallRating} risk · out of 100, lower is better</div>
          </div>
          <div style={card}>
            {risk.factors.map((f) => {
              const rc = ratingColors(f.rating);
              return (
                <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <div className="sr-risk-label" style={{ fontSize: 12, color: C.gray800, flexShrink: 0 }}>{f.label}</div>
                  <div style={{ flex: 1, height: 5, borderRadius: 3, background: C.gray200, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${f.score}%`, background: rc.fill }} />
                  </div>
                  <span style={{ background: rc.bg, color: rc.tx, fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 999, flexShrink: 0 }}>{f.rating}</span>
                </div>
              );
            })}
            <p style={{ fontSize: 13, color: C.gray500, lineHeight: 1.7, margin: "8px 0 0" }}>{risk.keyRisk}</p>
          </div>
        </section>

        {/* 6. Proof */}
        <section className="sr-pres-slide" style={{ display: active === 5 ? "block" : "none" }}>
          <h2 style={slideTitle}>Estimate vs actual · 2025</h2>
          <p style={slideSub}>How our estimates held up against the real income these managed properties achieved — {averageAccuracy()}% average accuracy.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            {CASE_STUDIES.map((cs) => {
              const matched = cs.estimate === cs.actual;
              return (
                <div key={cs.city} style={card}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: C.gray900 }}>{cs.city}</div>
                  <div style={{ fontSize: 12, color: C.gray500, marginTop: 6 }}>Estimate: {gbp(cs.estimate)}</div>
                  <div style={{ fontSize: 12, color: C.green, fontWeight: 500 }}>Actual: {gbp(cs.actual)} {matched ? "· matched" : ""}</div>
                  {cs.file ? (
                    <a href={cs.file} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: C.green, textDecoration: "none", display: "inline-block", marginTop: 6 }}>View case study →</a>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        {/* 7. The answer — every finding condensed into yes/no */}
        <section className="sr-pres-slide" style={{ display: active === 6 ? "block" : "none" }}>
          <h2 style={slideTitle}>Is this property worth short letting?</h2>
          <p style={slideSub}>Every finding from this report, condensed into one answer.</p>

          {/* Clear verdict banner */}
          <div style={{ ...card, textAlign: "center", border: `2px solid ${answer.color}` }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" style={{ display: "inline-block" }}>
              <circle cx="12" cy="12" r="10" stroke={answer.color} strokeWidth="1.5" />
              {verdict.result === "no" ? (
                <path d="M15 9l-6 6M9 9l6 6" stroke={answer.color} strokeWidth="1.5" strokeLinecap="round" />
              ) : (
                <path d="M8 12.5l2.5 2.5L16 9" stroke={answer.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>
            <div style={{ fontSize: 20, fontWeight: 500, color: answer.color, margin: "8px 0 0" }}>{answer.label}</div>
            <p style={{ fontSize: 14, color: C.gray500, lineHeight: 1.7, margin: "8px 0 0" }}>{verdict.summary}</p>
          </div>

          {/* Condensed evidence */}
          <div style={{ ...card, marginTop: 14, padding: 0, overflow: "hidden" }}>
            {summaryRows.map((row, i) => (
              <div key={row.label} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "11px 16px", borderTop: i === 0 ? "none" : `1px solid ${C.gray100}`, fontSize: 13 }}>
                <span style={{ color: C.gray500 }}>{row.label}</span>
                <span style={{ fontWeight: 500, color: row.color ?? C.gray900, textAlign: "right" }}>{row.value}</span>
              </div>
            ))}
          </div>

          {/* Bottom line + CTA */}
          <div style={{ ...card, marginTop: 14, textAlign: "center" }}>
            <p style={{ fontSize: 14, color: C.gray800, lineHeight: 1.7, margin: "0 0 14px" }}>
              {ownerName ? `${ownerName}, ` : ""}
              {verdict.result === "no"
                ? "on these numbers short letting doesn't beat long letting by enough to justify the effort. Happy to talk it through if you'd like a second look."
                : verdict.result === "borderline"
                  ? "this is a close call — it can work with sharp pricing and management. A quick call will help you decide with confidence."
                  : "the case for short letting is clear. The next step is a quick call to walk through how Stayful would run it for you."}
            </p>
            <a href="https://calendly.com/stayful" target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", background: answer.color, color: C.white, textDecoration: "none", fontSize: 14, fontWeight: 500, borderRadius: 8, padding: "12px 22px" }}>
              Book a call with Stayful →
            </a>
          </div>
        </section>
      </div>

      {/* ── Footer nav (hidden in print) ── */}
      <div className="sr-pres-nav" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 22, paddingTop: 16, borderTop: `1px solid ${C.gray200}` }}>
        <button type="button" onClick={() => setActive((a) => Math.max(0, a - 1))} disabled={active === 0} style={{ background: "transparent", border: "none", color: active === 0 ? C.gray300 : C.gray500, fontSize: 14, fontWeight: 500, cursor: active === 0 ? "default" : "pointer", minHeight: 44 }}>
          ← Back
        </button>
        <button type="button" onClick={() => window.print()} style={{ background: "transparent", border: `1px solid ${C.gray200}`, color: C.gray500, borderRadius: 8, fontSize: 13, fontWeight: 500, padding: "8px 14px", cursor: "pointer" }}>
          ↓ Save as PDF
        </button>
        {active < TABS.length - 1 ? (
          <button type="button" onClick={() => setActive((a) => Math.min(TABS.length - 1, a + 1))} style={{ background: C.green, color: C.white, border: "none", borderRadius: 8, fontSize: 14, fontWeight: 500, padding: "0 20px", minHeight: 44, cursor: "pointer" }}>
            Continue →
          </button>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}
