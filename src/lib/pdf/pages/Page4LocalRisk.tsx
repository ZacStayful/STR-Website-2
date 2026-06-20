import React from "react";
import { Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_COLORS } from "../theme";
import { HeaderBar, FooterBar } from "../components/Chrome";
import { H2, Divider, Pill, BASE_PAGE_STYLES } from "../components/Primitives";
import type { PdfReportData } from "../derive";

const C = PDF_COLORS;

const s = StyleSheet.create({
  thRow: {
    flexDirection: "row",
    backgroundColor: C.DARK_GREEN,
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  thCell: { fontSize: 7, fontFamily: "Helvetica-Bold", color: C.WHITE },
  tdRow: {
    flexDirection: "row",
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: C.CREAM,
  },
  tdCell: { fontSize: 8, color: C.DARK_GREY },
  tdCellBold: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.DARK_GREEN },
  dType: { flex: 2.5 },
  dNearest: { flex: 3 },
  dDist: { flex: 1.5, textAlign: "right" },
  dCount: { flex: 1.5, textAlign: "right" },
  dImpact: { flex: 1, textAlign: "center" },
  callout: {
    backgroundColor: C.MINT_GREEN + "55",
    borderRadius: 6,
    padding: 10,
    marginVertical: 8,
  },
  calloutTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: C.DARK_GREEN,
    marginBottom: 4,
  },
  calloutBody: { fontSize: 8, color: C.DARK_GREY },
  twoCol: {
    flexDirection: "row",
    gap: 14,
    marginTop: 6,
  },
  col: { flex: 1 },
  colTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: C.DARK_GREEN,
    marginBottom: 6,
  },
  colBody: { fontSize: 8, color: C.DARK_GREY, marginBottom: 4 },
  riskBarTrack: {
    height: 10,
    backgroundColor: C.CREAM,
    borderRadius: 5,
    marginVertical: 6,
    overflow: "hidden",
  },
  riskBarFill: {
    height: 10,
    backgroundColor: C.DARK_GREEN,
    borderRadius: 5,
  },
  riskLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: C.DARK_GREEN,
    textAlign: "center",
    marginBottom: 8,
  },
  factorRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 3,
  },
  factorName: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.DARK_GREY, flex: 2 },
  factorScore: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.DARK_GREEN, flex: 0.6, textAlign: "right" },
  factorDesc: { fontSize: 7, color: C.LIGHT_GREY, marginBottom: 6 },
  amenitySection: {
    marginBottom: 6,
  },
  amenitySectionTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: C.DARK_GREEN,
    marginBottom: 3,
  },
  amenityItem: { fontSize: 8, color: C.DARK_GREY, marginBottom: 1 },
  amenityFootnote: { fontSize: 7, color: C.LIGHT_GREY, marginTop: 6 },
});

