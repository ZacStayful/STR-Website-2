import React from "react";
import { Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_COLORS } from "../theme";
import { HeaderBar, FooterBar, formatGbp, formatPercent, formatGbpSigned } from "../components/Chrome";
import { H2, Divider, BASE_PAGE_STYLES } from "../components/Primitives";
import type { PdfReportData, PdfMonth } from "../derive";

const C = PDF_COLORS;

const s = StyleSheet.create({
  tablesRow: { flexDirection: "row", gap: 12, marginBottom: 10 },
  tableWrap: { flex: 1 },
  tableTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: C.DARK_GREEN,
    textAlign: "center",
    marginBottom: 4,
  },
  thRow: {
    flexDirection: "row",
    backgroundColor: C.DARK_GREEN,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  thRowAlt: { backgroundColor: C.DARK_GREEN_2 },
  thCell: { fontSize: 7, fontFamily: "Helvetica-Bold", color: C.WHITE },
  tdRow: {
    flexDirection: "row",
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: C.CREAM,
  },
  tdRowTotal: { backgroundColor: C.CREAM },
  tdRowNet: {
    backgroundColor: C.DARK_GREEN,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
  tdRowNetAlt: {
    backgroundColor: C.DARK_GREEN_2,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
  tdCell: { fontSize: 8, color: C.DARK_GREY },
  tdCellBold: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.DARK_GREY },
  tdCellWhite: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.WHITE },
  colLabel: { flex: 3 },
  colAnnual: { flex: 2, textAlign: "right" },
  colMonthly: { flex: 2, textAlign: "right" },
  // Bar chart
  chartWrap: { flexDirection: "row", alignItems: "flex-end", height: 80, gap: 4, marginBottom: 6, marginTop: 6 },
  barCol: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  barLabel: { fontSize: 6, color: C.DARK_GREY, marginTop: 2 },
  barValue: { fontSize: 6, fontFamily: "Helvetica-Bold", color: C.DARK_GREY, marginBottom: 1 },
  // Forecast table
  forecastThRow: {
    flexDirection: "row",
    backgroundColor: C.DARK_GREEN,
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  forecastRow: {
    flexDirection: "row",
    paddingVertical: 2.5,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: C.CREAM,
  },
  forecastPeakRow: { backgroundColor: C.MINT_GREEN + "55" },
  fCol1: { flex: 3 },
  fCol2: { flex: 2, textAlign: "right" },
  fCol3: { flex: 2, textAlign: "right" },
  fCol4: { flex: 1.5, textAlign: "right" },
});

type RowVariant = "default" | "total" | "net" | "netAlt";

function BreakdownRow({
  label,
  annual,
  monthly,
  variant = "default",
}: {
  label: string;
  annual: string;
  monthly: string;
  variant?: RowVariant;
}) {
  const rowExtra =
    variant === "total" ? s.tdRowTotal :
    variant === "net" ? s.tdRowNet :
    variant === "netAlt" ? s.tdRowNetAlt :
    null;
  const cell =
    variant === "total" ? s.tdCellBold :
    variant === "net" || variant === "netAlt" ? s.tdCellWhite :
    s.tdCell;
  return (
    <View style={rowExtra ? [s.tdRow, rowExtra] : s.tdRow}>
      <Text style={[cell, s.colLabel]}>{label}</Text>
      <Text style={[cell, s.colAnnual]}>{annual}</Text>
      <Text style={[cell, s.colMonthly]}>{monthly}</Text>
    </View>
  );
}

function ForecastRow({ m }: { m: PdfMonth }) {
  return (
    <View style={m.peak ? [s.forecastRow, s.forecastPeakRow] : s.forecastRow}>
      <Text style={[m.peak ? s.tdCellBold : s.tdCell, s.fCol1]}>
        {m.month}{m.peak ? " ★" : ""}
      </Text>
      <Text style={[m.peak ? s.tdCellBold : s.tdCell, s.fCol2]}>
        {formatGbp(m.net)}
      </Text>
      <Text style={[m.peak ? s.tdCellBold : s.tdCell, s.fCol3]}>
        {formatGbpSigned(m.vsLtl)}
      </Text>
      <Text style={[s.tdCell, s.fCol4]}>{formatPercent(m.occupancy)}</Text>
    </View>
  );
}

export function Page2Revenue({ data }: { data: PdfReportData }) {
  const str = data.shortLetAnnual;
  const ltl = data.longLetAnnual;
  const maxNet = Math.max(...data.monthly.map((m) => m.net), 1);

  return (
    <Page size="A4" style={BASE_PAGE_STYLES.page}>
      <HeaderBar />
      <FooterBar />

      <H2>Revenue Breakdown</H2>

      <View style={s.tablesRow}>
        {/* STR table */}
        <View style={s.tableWrap}>
          <Text style={s.tableTitle}>Short-Term Rental</Text>
          <View style={s.thRow}>
            <Text style={[s.thCell, s.colLabel]}>Item</Text>
            <Text style={[s.thCell, s.colAnnual]}>Annual</Text>
            <Text style={[s.thCell, s.colMonthly]}>Monthly</Text>
          </View>
          <BreakdownRow label="Gross Revenue" annual={formatGbp(str.gross)} monthly={formatGbp(str.gross / 12)} />
          <BreakdownRow label="Platform Fees (15%)" annual={`−${formatGbp(str.platformFee)}`} monthly={`−${formatGbp(str.platformFee / 12)}`} />
          <BreakdownRow label="Management Fees (15%)" annual={`−${formatGbp(str.managementFee)}`} monthly={`−${formatGbp(str.managementFee / 12)}`} />
          <BreakdownRow label="Cleaning & Laundry (18%)" annual={`−${formatGbp(str.cleaning)}`} monthly={`−${formatGbp(str.cleaning / 12)}`} />
          <BreakdownRow label={`Total Operating Costs (48%)`} annual={`−${formatGbp(str.totalCosts)}`} monthly={`−${formatGbp(str.totalCosts / 12)}`} variant="total" />
          <BreakdownRow label="NET ANNUAL REVENUE" annual={formatGbp(str.net)} monthly={formatGbp(str.net / 12)} variant="net" />
        </View>

        {/* LTL table */}
        <View style={s.tableWrap}>
          <Text style={[s.tableTitle, { color: C.DARK_GREEN_2 }]}>Long-Term Let</Text>
          <View style={[s.thRow, s.thRowAlt]}>
            <Text style={[s.thCell, s.colLabel]}>Item</Text>
            <Text style={[s.thCell, s.colAnnual]}>Annual</Text>
            <Text style={[s.thCell, s.colMonthly]}>Monthly</Text>
          </View>
          <BreakdownRow label="Gross Rental Income" annual={formatGbp(ltl.gross)} monthly={formatGbp(ltl.gross / 12)} />
          <BreakdownRow label="Letting Agent Fees (10%)" annual={`−${formatGbp(ltl.agentFee)}`} monthly={`−${formatGbp(ltl.agentFee / 12)}`} />
          <BreakdownRow label="NET ANNUAL REVENUE" annual={formatGbp(ltl.net)} monthly={formatGbp(ltl.net / 12)} variant="netAlt" />
        </View>
      </View>

      <Divider />
      <H2>12-Month Revenue Forecast</H2>

      {/* Bar chart */}
      <View style={s.chartWrap}>
        {data.monthly.map((m) => {
          const h = Math.max(4, (m.net / maxNet) * 70);
          return (
            <View key={m.month} style={s.barCol}>
              <Text style={s.barValue}>{formatGbp(m.net)}</Text>
              <View
                style={{
                  width: "80%",
                  height: h,
                  backgroundColor: m.peak ? C.DARK_GREEN : C.MINT_GREEN,
                  borderTopLeftRadius: 2,
                  borderTopRightRadius: 2,
                }}
              />
              <Text style={s.barLabel}>{m.month.slice(0, 3)}</Text>
            </View>
          );
        })}
      </View>

      {/* Forecast table */}
      <View style={s.forecastThRow}>
        <Text style={[s.thCell, s.fCol1]}>Month</Text>
        <Text style={[s.thCell, s.fCol2]}>Net Revenue</Text>
        <Text style={[s.thCell, s.fCol3]}>vs Long-Let</Text>
        <Text style={[s.thCell, s.fCol4]}>Occ</Text>
      </View>
      {data.monthly.map((m) => (
        <ForecastRow key={m.month} m={m} />
      ))}
    </Page>
  );
}
