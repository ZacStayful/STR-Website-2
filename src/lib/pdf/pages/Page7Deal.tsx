import React from "react";
import { Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_COLORS } from "../theme";
import { HeaderBar, FooterBar, formatGbp } from "../components/Chrome";
import { H2, Subtitle, MetricCard, Divider, BASE_PAGE_STYLES } from "../components/Primitives";
import type { PdfDeal } from "../derive";

const C = PDF_COLORS;

const s = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, marginBottom: 8 },
  note: { fontSize: 8, color: C.DARK_GREY, marginTop: 6, lineHeight: 1.4 },
  thRow: { flexDirection: "row", backgroundColor: C.DARK_GREEN, paddingVertical: 3, paddingHorizontal: 6, borderTopLeftRadius: 4, borderTopRightRadius: 4, marginTop: 8 },
  th: { fontSize: 7, fontFamily: "Helvetica-Bold", color: C.WHITE },
  tdRow: { flexDirection: "row", paddingVertical: 2.5, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: C.CREAM },
  td: { fontSize: 8, color: C.DARK_GREY },
  tdBold: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.DARK_GREY },
  cMonth: { flex: 2 },
  cNum: { flex: 2, textAlign: "right" },
  source: { fontSize: 8, color: C.DARK_GREY, marginBottom: 8 },
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Deal economics page: purchase or rent-to-rent, plus the monthly cashflow table. */
export function Page7Deal({ deal }: { deal: PdfDeal }) {
  return (
    <Page size="A4" style={BASE_PAGE_STYLES.page}>
      <HeaderBar />
      <FooterBar />
      <H2>{deal.kind === "purchase" ? "The Deal: If You Bought It" : "The Deal: Rent-to-Rent"}</H2>
      <Subtitle>{deal.basisLabel}</Subtitle>
      {deal.sourceUrl ? <Text style={s.source}>Source listing: {deal.sourceUrl}</Text> : null}

      <View style={s.row}>
        {deal.metrics.slice(0, 4).map((m) => (
          <MetricCard key={m.label} label={m.label} value={m.value} sub={m.sub} />
        ))}
      </View>
      <View style={s.row}>
        {deal.metrics.slice(4, 8).map((m) => (
          <MetricCard key={m.label} label={m.label} value={m.value} sub={m.sub} />
        ))}
      </View>

      {deal.cashflow.length > 0 && (
        <>
      <Divider />

      <View style={s.thRow}>
        <Text style={[s.th, s.cMonth]}>Month</Text>
        <Text style={[s.th, s.cNum]}>Revenue</Text>
        <Text style={[s.th, s.cNum]}>Running costs</Text>
        <Text style={[s.th, s.cNum]}>{deal.kind === "purchase" ? "Mortgage" : "Rent"}</Text>
        <Text style={[s.th, s.cNum]}>Net</Text>
      </View>
      {deal.cashflow.map((m) => (
        <View key={m.month} style={s.tdRow}>
          <Text style={[s.tdBold, s.cMonth]}>{MONTHS[m.month - 1]}</Text>
          <Text style={[s.td, s.cNum]}>{formatGbp(m.revenue)}</Text>
          <Text style={[s.td, s.cNum]}>{formatGbp(m.operating)}</Text>
          <Text style={[s.td, s.cNum]}>{formatGbp(m.fixed)}</Text>
          <Text style={[m.net < 0 ? s.tdBold : s.td, s.cNum]}>{m.net < 0 ? `-${formatGbp(Math.abs(m.net))}` : formatGbp(m.net)}</Text>
        </View>
      ))}
        </>
      )}

      <Text style={s.note}>{deal.note}</Text>
    </Page>
  );
}
