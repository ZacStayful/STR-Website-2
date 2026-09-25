import React from "react";
import { View, Text } from "@react-pdf/renderer";
import { C, PAGE } from "../design/tokens";
import { T } from "../design/typography";
import type { ReportChrome } from "../design/Chrome";
import { Card, Eyebrow, Headline, Lead, Pill, Rule } from "../design/Primitives";
import { Scatter } from "../design/charts/Charts";
import { formatGbp, formatPercent, formatRatingPlain } from "../format";
import { eyebrow, type Nav } from "../sections";
import { Sheet } from "./Sheet";
import type { PdfReportData } from "../derive";

/** How many comparables the table has room for before it would overrun. */
const MAX_ROWS = 12;

export function Page3Market({
  data, chrome, nav,
}: {
  data: PdfReportData;
  chrome: ReportChrome;
  nav: Nav;
}) {
  const { comparables, compsBenchmark: b, marketTargets: t, overview } = data;
  const rows = comparables.slice(0, MAX_ROWS);
  const hidden = comparables.length - rows.length;

  const cells: Array<[string, string]> = [
    ["NIGHTLY", formatGbp(b.avgNightly)],
    ["OCCUPANCY", formatPercent(b.avgOccupancy)],
    ["ANNUAL", formatGbp(b.avgAnnual)],
    ["RATING", formatRatingPlain(b.avgRating)],
    ["REVIEWS", String(b.avgReviews)],
  ];

  return (
    <Sheet chrome={chrome} nav={nav}>
      <Eyebrow>{eyebrow(nav)}</Eyebrow>
      <View style={{ marginTop: 4 }}>
        <Headline>How it stacks up against the neighbours</Headline>
        <Lead>
          {b.count > 0
            ? `${data.compsLead} · Airbnb data via Airbtics`
            : "No active Airbnb listings were found close enough to compare against."}
        </Lead>
      </View>

      {/* ── Benchmark strip ── */}
      <Card style={{ marginTop: 14, padding: 0, flexDirection: "row" }}>
        {cells.map(([label, value], i) => (
          <View
            key={label}
            style={{
              flex: 1,
              padding: 10,
              borderLeftWidth: i === 0 ? 0 : 0.8,
              borderLeftColor: C.BORDER,
            }}
          >
            <Text style={T.label}>{label}</Text>
            <Text style={[T.figureMd, { marginTop: 4 }]}>{value}</Text>
          </View>
        ))}
      </Card>

      {/* ── Rate against occupancy ── */}
      {rows.length > 0 ? (
        <View style={{ marginTop: 16 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={T.label}>NIGHTLY RATE (ACROSS) VS OCCUPANCY (UP)</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: C.INK }} />
              <Text style={T.metaMuted}>Top 25%</Text>
              <View style={{ width: 5, height: 5, borderRadius: 2.5, borderWidth: 0.8, borderColor: C.MUTED, marginLeft: 6 }} />
              <Text style={T.metaMuted}>Other listings</Text>
            </View>
          </View>
          <View style={{ marginTop: 4 }}>
            <Scatter
              points={rows.map((c) => ({ nightly: c.nightly, occupancy: c.occupancy, top: c.top }))}
              subject={{
                nightly: overview.adr,
                occupancy: overview.occupancy,
                label: `Your property · ${formatGbp(overview.adr)} · ${formatPercent(overview.occupancy)}`,
              }}
              width={PAGE.CONTENT}
              height={132}
            />
          </View>
        </View>
      ) : null}

      {/* ── The comparables ── */}
      <View style={{ marginTop: 14 }}>
        <View style={{ flexDirection: "row" }}>
          <Text style={[T.tableHead, { flex: 1 }]}>LISTING</Text>
          <Text style={[T.tableHead, { width: 52, textAlign: "right" }]}>DIST</Text>
          <Text style={[T.tableHead, { width: 44, textAlign: "right" }]}>NIGHT</Text>
          <Text style={[T.tableHead, { width: 36, textAlign: "right" }]}>OCC</Text>
          <Text style={[T.tableHead, { width: 58, textAlign: "right" }]}>ANNUAL</Text>
          <Text style={[T.tableHead, { width: 30, textAlign: "right" }]}>RTG</Text>
          <Text style={[T.tableHead, { width: 32, textAlign: "right" }]}>TIER</Text>
        </View>
        <Rule style={{ marginTop: 4, backgroundColor: C.INK }} />
        {rows.map((c, i) => (
          <View key={i}>
            <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 3.6 }}>
              {/* A long listing title is clipped rather than wrapped: a second
                  line would push the summary boxes off the sheet. */}
              <Text style={[T.body, { flex: 1, paddingRight: 8, maxLines: 1, textOverflow: "ellipsis" }]}>{c.name}</Text>
              <Text style={[T.metaMuted, { width: 52, textAlign: "right" }]}>{c.distance}</Text>
              <Text style={[T.body, { width: 44, textAlign: "right" }]}>{formatGbp(c.nightly)}</Text>
              <Text style={[T.body, { width: 36, textAlign: "right" }]}>{formatPercent(c.occupancy)}</Text>
              <Text style={[T.body, { width: 58, textAlign: "right" }]}>{formatGbp(c.annual)}</Text>
              <Text style={[T.body, { width: 30, textAlign: "right" }]}>{formatRatingPlain(c.rating)}</Text>
              <View style={{ width: 32, alignItems: "flex-end" }}>
                {c.top ? <Pill>TOP</Pill> : <Text style={T.metaMuted}>—</Text>}
              </View>
            </View>
            <Rule />
          </View>
        ))}
        {hidden > 0 ? (
          <Text style={[T.metaMuted, { marginTop: 5 }]}>
            {`+ ${hidden} further ${hidden === 1 ? "listing" : "listings"} in the comparable set`}
          </Text>
        ) : null}
      </View>

      {/* ── Match it, or beat it ── */}
      <View style={{ marginTop: "auto", paddingTop: 16, flexDirection: "row", gap: 14, alignItems: "stretch" }}>
        <Card style={{ flex: 1, justifyContent: "flex-start" }}>
          <Text style={T.label}>TO MATCH THE MARKET</Text>
          <View style={{ marginTop: 6 }}>
            {[
              ["Nightly rate", formatGbp(t.matchNightly)],
              ["Occupancy", formatPercent(t.matchOccupancy)],
              ["Guest rating", formatRatingPlain(b.avgRating)],
              ["Annual revenue", formatGbp(t.matchRevenue)],
            ].map(([k, v], i) => (
              <View key={k}>
                {i > 0 ? <Rule /> : null}
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                  <Text style={T.body}>{k}</Text>
                  <Text style={T.bodyBold}>{v}</Text>
                </View>
              </View>
            ))}
          </View>
        </Card>
        <View style={{ flex: 1, backgroundColor: C.INK, borderRadius: 2, padding: 10 }}>
          <Text style={T.labelOnDark}>TO BEAT IT · TOP 25%</Text>
          <View style={{ marginTop: 6 }}>
            {[
              ["Nightly rate", formatGbp(t.beatNightly)],
              ["Occupancy", formatPercent(t.beatOccupancy)],
              ["Annual revenue", formatGbp(t.beatRevenue)],
            ].map(([k, v], i) => (
              <View key={k}>
                {i > 0 ? <View style={{ height: 0.6, backgroundColor: C.CREAM, opacity: 0.2 }} /> : null}
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                  <Text style={T.bodyOnDark}>{k}</Text>
                  <Text style={[T.bodyOnDark, { fontWeight: 600 }]}>{v}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      </View>
    </Sheet>
  );
}
