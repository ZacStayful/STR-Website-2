import React from "react";
import { Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_COLORS } from "../theme";
import { HeaderBar, FooterBar, formatGbp, formatPercent, formatRating } from "../components/Chrome";
import { H2, Subtitle, BASE_PAGE_STYLES } from "../components/Primitives";
import type { PdfReportData } from "../derive";

const C = PDF_COLORS;

const s = StyleSheet.create({
  benchmarkBar: {
    flexDirection: "row",
    backgroundColor: C.MINT_GREEN + "55",
    borderRadius: 6,
    padding: 10,
    marginBottom: 10,
    gap: 6,
  },
  benchmarkCell: {
    flex: 1,
    alignItems: "center",
  },
  benchmarkLabel: {
    fontSize: 7,
    color: C.DARK_GREY,
    marginBottom: 2,
  },
  benchmarkValue: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: C.DARK_GREEN,
  },
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
    paddingVertical: 2.5,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: C.CREAM,
  },
  tdRowStripe: { backgroundColor: C.ROW_STRIPE },
  tdCell: { fontSize: 7.5, color: C.DARK_GREY },
  tdCellBold: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: C.DARK_GREEN },
  tdCellMuted: { fontSize: 7.5, color: C.LIGHT_GREY },
  cName: { flex: 3 },
  cDist: { flex: 1.2, textAlign: "right" },
  cNightly: { flex: 1.2, textAlign: "right" },
  cOcc: { flex: 1, textAlign: "right" },
  cAnnual: { flex: 1.5, textAlign: "right" },
  cRating: { flex: 0.8, textAlign: "right" },
  cTier: { flex: 0.8, textAlign: "center" },
  matchBeatRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  matchBox: {
    flex: 1,
    backgroundColor: C.MINT_GREEN + "55",
    borderRadius: 8,
    padding: 12,
  },
  beatBox: {
    flex: 1,
    backgroundColor: C.DARK_GREEN,
    borderRadius: 8,
    padding: 12,
  },
  mbLabel: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1,
    marginBottom: 6,
  },
  mbRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 3,
  },
  mbKey: { fontSize: 8 },
  mbVal: { fontSize: 8, fontFamily: "Helvetica-Bold" },
});

