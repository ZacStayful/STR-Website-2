import React from "react";
import { View, Text } from "@react-pdf/renderer";
import { C, PAGE, SIZE } from "../design/tokens";
import { T } from "../design/typography";
import { CoverMasthead, type ReportChrome } from "../design/Chrome";
import { Card, Chip, Display, Eyebrow, Columns, StatCard } from "../design/Primitives";
import { EarningsBand, RangeAxis, Meter, SegmentedBar } from "../design/charts/Charts";
import { paybackMonths } from "../design/charts/geometry";
import { formatGbp, formatGbpSigned, formatPercent } from "../format";
import { pad2, type Nav, type Section } from "../sections";
import { Sheet } from "./Sheet";
import type { PdfReportData } from "../derive";

/**
 * Page one: the answer, before any working.
 *
 * Everything here is a headline the rest of the document then justifies, so
 * the hero carries net income — what the owner keeps — rather than the larger
 * and less honest gross figure.
 */
/**
 * The value axis fills the space the two figures leave: the card's inner width
 * less both labels and the gaps either side of the axis.
 */
const VALUE_AXIS_W = PAGE.CONTENT - 20 - 100 - 100 - 24;

export function Page1Verdict({
  data, chrome, nav, contents,
}: {
  data: PdfReportData;
  chrome: ReportChrome;
  nav: Nav;
  contents: Section[];
}) {
  const { overview, strVsLtl, shortLetAnnual, longLetAnnual, property, setup } = data;
  const netMonthly = Math.round(overview.netRevenue / 12);
  // Both bars share one scale, so the gap is as big as it looks.
  const barScale = Math.max(overview.netRevenue, longLetAnnual.net, 1);
  const barW = 232;

  const setupTotal = setup?.grandTotal ?? null;
  const payback = setupTotal !== null ? paybackMonths(setupTotal, strVsLtl.monthlyDiff) : null;

  // The headline steps down for a long address rather than wrapping to a
  // third line and pushing the hero panel off the page.
  const headline = `${property.addressLine}${property.locality ? `, ${property.locality}` : ""}`;
  const displaySize =
    headline.length > 52 ? 21 : headline.length > 38 ? 25 : SIZE.display;

  return (
    <Sheet chrome={chrome} nav={nav} masthead={<CoverMasthead chrome={chrome} />}>
      <View style={{ marginTop: 16 }}>
        <Eyebrow>{`${pad2(nav.index)} — ${nav.label}`}</Eyebrow>
        <View style={{ marginTop: 6 }}>
          <Display size={displaySize}>{headline}</Display>
        </View>
      </View>

      <Columns gap={7} style={{ marginTop: 12 }}>
        <Chip>{`${property.bedrooms} ${property.bedrooms === 1 ? "bedroom" : "bedrooms"}`}</Chip>
        <Chip>{`Sleeps ${property.sleeps}`}</Chip>
        <Chip solid>Short-term let analysis</Chip>
      </Columns>

      {/* ── The hero ── */}
      <View style={{ backgroundColor: C.INK, borderRadius: 3, padding: 18, marginTop: 14, flexDirection: "row", gap: 22 }}>
        <View style={{ flex: 1 }}>
          <Text style={T.labelOnDark}>ESTIMATED NET INCOME · SHORT-TERM LET</Text>
          <Text style={[T.figureXl, { marginTop: 6 }]}>{formatGbp(overview.netRevenue)}</Text>
          <Text style={[T.labelOnDark, { marginTop: 4 }]}>
            {`PER YEAR · ${formatGbp(netMonthly)} / MONTH`}
          </Text>
          <Text style={[T.bodyOnDark, { marginTop: 10, lineHeight: 1.45 }]}>
            {shortLetAnnual.selfManaged
              ? "What you keep after platform, cleaning and laundry costs."
              : "What you keep after platform, management, cleaning and laundry costs."}
          </Text>
        </View>

        <View style={{ width: barW }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={T.labelOnDark}>SHORT-TERM LET</Text>
            <Text style={T.labelOnDark}>{formatGbp(overview.netRevenue)}</Text>
          </View>
          <View style={{ marginTop: 4 }}>
            <SegmentedBar values={[overview.netRevenue]} colors={[C.ACCENT]} scaleMax={barScale} width={barW} height={11} />
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 12 }}>
            <Text style={T.labelOnDark}>LONG-TERM LET</Text>
            <Text style={T.labelOnDark}>{formatGbp(longLetAnnual.net)}</Text>
          </View>
          <View style={{ marginTop: 4 }}>
            <SegmentedBar values={[longLetAnnual.net]} colors={[C.MUTED]} scaleMax={barScale} width={barW} height={11} />
          </View>

          <View style={{ height: 0.7, backgroundColor: C.CREAM, opacity: 0.3, marginTop: 14 }} />
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 5, marginTop: 10 }}>
            <Text style={T.figureAccent}>{`${formatGbpSigned(strVsLtl.annualDiff)}`}</Text>
            <Text style={[T.bodyOnDark, { fontSize: SIZE.lead }]}>/ year</Text>
          </View>
          <Text style={[T.labelOnDark, { marginTop: 4, lineHeight: 1.5 }]}>
            {`${strVsLtl.percentUplift >= 0 ? "+" : ""}${strVsLtl.percentUplift}% VS LONG-TERM LET · ${formatGbpSigned(strVsLtl.monthlyDiff)} / MONTH`}
          </Text>
        </View>
      </View>

      {/* ── Four headline numbers ── */}
      <Columns gap={9} style={{ marginTop: 14 }}>
        <StatCard
          label="Gross revenue"
          value={formatGbp(overview.grossRevenue)}
          sub={`${formatGbp(overview.grossMonthly)} a month before costs`}
        />
        <StatCard
          label="Nightly rate"
          value={formatGbp(overview.adr)}
          sub="Average across the comp set"
        />
        <StatCard label="Occupancy" value={formatPercent(overview.occupancy)}>
          <View style={{ marginTop: 6, marginBottom: 4 }}>
            <Meter value={overview.occupancy * 100} width={92} />
          </View>
          <Text style={[T.body, { color: C.TEXT_MUTED }]}>
            {`Market average ${formatPercent(overview.marketOccupancy)}`}
          </Text>
        </StatCard>
        {/* Without a setup estimate the fourth tile carries the monthly figure
            rather than leaving a gap in the row. */}
        {setupTotal !== null ? (
          <StatCard
            label="Setup cost"
            value={formatGbp(setupTotal)}
            sub={
              payback !== null
                ? `Indicative · recovered in ≈${payback} ${payback === 1 ? "month" : "months"} of extra income vs long-term let`
                : "Indicative · payback not calculable at this income"
            }
          />
        ) : (
          <StatCard
            label="Monthly net"
            value={formatGbp(netMonthly)}
            sub="After platform, management and cleaning"
          />
        )}
      </Columns>

      {/* ── What similar listings earn ── */}
      {data.earnings || data.localTrend ? (
        <Card style={{ marginTop: 14 }}>
          {data.earnings ? (
            <>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={T.label}>WHAT SIMILAR LISTINGS EARN · GROSS A YEAR</Text>
                <Text style={T.metaMuted}>
                  {data.earnings.position
                    ? `OUR ESTIMATE ${formatGbp(data.earnings.estimate)} · ${data.earnings.position.phrase.toUpperCase()}`
                    : `OUR ESTIMATE ${formatGbp(data.earnings.estimate)}`}
                </Text>
              </View>
              <View style={{ marginTop: 8 }}>
                <EarningsBand positions={data.earnings.positions} width={PAGE.CONTENT - 20} />
              </View>
              <Text style={[T.metaMuted, { marginTop: 4 }]}>
                {`BOTTOM QUARTER ${formatGbp(data.earnings.range.p25)} · MIDDLE ${formatGbp(data.earnings.range.p50)} · TOP QUARTER ${formatGbp(data.earnings.range.p75)}${data.earnings.range.p90 !== null ? ` · TOP 10% ${formatGbp(data.earnings.range.p90)}` : ""} · ${data.earnings.range.n} COMPARABLES`}
              </Text>
            </>
          ) : null}
          {data.localTrend ? (
            <Text style={[T.body, { marginTop: data.earnings ? 6 : 0 }]}>{`${data.localTrend}.`}</Text>
          ) : null}
        </Card>
      ) : null}

      {/* ── Property value ── */}
      {overview.valueConservative !== null && overview.valueUpper !== null ? (
        <Card style={{ marginTop: 14 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={T.label}>ESTIMATED PROPERTY VALUE</Text>
            <Text style={T.metaMuted}>Source: PropertyData</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 }}>
            <Text style={T.figureMd}>{formatGbp(overview.valueConservative)}</Text>
            <View style={{ flex: 1, alignItems: "stretch" }}>
              <RangeAxis low={overview.valueConservative} high={overview.valueUpper} width={VALUE_AXIS_W} />
            </View>
            <Text style={T.figureMd}>{formatGbp(overview.valueUpper)}</Text>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
            <Text style={T.metaMuted}>CONSERVATIVE</Text>
            <Text style={T.metaMuted}>UPPER ESTIMATE</Text>
          </View>
        </Card>
      ) : null}

      {/* ── What follows ── */}
      <View style={{ marginTop: "auto", paddingTop: 14, flexDirection: "row", gap: 10 }}>
        {contents.map((section, i) => (
          <View key={section.id} style={{ flex: 1 }}>
            <View style={{ height: 0.9, backgroundColor: C.INK }} />
            <Text style={[T.metaMuted, { marginTop: 5 }]}>{pad2(i + 2)}</Text>
            <Text style={[T.meta, { marginTop: 2 }]}>{section.label}</Text>
          </View>
        ))}
      </View>
    </Sheet>
  );
}
