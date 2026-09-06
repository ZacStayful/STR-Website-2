import React from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { AreaCardData } from "@/lib/market/explorer";
import type { PersonalScore } from "@/lib/market/personalise";
import { PDF_COLORS } from "../theme";
import { HeaderBar, FooterBar } from "../components/Chrome";
import { H1, H2, SectionLabel, Divider, MetricCard, Pill, BASE_PAGE_STYLES } from "../components/Primitives";
import { gbp, pct } from "@/lib/market/format";

/**
 * One-page-per-section Market Explorer area report: headline stats, the
 * transparent score breakdown (and "Your fit" when the member has goals),
 * competition and direct-booking factors, per-bedroom table, verdict and
 * licensing. Same brand chrome as the property analysis PDF.
 */

const s = StyleSheet.create({
  row: { flexDirection: "row", gap: 10, marginBottom: 12 },
  scoreRow: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 14 },
  scoreBig: { fontSize: 34, fontFamily: "Helvetica-Bold", color: PDF_COLORS.DARK_GREEN },
  scoreLbl: { fontSize: 9, color: PDF_COLORS.DARK_GREY },
  table: { marginTop: 6, marginBottom: 12 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: PDF_COLORS.LIGHT_GREY, paddingVertical: 5 },
  th: { fontSize: 8, fontFamily: "Helvetica-Bold", color: PDF_COLORS.DARK_GREY, textTransform: "uppercase" },
  td: { fontSize: 9.5, color: "#2e3d2b" },
  muted: { color: PDF_COLORS.DARK_GREY },
  body: { fontSize: 10, lineHeight: 1.5, color: "#3b4438" },
  note: { fontSize: 8.5, color: PDF_COLORS.DARK_GREY, marginTop: 10, lineHeight: 1.4 },
});

function Row({ cols, widths, head = false, hl = false }: { cols: (string | React.ReactNode)[]; widths: number[]; head?: boolean; hl?: boolean }) {
  return (
    <View style={[s.tr, hl ? { backgroundColor: PDF_COLORS.ROW_STRIPE } : {}]}>
      {cols.map((c, i) => (
        <Text key={i} style={[head ? s.th : s.td, { width: `${widths[i]}%`, textAlign: i === 0 ? "left" : "right" }, i === 1 && !head ? s.muted : {}]}>
          {c}
        </Text>
      ))}
    </View>
  );
}

