import React from "react";
import { View, Text } from "@react-pdf/renderer";
import { T } from "../design/typography";
import type { ReportChrome } from "../design/Chrome";
import { Card, Eyebrow, Headline, Lead, Rule } from "../design/Primitives";
import { eyebrow, type Nav } from "../sections";
import { formatGbp } from "../format";
import { Sheet } from "./Sheet";
import type { PdfSecondOpinion } from "../derive";

/**
 * Batch 22, Part H: the Deep report's own page. PMI's projection beside ours,
 * month by month, and PMI's comparables laid out like ours. Only in a report
 * that has PMI's second opinion.
 */
export function PageSecondOpinion({ data, oursLabel, chrome, nav }: { data: PdfSecondOpinion; oursLabel: string; chrome: ReportChrome; nav: Nav }) {
  const gap = data.ours > 0 ? Math.round(((data.pmi - data.ours) / data.ours) * 100) : null;
  return (
    <Sheet chrome={chrome} nav={nav}>
      <Eyebrow>{eyebrow(nav)}</Eyebrow>
      <View style={{ marginTop: 4 }}>
        <Headline>A second opinion</Headline>
        <Lead>An independent projection from Property Market Intel, a separate UK dataset, run for this property.</Lead>
      </View>

      <View style={{ flexDirection: "row", gap: 9, marginTop: 14 }}>
        <Card style={{ flex: 1 }}>
          <Text style={T.label}>{oursLabel.toUpperCase()}</Text>
          <Text style={[T.figureMd, { marginTop: 6 }]}>{formatGbp(data.ours)}</Text>
        </Card>
        <Card style={{ flex: 1 }}>
          <Text style={T.label}>PMI PROJECTION</Text>
          <Text style={[T.figureMd, { marginTop: 6 }]}>{formatGbp(data.pmi)}</Text>
          {data.rangeLow !== null && data.rangeHigh !== null ? <Text style={[T.metaMuted, { marginTop: 3 }]}>{`${formatGbp(data.rangeLow)} – ${formatGbp(data.rangeHigh)}`}</Text> : null}
        </Card>
        <Card style={{ flex: 1 }}>
          <Text style={T.label}>AGREEMENT</Text>
          <Text style={[T.figureMd, { marginTop: 6 }]}>{gap === null ? "—" : `${gap > 0 ? "+" : ""}${gap}%`}</Text>
          <Text style={[T.metaMuted, { marginTop: 3 }]}>{`PMI confidence: ${data.confidence}`}</Text>
        </Card>
      </View>

      {data.months.some((m) => m.pmi !== null) ? (
        <View style={{ marginTop: 14 }}>
          <View style={{ flexDirection: "row", paddingVertical: 3 }}>
            <Text style={[T.tableHead, { flex: 2 }]}>MONTH</Text>
            <Text style={[T.tableHead, { flex: 2, textAlign: "right" }]}>{oursLabel.toUpperCase()}</Text>
            <Text style={[T.tableHead, { flex: 2, textAlign: "right" }]}>PMI</Text>
          </View>
          <Rule />
          {data.months.map((m) => (
            <View key={m.month}>
              <View style={{ flexDirection: "row", paddingVertical: 2.5 }}>
                <Text style={[T.body, { flex: 2 }]}>{m.month}</Text>
                <Text style={[T.body, { flex: 2, textAlign: "right" }]}>{m.ours === null ? "—" : formatGbp(m.ours)}</Text>
                <Text style={[T.body, { flex: 2, textAlign: "right" }]}>{m.pmi === null ? "—" : formatGbp(m.pmi)}</Text>
              </View>
              <Rule />
            </View>
          ))}
        </View>
      ) : null}

      {data.comparables.length > 0 ? (
        <View style={{ marginTop: 14 }}>
          <Text style={T.label}>PMI’S COMPARABLES</Text>
          {data.comparables.map((c, i) => (
            <View key={i}>
              <View style={{ flexDirection: "row", paddingVertical: 3, gap: 6 }}>
                <Text style={[T.body, { flex: 3, maxLines: 1, textOverflow: "ellipsis" }]}>{c.title}</Text>
                <Text style={[T.metaMuted, { flex: 4, textAlign: "right" }]}>
                  {[c.annual !== null ? `${formatGbp(c.annual)}/yr` : null, c.nightly !== null ? `${formatGbp(c.nightly)}/night` : null, c.occupancyPct !== null ? `${c.occupancyPct}%` : null, c.distance].filter(Boolean).join(" · ")}
                </Text>
              </View>
              <Rule />
            </View>
          ))}
        </View>
      ) : null}
    </Sheet>
  );
}
