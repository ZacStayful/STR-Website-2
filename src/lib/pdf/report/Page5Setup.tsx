import React from "react";
import { View, Text } from "@react-pdf/renderer";
import { C, RAMP, PAGE } from "../design/tokens";
import { T } from "../design/typography";
import type { ReportChrome } from "../design/Chrome";
import { Eyebrow, Headline, Lead, Notice, Rule, Swatch } from "../design/Primitives";
import { SegmentedBar } from "../design/charts/Charts";
import { paybackMonths } from "../design/charts/geometry";
import { formatGbp } from "../format";
import { eyebrow, type Nav } from "../sections";
import { Sheet } from "./Sheet";
import type { PdfReportData, PdfSetupSnapshot } from "../derive";

/**
 * Page five: what it costs to open the door.
 *
 * The one page allowed to wrap. A fully furnished three-bed runs to well over
 * twenty line items, and a quote that hides half of them is not a quote — so
 * the table flows onto a continuation sheet and the footer says so.
 */
export function Page5Setup({
  data, chrome, nav, monthlyGain,
}: {
  data: PdfReportData;
  chrome: ReportChrome;
  nav: Nav;
  monthlyGain: number;
}) {
  const setup = data.setup as PdfSetupSnapshot;
  const payback = paybackMonths(setup.grandTotal, monthlyGain);
  const categories = [...setup.categories].sort((a, b) => b.subtotal - a.subtotal);
  const colourOf = (i: number) => RAMP[i % RAMP.length];

  return (
    <Sheet chrome={chrome} nav={nav} wrap continued>
      <Eyebrow>{eyebrow(nav)}</Eyebrow>
      <View style={{ marginTop: 4 }}>
        <Headline>What it takes to get launch-ready</Headline>
        <Lead>Itemised estimate for this property, fully furnished. All figures inclusive, supplier noted per item.</Lead>
      </View>

      <View style={{ marginTop: 10 }}>
        <Notice title="Indicative estimate">
          If you didn&rsquo;t give us your property&rsquo;s setup details when you enquired, these figures are based on a typical property of this size and may be inaccurate. Your actual costs, and the payback period, could be higher or lower.
        </Notice>
      </View>

      {/* ── Total and payback ── */}
      <View style={{ backgroundColor: C.INK, borderRadius: 3, padding: 16, marginTop: 10, flexDirection: "row", gap: 20 }}>
        <View style={{ flex: 1 }}>
          <Text style={T.labelOnDark}>TOTAL SETUP INVESTMENT</Text>
          <Text style={[T.figureXl, { marginTop: 5 }]}>{formatGbp(setup.grandTotal)}</Text>
          <Text style={[T.labelOnDark, { marginTop: 5 }]}>
            {`${setup.furnishingLabel.toUpperCase()} · ${setup.bedrooms} ${setup.bedrooms === 1 ? "BEDROOM" : "BEDROOMS"} · ${setup.itemCount} ITEMS`}
          </Text>
        </View>
        <View style={{ width: 0.7, backgroundColor: C.CREAM, opacity: 0.3 }} />
        <View style={{ flex: 1 }}>
          <Text style={T.labelOnDark}>PAYBACK · INDICATIVE</Text>
          {payback !== null ? (
            <>
              <Text style={[T.figureAccent, { fontSize: 26, marginTop: 5 }]}>
                {`≈${payback} ${payback === 1 ? "month" : "months"}`}
              </Text>
              <Text style={[T.bodyOnDark, { marginTop: 6, lineHeight: 1.4 }]}>
                {`${formatGbp(setup.grandTotal)} ÷ ${formatGbp(monthlyGain)} a month extra over a long-term let.`}
              </Text>
            </>
          ) : (
            <Text style={[T.bodyOnDark, { marginTop: 6, lineHeight: 1.4 }]}>
              This property is not projected to out-earn a long-term let, so there is no payback period to quote.
            </Text>
          )}
        </View>
      </View>

      {/* ── Where it goes ── */}
      <View style={{ marginTop: 12 }}>
        <SegmentedBar
          values={categories.map((c) => c.subtotal)}
          colors={categories.map((_, i) => colourOf(i))}
          scaleMax={setup.grandTotal}
          width={PAGE.CONTENT}
          height={14}
        />
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 7 }}>
          {categories.map((c, i) => (
            <View key={c.category} style={{ flexDirection: "row", alignItems: "center", marginRight: 14, marginBottom: 3 }}>
              <Swatch color={colourOf(i)} />
              <Text style={T.metaMuted}>{`${c.category} ${formatGbp(c.subtotal)}`}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── Every line ── */}
      <View style={{ marginTop: 10 }}>
        <View style={{ flexDirection: "row" }} fixed>
          <Text style={[T.tableHead, { flex: 1 }]}>ITEM</Text>
          <Text style={[T.tableHead, { width: 76, textAlign: "right" }]}>SUPPLIER</Text>
          <Text style={[T.tableHead, { width: 34, textAlign: "right" }]}>QTY</Text>
          <Text style={[T.tableHead, { width: 52, textAlign: "right" }]}>UNIT</Text>
          <Text style={[T.tableHead, { width: 58, textAlign: "right" }]}>TOTAL</Text>
        </View>
        <Rule style={{ marginTop: 4, backgroundColor: C.INK }} />

        {categories.map((cat, ci) => (
          // Keeping a category header with its first rows stops a heading
          // stranding itself at the foot of a sheet.
          <View key={cat.category} wrap={false} style={{ marginTop: ci === 0 ? 2 : 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 4 }}>
              <Swatch color={colourOf(ci)} />
              <Text style={[T.label, { flex: 1 }]}>{cat.category.toUpperCase()}</Text>
              <Text style={[T.bodyBold, { width: 58, textAlign: "right" }]}>{formatGbp(cat.subtotal)}</Text>
            </View>
            <Rule />
            {cat.items.map((item) => (
              <View key={item.id}>
                <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 3.4, paddingLeft: 10 }}>
                  <Text style={[T.body, { flex: 1, paddingRight: 8, maxLines: 1, textOverflow: "ellipsis" }]}>{item.name}</Text>
                  <Text style={[T.metaMuted, { width: 76, textAlign: "right" }]}>{item.supplier}</Text>
                  <Text style={[T.metaMuted, { width: 34, textAlign: "right" }]}>{item.qty}</Text>
                  <Text style={[T.metaMuted, { width: 52, textAlign: "right" }]}>{formatGbp(item.unitCost)}</Text>
                  <Text style={[T.body, { width: 58, textAlign: "right" }]}>{formatGbp(item.total)}</Text>
                </View>
                <Rule />
              </View>
            ))}
          </View>
        ))}

        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 8 }} wrap={false}>
          <View style={{ flex: 1, height: 1, backgroundColor: C.INK }} />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 }} wrap={false}>
          <Text style={T.label}>GRAND TOTAL</Text>
          <Text style={[T.figureLg]}>{formatGbp(setup.grandTotal)}</Text>
        </View>
      </View>
    </Sheet>
  );
}