export function Page4LocalRisk({ data }: { data: PdfReportData }) {
  const r = data.risk;
  const f = r.factors;
  const scoreLabel = (v: number) => `${v}/100`;

  return (
    <Page size="A4" style={BASE_PAGE_STYLES.page}>
      <HeaderBar />
      <FooterBar />

      <H2>Local Area Demand Intelligence</H2>

      {/* Demand drivers table */}
      <View style={s.thRow}>
        <Text style={[s.thCell, s.dType]}>Driver</Text>
        <Text style={[s.thCell, s.dNearest]}>Nearest</Text>
        <Text style={[s.thCell, s.dDist]}>Distance</Text>
        <Text style={[s.thCell, s.dCount]}>Count</Text>
        <Text style={[s.thCell, s.dImpact]}>Impact</Text>
      </View>
      {data.demandDrivers.map((d) => (
        <View key={d.type} style={s.tdRow}>
          <Text style={[s.tdCellBold, s.dType]}>{d.type}</Text>
          <Text style={[s.tdCell, s.dNearest]}>{d.nearest}</Text>
          <Text style={[s.tdCell, s.dDist]}>{d.distance}</Text>
          <Text style={[s.tdCell, s.dCount]}>{d.count}</Text>
          <View style={s.dImpact}>
            <Pill
              background={d.impact === "HIGH" ? C.DARK_GREEN : C.CREAM}
              color={d.impact === "HIGH" ? C.WHITE : C.DARK_GREY}
            >
              {d.impact}
            </Pill>
          </View>
        </View>
      ))}

      {/* Direct Booking Score callout */}
      <View style={s.callout}>
        <Text style={s.calloutTitle}>
          Direct Booking Potential Score: {data.directBookingScore}/100 —{" "}
          {data.directBookingScore >= 80 ? "EXCELLENT" :
           data.directBookingScore >= 50 ? "GOOD" : "MODERATE"}
        </Text>
        <Text style={s.calloutBody}>
          By Year 3, properties in this area typically achieve 30–50% direct
          bookings, reducing platform fees from 15% to near-zero on those
          bookings.
        </Text>
      </View>

      <Divider />

      {/* Two-column: Risk + Amenities */}
      <View style={s.twoCol}>
        {/* Left — Risk Profile */}
        <View style={s.col}>
          <Text style={s.colTitle}>Risk Profile</Text>
          <Text style={s.colBody}>
            Investment risk score based on revenue consistency, seasonal variance
            and long-term let comparison (0 = Low Risk, 100 = High Risk).
          </Text>

          <View style={s.riskBarTrack}>
            <View style={[s.riskBarFill, { width: `${r.overall}%` }]} />
          </View>
          <Text style={s.riskLabel}>{r.label} · {r.overall}/100</Text>

          <View style={s.factorRow}>
            <Text style={s.factorName}>Revenue Consistency</Text>
            <Text style={s.factorScore}>{scoreLabel(f.revenueConsistency)}</Text>
          </View>
          <Text style={s.factorDesc}>Monthly predictability throughout the year</Text>

          <View style={s.factorRow}>
            <Text style={s.factorName}>Long-Term Comparison</Text>
            <Text style={s.factorScore}>{scoreLabel(f.longTermComparison)}</Text>
          </View>
          <Text style={s.factorDesc}>STR premium strength vs guaranteed LTL</Text>

          <View style={s.factorRow}>
            <Text style={s.factorName}>Seasonal Variance</Text>
            <Text style={s.factorScore}>{scoreLabel(f.seasonalVariance)}</Text>
          </View>
          <Text style={s.factorDesc}>Moderate seasonal demand swings</Text>

          <View style={s.factorRow}>
            <Text style={s.factorName}>Market Demand</Text>
            <Text style={s.factorScore}>{scoreLabel(f.marketDemand)}</Text>
          </View>
          <Text style={s.factorDesc}>Local booking demand strength</Text>
        </View>

        {/* Right — Recommended Amenities */}
        <View style={s.col}>
          <Text style={s.colTitle}>Recommended Amenities</Text>

          <View style={s.amenitySection}>
            <Text style={s.amenitySectionTitle}>ESSENTIAL — Must Have</Text>
            {data.amenities.essential.map((a) => (
              <Text key={a} style={s.amenityItem}>• {a}</Text>
            ))}
          </View>

          <View style={s.amenitySection}>
            <Text style={s.amenitySectionTitle}>RECOMMENDED — Competitive Edge</Text>
            {data.amenities.recommended.map((a) => (
              <Text key={a} style={s.amenityItem}>• {a}</Text>
            ))}
          </View>

          <View style={s.amenitySection}>
            <Text style={s.amenitySectionTitle}>UNIQUE DIFFERENTIATORS — 15–30% Rate Premium</Text>
            {data.amenities.differentiators.map((a) => (
              <Text key={a} style={s.amenityItem}>• {a}</Text>
            ))}
          </View>

          <Text style={s.amenityFootnote}>
            Properties with at least one unique differentiator command measurably
            higher nightly rates in this market.
          </Text>
        </View>
      </View>
    </Page>
  );
}
