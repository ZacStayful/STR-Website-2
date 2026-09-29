import React from "react";
import { View, Text } from "@react-pdf/renderer";
import { C } from "../design/tokens";
import { T } from "../design/typography";
import type { ReportChrome } from "../design/Chrome";
import { Card, Chip, Eyebrow, Headline, Lead, Rule } from "../design/Primitives";
import { eyebrow, type Nav } from "../sections";
import { Sheet } from "./Sheet";
import type { PdfProject, PdfProjectFigure } from "../derive";

/**
 * The project page (Batch 17), on a Project deal's Full analysis only: the
 * works line by line with why, the value after works and the value added,
 * the money a project takes, and the reader's own locked figures when they
 * have some. No photos: the estimate's photos stay on the deal sheet.
 *
 * Allowed to wrap, like the setup page: the works table is as long as the
 * property needs, and each row stays whole.
 */

function Figures({ items }: { items: PdfProjectFigure[] }) {
  const rows: PdfProjectFigure[][] = [];
  for (let i = 0; i < items.length; i += 4) rows.push(items.slice(i, i + 4));
  return (
    <View>
      {rows.map((row, ri) => (
        <View key={ri} style={{ flexDirection: "row", gap: 9, marginBottom: 9 }} wrap={false}>
          {row.map((m) => (
            <Card key={m.label} style={{ flex: 1 }}>
              <Text style={T.label}>{m.label.toUpperCase()}</Text>
              {/* A range ("£128,606–£136,806") steps down so it stays inside its card. */}
              <Text style={[T.figureMd, { marginTop: 5 }, m.value.length > 10 ? { fontSize: 10.5 } : {}]}>{m.value}</Text>
              {m.sub ? <Text style={[T.body, { marginTop: 3, color: C.TEXT_MUTED }]}>{m.sub}</Text> : null}
            </Card>
          ))}
          {/* Keep the cards the same width on a short last row. */}
          {Array.from({ length: 4 - row.length }).map((_, i) => (
            <View key={`pad-${i}`} style={{ flex: 1 }} />
          ))}
        </View>
      ))}
    </View>
  );
}

export function PageProject({ data, chrome, nav }: { data: PdfProject; chrome: ReportChrome; nav: Nav }) {
  return (
    <Sheet chrome={chrome} nav={nav} wrap continued>
      <Eyebrow>{eyebrow(nav)}</Eyebrow>
      <View style={{ marginTop: 4 }}>
        <Headline>The project</Headline>
        <Lead>{data.heading}</Lead>
      </View>

      <View style={{ marginTop: 14 }}>
        <Figures items={data.metrics} />
      </View>

      <View style={{ marginTop: 6 }}>
        <Text style={T.label}>THE WORKS, LINE BY LINE</Text>
        <View style={{ flexDirection: "row", marginTop: 6 }} fixed>
          <Text style={[T.tableHead, { width: 110 }]}>WORKS</Text>
          <Text style={[T.tableHead, { width: 70 }]}>QUANTITY</Text>
          <Text style={[T.tableHead, { width: 60, textAlign: "right" }]}>COST</Text>
          <Text style={[T.tableHead, { flex: 1, marginLeft: 12 }]}>FROM THE PHOTOS</Text>
        </View>
        <Rule style={{ marginTop: 4, backgroundColor: C.INK }} />
        {data.lines.map((l) => (
          <View key={l.label} wrap={false}>
            <View style={{ flexDirection: "row", paddingVertical: 3.4, alignItems: "flex-start" }}>
              <Text style={[T.bodyBold, { width: 110 }]}>{l.label}</Text>
              <Text style={[T.body, { width: 70, color: C.TEXT_MUTED }]}>{l.quantity}</Text>
              <Text style={[T.bodyBold, { width: 60, textAlign: "right" }]}>{l.cost}</Text>
              <View style={{ flex: 1, marginLeft: 12, flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
                <Chip solid={l.status === "NEEDED"}>{l.status}</Chip>
                {l.reason ? <Text style={[T.body, { flex: 1, color: C.TEXT_MUTED }]}>{l.reason}</Text> : null}
              </View>
            </View>
            <Rule />
          </View>
        ))}
        <Text style={[T.body, { marginTop: 6, color: C.TEXT_MUTED, lineHeight: 1.4 }]}>{data.worksNote}</Text>
      </View>

      <View style={{ marginTop: 14 }} wrap={false}>
        <Text style={[T.label, { marginBottom: 6 }]}>THE MONEY</Text>
        <Figures items={data.money} />
      </View>

      {data.mine ? (
        <View style={{ marginTop: 6 }} wrap={false}>
          <Text style={T.label}>YOUR FIGURES</Text>
          <Text style={[T.body, { marginTop: 3, marginBottom: 6 }]}>{data.mine.line}</Text>
          <Figures items={data.mine.metrics} />
        </View>
      ) : null}

      <Text style={[T.body, { marginTop: 8, color: C.TEXT_MUTED, lineHeight: 1.4 }]} wrap={false}>{data.disclaimer}</Text>
    </Sheet>
  );
}