export function Page3Comparables({ data }: { data: PdfReportData }) {
  const b = data.compsBenchmark;
  const mt = data.marketTargets;

  return (
    <Page size="A4" style={BASE_PAGE_STYLES.page}>
      <HeaderBar />
      <FooterBar />

      <H2>Comparable Properties</H2>
      <Subtitle>
        {b.count} active Airbnb listings within {b.radiusKm.toFixed(2)} km ·
        Median-aggregated · Data sourced from Airbnb via Airbtics
      </Subtitle>

      {/* Benchmark summary bar */}
      <View style={s.benchmarkBar}>
        <View style={s.benchmarkCell}>
          <Text style={s.benchmarkLabel}>Avg Nightly Rate</Text>
          <Text style={s.benchmarkValue}>{formatGbp(b.avgNightly)}</Text>
        </View>
        <View style={s.benchmarkCell}>
          <Text style={s.benchmarkLabel}>Avg Occupancy</Text>
          <Text style={s.benchmarkValue}>{formatPercent(b.avgOccupancy)}</Text>
        </View>
        <View style={s.benchmarkCell}>
          <Text style={s.benchmarkLabel}>Avg Annual Revenue</Text>
          <Text style={s.benchmarkValue}>{formatGbp(b.avgAnnual)}</Text>
        </View>
        <View style={s.benchmarkCell}>
          <Text style={s.benchmarkLabel}>Avg Rating</Text>
          <Text style={s.benchmarkValue}>{formatRating(b.avgRating)}</Text>
        </View>
        <View style={s.benchmarkCell}>
          <Text style={s.benchmarkLabel}>Avg Reviews</Text>
          <Text style={s.benchmarkValue}>{b.avgReviews}</Text>
        </View>
      </View>

      {/* Comparables table */}
      <View style={s.thRow}>
        <Text style={[s.thCell, s.cName]}>Property</Text>
        <Text style={[s.thCell, s.cDist]}>Distance</Text>
        <Text style={[s.thCell, s.cNightly]}>Nightly</Text>
        <Text style={[s.thCell, s.cOcc]}>Occ</Text>
        <Text style={[s.thCell, s.cAnnual]}>Annual</Text>
        <Text style={[s.thCell, s.cRating]}>Rating</Text>
        <Text style={[s.thCell, s.cTier]}>Tier</Text>
      </View>
      {data.comparables.map((c, i) => (
        <View key={c.name} style={i % 2 === 1 ? [s.tdRow, s.tdRowStripe] : s.tdRow}>
          <Text style={[s.tdCell, s.cName]}>{c.name}</Text>
          <Text style={[s.tdCell, s.cDist]}>{c.distance}</Text>
          <Text style={[s.tdCell, s.cNightly]}>{formatGbp(c.nightly)}</Text>
          <Text style={[s.tdCell, s.cOcc]}>{formatPercent(c.occupancy)}</Text>
          <Text style={[s.tdCell, s.cAnnual]}>{formatGbp(c.annual)}</Text>
          <Text style={[s.tdCell, s.cRating]}>{formatRating(c.rating)}</Text>
          <Text style={c.top ? [s.tdCellBold, s.cTier] : [s.tdCellMuted, s.cTier]}>
            {c.top ? "Top" : "—"}
          </Text>
        </View>
      ))}

      {/* Match vs Beat the Market */}
      <View style={s.matchBeatRow}>
        <View style={s.matchBox}>
          <Text style={[s.mbLabel, { color: C.DARK_GREEN }]}>TO MATCH THE MARKET</Text>
          <View style={s.mbRow}>
            <Text style={[s.mbKey, { color: C.DARK_GREY }]}>Rate</Text>
            <Text style={[s.mbVal, { color: C.DARK_GREEN }]}>{formatGbp(mt.matchNightly)}</Text>
          </View>
          <View style={s.mbRow}>
            <Text style={[s.mbKey, { color: C.DARK_GREY }]}>Occupancy</Text>
            <Text style={[s.mbVal, { color: C.DARK_GREEN }]}>{formatPercent(mt.matchOccupancy)}</Text>
          </View>
          <View style={s.mbRow}>
            <Text style={[s.mbKey, { color: C.DARK_GREY }]}>Rating</Text>
            <Text style={[s.mbVal, { color: C.DARK_GREEN }]}>{formatRating(b.avgRating)}</Text>
          </View>
          <View style={s.mbRow}>
            <Text style={[s.mbKey, { color: C.DARK_GREY }]}>Revenue</Text>
            <Text style={[s.mbVal, { color: C.DARK_GREEN }]}>{formatGbp(mt.matchRevenue)}</Text>
          </View>
        </View>
        <View style={s.beatBox}>
          <Text style={[s.mbLabel, { color: C.WHITE }]}>TO BEAT THE MARKET (Top 25%)</Text>
          <View style={s.mbRow}>
            <Text style={[s.mbKey, { color: C.WHITE }]}>Rate</Text>
            <Text style={[s.mbVal, { color: C.WHITE }]}>{formatGbp(mt.beatNightly)}</Text>
          </View>
          <View style={s.mbRow}>
            <Text style={[s.mbKey, { color: C.WHITE }]}>Occupancy</Text>
            <Text style={[s.mbVal, { color: C.WHITE }]}>{formatPercent(mt.beatOccupancy)}</Text>
          </View>
          <View style={s.mbRow}>
            <Text style={[s.mbKey, { color: C.WHITE }]}>Revenue</Text>
            <Text style={[s.mbVal, { color: C.WHITE }]}>{formatGbp(mt.beatRevenue)}</Text>
          </View>
        </View>
      </View>
    </Page>
  );
}
