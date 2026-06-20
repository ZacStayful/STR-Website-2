import React from "react";
import { Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_COLORS } from "../theme";
import { HeaderBar, FooterBar, formatGbpSigned } from "../components/Chrome";
import { H2, Subtitle, Divider, BASE_PAGE_STYLES } from "../components/Primitives";
import type { PdfReportData } from "../derive";

const C = PDF_COLORS;

const s = StyleSheet.create({
  stepsRow: {
    flexDirection: "row",
    gap: 0,
    marginBottom: 12,
    borderRadius: 8,
    overflow: "hidden",
  },
  stepCard: {
    flex: 1,
    backgroundColor: C.MINT_GREEN + "55",
    padding: 12,
    borderRightWidth: 1,
    borderRightColor: C.CREAM,
  },
  stepCardLast: {
    borderRightWidth: 0,
  },
  stepNum: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: C.DARK_GREEN,
    marginBottom: 4,
  },
  stepTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: C.DARK_GREEN,
    marginBottom: 4,
  },
  stepBody: {
    fontSize: 7.5,
    color: C.DARK_GREY,
  },
  metricsTable: {
    marginBottom: 14,
  },
  metricRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderLeftWidth: 3,
    borderLeftColor: C.DARK_GREEN,
  },
  metricRowAlt: {
    backgroundColor: C.ROW_STRIPE,
  },
  metricLeft: { flex: 1 },
  metricRight: { flex: 2 },
  metricValue: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: C.DARK_GREEN,
    marginBottom: 2,
  },
  metricLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: C.DARK_GREY,
  },
  metricDesc: {
    fontSize: 8,
    color: C.DARK_GREY,
  },
  ctaBox: {
    backgroundColor: C.MINT_GREEN + "55",
    borderRadius: 10,
    padding: 20,
    alignItems: "center",
  },
  ctaHeading: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: C.DARK_GREEN,
    textAlign: "center",
    marginBottom: 8,
  },
  ctaBody: {
    fontSize: 9,
    color: C.DARK_GREY,
    textAlign: "center",
    marginBottom: 12,
    maxWidth: 420,
  },
  ctaContact: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: C.DARK_GREEN,
    textAlign: "center",
  },
});

const STEPS = [
  {
    title: "Platform Launch",
    body: "Go live on Airbnb and Booking.com. Build early demand, bookings and reviews.",
  },
  {
    title: "Data Collection",
    body: "Track which guest types, stay lengths and price points perform best.",
  },
  {
    title: "Direct Bookings",
    body: "Convert repeat guests to lower-cost direct bookings, eliminating platform fees.",
  },
  {
    title: "The Result",
    body: "Higher share of profitable, repeat, lower-friction bookings. Less admin. More income.",
  },
];

export function Page5Growth({ data }: { data: PdfReportData }) {
  const g = data.growth;

  const metrics = [
    {
      label: "Direct Bookings by Month 36",
      value: `${g.directBookingPctMonth36}%`,
      desc: "Platform fee eliminated on half your revenue",
    },
    {
      label: "Repeat Customers Built",
      value: String(g.repeatCustomers),
      desc: "Built organically over 3 years",
    },
    {
      label: "Platform Fee Savings",
      value: `${g.platformFeeSavingsPct}%`,
      desc: "Eliminated on all direct bookings",
    },
    {
      label: "Extra Monthly Profit by Yr 3",
      value: formatGbpSigned(g.extraMonthlyProfitYr3),
      desc: "Over and above Year 1 baseline",
    },
  ];

  return (
    <Page size="A4" style={BASE_PAGE_STYLES.page}>
      <HeaderBar />
      <FooterBar />

      <H2>Stayful&apos;s Plan for Profitability</H2>
      <Subtitle>
        How we systematically build direct bookings to increase your returns —
        without any extra effort from you.
      </Subtitle>

      {/* 4-step card row */}
      <View style={s.stepsRow}>
        {STEPS.map((step, i) => (
          <View
            key={step.title}
            style={i === STEPS.length - 1 ? [s.stepCard, s.stepCardLast] : s.stepCard}
          >
            <Text style={s.stepNum}>Step {i + 1}</Text>
            <Text style={s.stepTitle}>{step.title}</Text>
            <Text style={s.stepBody}>{step.body}</Text>
          </View>
        ))}
      </View>

      <Divider />
      <H2>36-Month Income Growth Projection</H2>

      {/* Metrics table */}
      <View style={s.metricsTable}>
        {metrics.map((m, i) => (
          <View key={m.label} style={i % 2 === 1 ? [s.metricRow, s.metricRowAlt] : s.metricRow}>
            <View style={s.metricLeft}>
              <Text style={s.metricValue}>{m.value}</Text>
              <Text style={s.metricLabel}>{m.label}</Text>
            </View>
            <View style={s.metricRight}>
              <Text style={s.metricDesc}>{m.desc}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* CTA Box */}
      <View style={s.ctaBox}>
        <Text style={s.ctaHeading}>Ready to maximise your rental income?</Text>
        <Text style={s.ctaBody}>
          Stayful handles everything — listing setup, guest management, cleaning
          coordination, pricing optimisation, and direct booking growth — so you
          earn more without the effort.
        </Text>
        <Text style={s.ctaContact}>
          07471 321 997   ·   stayful.co.uk   ·   Book via the link in your email
        </Text>
      </View>
    </Page>
  );
}
