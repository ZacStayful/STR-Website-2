import React from "react";
import { View, Text, Link } from "@react-pdf/renderer";
import { C } from "../design/tokens";
import { T } from "../design/typography";
import type { ReportChrome } from "../design/Chrome";
import { Card, Eyebrow, Headline, Lead, Rule } from "../design/Primitives";
import { formatGbp } from "../format";
import { eyebrow, type Nav } from "../sections";
import { Sheet } from "./Sheet";
import type { PdfDeal } from "../derive";

/**
 * The deal page, for reports that came from a listing.
 *
 * Not in the reference design, which assumes an owner who already has the
 * property. It keeps its own section number so the contents strip and the
 * footers stay honest whether or not it is present.
 */
export function PageDeal({
  deal, chrome, nav,
}: {
  deal: PdfDeal;
  chrome: ReportChrome;
  nav: Nav;
}) {
  const rows = deal.cashflow;
  const title = deal.kind === "purchase" ? "If you bought it" : "If you rented it to re-let";

  return (
    <Sheet chrome={chrome} nav={nav}>
      <Eyebrow>{eyebrow(nav)}</Eyebrow>
      <View style={{ marginTop: 4 }}>
        <Headline>{title}</Headline>
        <Lead>{deal.basisLabel}</Lead>
      </View>

      <View style={{ marginTop: 16 }}>
        {[0, 1].map((rowIndex) => (
          <View key={rowIndex} style={{ flexDirection: "row", gap: 9, marginBottom: 9 }}>
            {deal.metrics.slice(rowIndex * 4, rowIndex * 4 + 4).map((m) => (
              <Card key={m.label} style={{ flex: 1 }}>
                <Text style={T.label}>{m.label.toUpperCase()}</Text>
                <Text style={[T.figureMd, { marginTop: 5 }]}>{m.value}</Text>
                {m.sub ? <Text style={[T.body, { marginTop: 3, color: C.TEXT_MUTED }]}>{m.sub}</Text> : null}
              </Card>
            ))}
          </View>
        ))}
      </View>

      {rows.length > 0 ? (
        <View style={{ marginTop: 8 }}>
          <Text style={T.label}>MONTHLY CASHFLOW</Text>
          <View style={{ flexDirection: "row", marginTop: 6 }}>
            <Text style={[T.tableHead, { flex: 1 }]}>MONTH</Text>
            <Text style={[T.tableHead, { width: 76, textAlign: "right" }]}>REVENUE</Text>
            <Text style={[T.tableHead, { width: 76, textAlign: "right" }]}>OPERATING</Text>
            <Text style={[T.tableHead, { width: 76, textAlign: "right" }]}>FIXED</Text>
            <Text style={[T.tableHead, { width: 76, textAlign: "right" }]}>NET</Text>
          </View>
          <Rule style={{ marginTop: 4, backgroundColor: C.INK }} />
          {rows.map((m) => (
            <View key={m.month}>
              <View style={{ flexDirection: "row", paddingVertical: 3.4 }}>
                <Text style={[T.body, { flex: 1 }]}>{`Month ${m.month}`}</Text>
                <Text style={[T.body, { width: 76, textAlign: "right" }]}>{formatGbp(m.revenue)}</Text>
                <Text style={[T.metaMuted, { width: 76, textAlign: "right" }]}>{`−${formatGbp(m.operating)}`}</Text>
                <Text style={[T.metaMuted, { width: 76, textAlign: "right" }]}>{`−${formatGbp(m.fixed)}`}</Text>
                <Text style={[T.bodyBold, { width: 76, textAlign: "right", color: m.net < 0 ? C.INK : C.INK }]}>
                  {`${m.net < 0 ? "−" : ""}${formatGbp(Math.abs(m.net))}`}
                </Text>
              </View>
              <Rule />
            </View>
          ))}
        </View>
      ) : null}

      <View style={{ marginTop: "auto", paddingTop: 12 }}>
        {deal.sourceUrl ? (
          <Link src={deal.sourceUrl} style={{ textDecoration: "none" }}>
            <Text style={[T.metaMuted, { textDecoration: "underline", maxLines: 1, textOverflow: "ellipsis" }]}>
              {deal.sourceUrl}
            </Text>
          </Link>
        ) : null}
        <Text style={[T.body, { marginTop: 6, color: C.TEXT_MUTED, lineHeight: 1.4 }]}>{deal.note}</Text>
      </View>
    </Sheet>
  );
}