export function AreaReport({ card, personal, generatedAt }: { card: AreaCardData; personal: PersonalScore | null; generatedAt: string }) {
  const h = card.headline;
  const y = card.yieldOnCost;
  const v = card.verdict;
  const lic = card.licensing;
  return (
    <Document title={`${card.name} — Stayful Market Explorer`} author="Stayful">
      <Page size="A4" style={BASE_PAGE_STYLES.page}>
        <HeaderBar />
        <SectionLabel>Stayful Market Explorer · area report</SectionLabel>
        <H1>{card.name}</H1>
        <Text style={[s.body, { marginBottom: 10 }]}>
          {card.code} postcode area · {lic.regionLabel} · {card.confidence.label} data ({h.totalSamples} analyser samples) · generated {generatedAt}
        </Text>

        <View style={s.scoreRow}>
          {card.score && (
            <View>
              <Text style={s.scoreBig}>{card.score.score}</Text>
              <Text style={s.scoreLbl}>Stayful score · {card.score.grade} · {card.score.gradeLabel}{card.score.partial ? " (partial)" : ""}</Text>
            </View>
          )}
          {personal && (
            <View>
              <Text style={s.scoreBig}>{personal.score}</Text>
              <Text style={s.scoreLbl}>Your fit · {personal.grade} · {personal.gradeLabel}</Text>
            </View>
          )}
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            <Pill background={PDF_COLORS.CREAM} color={PDF_COLORS.DARK_GREEN}>{lic.headline}</Pill>
            {card.competition && <Pill background="#f5efe0" color="#9a7b2e">{card.competition.label} competition</Pill>}
            {card.directBooking && <Pill background={PDF_COLORS.MINT_GREEN} color={PDF_COLORS.DARK_GREEN}>{card.directBooking.label} direct booking</Pill>}
            {card.managedByStayful && <Pill background={PDF_COLORS.DARK_GREEN} color={PDF_COLORS.WHITE}>Stayful manages here</Pill>}
          </View>
        </View>

        <View style={s.row}>
          <MetricCard label="Avg gross revenue / yr" value={gbp(h.grossRevenue)} />
          <MetricCard label="Average daily rate" value={gbp(h.adr)} />
          <MetricCard label="Occupancy" value={pct(h.occupancy, 0)} />
          <MetricCard label="Gross yield-on-cost" value={y ? pct(y.grossYieldPct, 1) : "—"} sub={y ? `on ~${gbp(y.propertyValueMid)} value` : "no value data"} />
        </View>

        {card.score && (
          <>
            <H2>Stayful score — how it was earned</H2>
            <View style={s.table}>
              <Row head cols={["Factor", "What it measures", "Points"]} widths={[30, 50, 20]} />
              {card.score.components.map((c) => (
                <Row key={c.key} cols={[c.label, c.detail, c.earned === null ? "excluded" : `${Math.round(c.earned * 10) / 10} / ${c.weight}`]} widths={[30, 50, 20]} />
              ))}
            </View>
          </>
        )}

        {personal && (
          <>
            <H2>Your fit — re-weighted by your goals</H2>
            <View style={s.table}>
              <Row head cols={["Factor", "What it measures", "Points"]} widths={[30, 50, 20]} />
              {personal.components.map((c) => (
                <Row key={c.key} cols={[c.label, c.detail, c.earned === null ? "excluded" : `${Math.round(c.earned * 10) / 10} / ${Math.round(c.weight * 10) / 10}`]} widths={[30, 50, 20]} />
              ))}
            </View>
          </>
        )}
        <FooterBar />
      </Page>

      <Page size="A4" style={BASE_PAGE_STYLES.page}>
        <HeaderBar />
        <H2>Competition</H2>
        {card.competition ? (
          <>
            <Text style={s.body}>
              {card.name} is more competitive than {card.competition.percentile}% of the {card.competition.areasRanked} UK areas we track ({card.competition.label}). Based on {card.competition.sampleCount} reports with listing data.
            </Text>
            <View style={s.table}>
              <Row head cols={["Signal", "This area", "Percentile"]} widths={[30, 50, 20]} />
              {card.competition.components.map((c) => (
                <Row key={c.key} cols={[c.label, c.detail, c.percentile === null ? "—" : `${c.percentile}th`]} widths={[30, 50, 20]} />
              ))}
            </View>
          </>
        ) : (
          <Text style={s.body}>Not enough areas carry listing data yet to rank competition.</Text>
        )}

        <H2>Direct-booking potential</H2>
        {card.directBooking ? (
          <>
            <Text style={s.body}>{card.directBooking.score}/100 — {card.directBooking.label}. Weighted by what drives off-platform, repeat bookings: contractor projects, hospitals, universities, events and transport.</Text>
            <View style={s.table}>
              <Row head cols={["Driver", "This area", "Points"]} widths={[30, 50, 20]} />
              {card.directBooking.components.map((c) => (
                <Row key={c.key} cols={[c.label, c.detail, c.earned === null ? "—" : `${Math.round(c.earned)} / ${c.weight}`]} widths={[30, 50, 20]} />
              ))}
            </View>
          </>
        ) : (
          <Text style={s.body}>No demand-driver data for this area yet.</Text>
        )}

        <H2>By bedroom count</H2>
        <View style={s.table}>
          <Row head cols={["Beds", "Samples", "ADR", "Occupancy", "Gross rev", "Property value"]} widths={[10, 14, 16, 18, 18, 24]} />
          {card.byBedrooms.map((b, i) => (
            <Row
              key={b.bedrooms}
              hl={i % 2 === 1}
              widths={[10, 14, 16, 18, 18, 24]}
              cols={[String(b.bedrooms), String(b.samples), gbp(b.adr), pct(b.occupancy, 1), gbp(b.grossRevenue), b.propertyValueLow !== null && b.propertyValueHigh !== null ? `${gbp(b.propertyValueLow)}–${gbp(b.propertyValueHigh)}` : "—"]}
            />
          ))}
        </View>

        <H2>Short-let vs long-let</H2>
        {v ? (
          <View style={s.table}>
            <Row cols={["Verdict", "", v.winner === "short-let" ? `Short-let wins by ${gbp(v.annualAdvantage)}/yr` : v.winner === "long-let" ? `Long-let wins by ${gbp(v.annualAdvantage)}/yr` : "Line-ball"]} widths={[30, 30, 40]} />
            <Row cols={["Short-let net income / yr", "", gbp(v.financials.shortLetNetAnnual)]} widths={[30, 30, 40]} />
            <Row cols={["Long-let net income / yr", "", gbp(v.financials.longLetNetAnnual)]} widths={[30, 30, 40]} />
            <Row cols={["Area long-let rent", "", `${gbp(v.longLetMonthlyRent)}/mo`]} widths={[30, 30, 40]} />
            <Row cols={["Break-even occupancy", "", `${v.breakEvenOccupancyPct}%`]} widths={[30, 30, 40]} />
          </View>
        ) : (
          <Text style={s.body}>No area long-let comparator available yet.</Text>
        )}

        <Divider />
        <H2>Licensing &amp; regulation</H2>
        <Text style={s.body}>{lic.headline}. {lic.detail}</Text>
        {lic.changeIncoming ? <Text style={s.note}>Heads-up: {lic.changeIncoming}</Text> : null}
        {lic.sources.length > 0 ? <Text style={s.note}>Sources: {lic.sources.join(" · ")} · Last verified {lic.lastVerified}</Text> : null}
        <Text style={s.note}>
          Figures are averages from {h.totalSamples} Stayful analyser samples across the {card.code} postcode area — indicative, not a guarantee of returns. Licensing is a general guide; confirm with the local authority before buying.
        </Text>
        <FooterBar />
      </Page>
    </Document>
  );
}
