import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_COLORS } from "../theme";
import { HeaderBar, FooterBar, formatGbp } from "../components/Chrome";
import { H1, Subtitle, MetricCard, Divider, BASE_PAGE_STYLES } from "../components/Primitives";
import { Page7Deal } from "../pages/Page7Deal";
import type { PdfDeal } from "../derive";

const C = PDF_COLORS;
const s = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, marginBottom: 10 },
  meta: { fontSize: 9, color: C.DARK_GREY, marginBottom: 4 },
  note: { fontSize: 8, color: C.DARK_GREY, marginTop: 10, lineHeight: 1.4 },
});

export interface DealSheetData {
  title: string;
  address: string | null;
  sourceLabel: string;
  sourceUrl: string;
  price: string | null;
  bedrooms: number | null;
  estimate: { revenue: number; adr: number | null; occupancy: number | null; note: string } | null;
  area: { name: string; score: number | null; grade: string | null; competition: string | null; directBooking: string | null; licensing: string } | null;
  tracked: { revenue: number; adr: number; occupancy: number; reviews: number } | null;
  deal: PdfDeal | null;
  generatedAt: string;
}

export function DealSheet({ data }: { data: DealSheetData }) {
  return (
    <Document title={`Stayful deal sheet: ${data.title}`} author="Stayful Intelligence">
      <Page size="A4" style={BASE_PAGE_STYLES.page}>
        <HeaderBar />
        <FooterBar />
        <H1>{data.title}</H1>
        <Subtitle>{[data.address, data.bedrooms !== null ? `${data.bedrooms} bed` : null, data.price].filter(Boolean).join(" · ")}</Subtitle>
        <Text style={s.meta}>Source: {data.sourceLabel} ({data.sourceUrl}) · Generated {data.generatedAt}</Text>
        <Divider />
        <View style={s.row}>
          <MetricCard label="Est. revenue / yr" value={data.estimate ? formatGbp(data.estimate.revenue) : "—"} sub={data.estimate?.adr ? `${formatGbp(data.estimate.adr)} / night` : undefined} />
          <MetricCard label="Occupancy" value={data.estimate?.occupancy != null ? `${Math.round(data.estimate.occupancy)}%` : "—"} />
          <MetricCard label="Area score" value={data.area?.score != null ? `${data.area.score} · ${data.area.grade}` : "—"} sub={data.area?.name} />
          <MetricCard label="Competition" value={data.area?.competition ?? "—"} sub={data.area?.directBooking ? `${data.area.directBooking} direct booking` : undefined} />
        </View>
        {data.tracked && (
          <View style={s.row}>
            <MetricCard label="This listing earns" value={formatGbp(data.tracked.revenue)} sub="trailing 12 months" />
            <MetricCard label="Nightly rate" value={formatGbp(data.tracked.adr)} />
            <MetricCard label="Occupancy" value={`${Math.round(data.tracked.occupancy * 100)}%`} />
            <MetricCard label="Reviews" value={String(data.tracked.reviews)} />
          </View>
        )}
        <Text style={s.note}>{data.area ? `Licensing: ${data.area.licensing}. ` : ""}{data.estimate ? `${data.estimate.note}. ` : ""}Estimates from Stayful Intelligence and its data partners. Not financial advice.</Text>
      </Page>
      {data.deal && <Page7Deal deal={data.deal} />}
    </Document>
  );
}
