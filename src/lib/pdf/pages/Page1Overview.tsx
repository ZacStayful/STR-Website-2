import React from "react";
import { Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_COLORS } from "../theme";
import { HeaderBar, FooterBar, formatGbp, formatPercent } from "../components/Chrome";
import {
  H1,
  Subtitle,
  Divider,
  SectionLabel,
  MetricCard,
  BASE_PAGE_STYLES,
} from "../components/Primitives";
import type { PdfReportData } from "../derive";

const C = PDF_COLORS;

const s = StyleSheet.create({
  metricsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  valueRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 10,
  },
  valueBox: {
    flex: 1,
    backgroundColor: C.WHITE,
    borderColor: C.CREAM,
    borderWidth: 1,
    borderRadius: 6,
    padding: 12,
  },
  valueLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: C.LIGHT_GREY,
    letterSpacing: 1,
    marginBottom: 4,
  },
  valueAmount: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: C.DARK_GREEN,
  },
  valueSource: {
    fontSize: 7,
    color: C.LIGHT_GREY,
    marginTop: 4,
  },
  banner: {
    flexDirection: "row",
    backgroundColor: C.MINT_GREEN,
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    marginTop: 4,
  },
  bannerLeft: {
    flex: 1,
    paddingRight: 8,
  },
  bannerLabel: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: C.DARK_GREY,
    letterSpacing: 1,
    marginBottom: 2,
  },
  bannerCenter: {
    flex: 1,
    alignItems: "center",
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: C.DARK_GREEN + "33",
    paddingHorizontal: 10,
  },
  bannerBigNum: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: C.DARK_GREEN,
  },
  bannerRight: {
    flex: 1,
    alignItems: "flex-end",
    paddingLeft: 8,
  },
  bannerDetail: {
    fontSize: 8,
    color: C.DARK_GREY,
    textAlign: "right",
  },
});

export function Page1Overview({ data }: { data: PdfReportData }) {
  const d = data.overview;
  const vs = data.strVsLtl;

  return (
    <Page size="A4" style={BASE_PAGE_STYLES.page}>
      <HeaderBar />
      <FooterBar />

      <H1>{data.property.address}</H1>
      <Subtitle>
        {data.property.bedrooms} Bedrooms · Sleeps {data.property.sleeps} ·
        Short-Term Rental Analysis
      </Subtitle>
      <Divider />

      <SectionLabel>TOP MARKET POTENTIAL</SectionLabel>

      {/* 4 metric cards */}
      <View style={s.metricsRow}>
        <MetricCard
          label="Gross Revenue"
          value={formatGbp(d.grossRevenue)}
          sub={`${formatGbp(d.grossMonthly)} per month`}
        />
        <MetricCard
          label="Net Revenue"
          value={formatGbp(d.netRevenue)}
          sub={`${formatGbp(d.netMonthly)} per month (after all fees)`}
        />
        <MetricCard
          label="Avg Nightly Rate"
          value={formatGbp(d.adr)}
          sub="ADR across comp set"
        />
        <MetricCard
          label="Occupancy Rate"
          value={formatPercent(d.occupancy)}
          sub={`Market average ${formatPercent(d.marketOccupancy)}`}
        />
      </View>

      {/* Estimated Property Value Range */}
      {d.valueConservative !== null && d.valueUpper !== null && (
        <>
          <SectionLabel>ESTIMATED PROPERTY VALUE RANGE</SectionLabel>
          <View style={s.valueRow}>
            <View style={s.valueBox}>
              <Text style={s.valueLabel}>CONSERVATIVE</Text>
              <Text style={s.valueAmount}>
                {formatGbp(d.valueConservative)}
              </Text>
            </View>
            <View style={s.valueBox}>
              <Text style={s.valueLabel}>UPPER ESTIMATE</Text>
              <Text style={s.valueAmount}>{formatGbp(d.valueUpper)}</Text>
            </View>
          </View>
          <Text style={s.valueSource}>Source: PropertyData</Text>
        </>
      )}

      {/* STR vs LTL banner */}
      <View style={s.banner}>
        <View style={s.bannerLeft}>
          <Text style={s.bannerLabel}>SHORT-TERM vs LONG-TERM LET</Text>
        </View>
        <View style={s.bannerCenter}>
          <Text style={s.bannerBigNum}>
            +{formatGbp(vs.annualDiff)} / year
          </Text>
        </View>
        <View style={s.bannerRight}>
          <Text style={s.bannerDetail}>
            +{vs.percentUplift}% vs long-term let
          </Text>
          <Text style={s.bannerDetail}>
            +{formatGbp(vs.monthlyDiff)} / month
          </Text>
        </View>
      </View>
    </Page>
  );
}
