import React from "react";
import { View, Text } from "@react-pdf/renderer";
import { C, RAMP, PAGE } from "../design/tokens";
import { T } from "../design/typography";
import type { ReportChrome } from "../design/Chrome";
import { Eyebrow, Headline, Lead, Swatch, Rule } from "../design/Primitives";
import { SegmentedBar, Columns as ColumnChart } from "../design/charts/Charts";
import { formatGbp, formatGbpSigned } from "../format";
import { eyebrow, type Nav } from "../sections";
import { Sheet } from "./Sheet";
import type { PdfReportData } from "../derive";

/**
 * Page two: where the money goes.
 *
 * The two bars share one scale on purpose. Drawn to their own widths they
 * would look comparable; drawn together the difference is the argument.
 */

/** One source of truth for the cost colours, used by both the bar and the table. */
const SEGMENTS = {
  net: C.ACCENT,
  platform: RAMP[2],
  management: RAMP[3],
  cleaning: RAMP[4],
  agent: RAMP[3],
} as const;

function CostRow({
  label, pct, amount, monthly, color, bold,
}: {
  label: string;
  pct?: string;
  amount: string;
  monthly: string;
  color?: string;
  bold?: boolean;
}) {
  const style = bold ? T.bodyBold : T.body;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 4.5 }}>
      <View style={{ width: 10 }}>{color ? <Swatch color={color} /> : null}</View>
      <Text style={[style, { flex: 1 }]}>{label}</Text>
      <Text style={[T.metaMuted, { width: 34, textAlign: "right" }]}>{pct ?? ""}</Text>
      <Text style={[style, { width: 62, textAlign: "right" }]}>{amount}</Text>
      <Text style={[style, { width: 52, textAlign: "right" }]}>{monthly}</Text>
    </View>
  );
}

export function Page2Numbers({
  data, chrome, nav,
}: {
  data: PdfReportData;
  chrome: ReportChrome;
  nav: Nav;
}) {
  const { shortLetAnnual: stl, longLetAnnual: ltl, strVsLtl, monthly } = data;
  const scale = Math.max(stl.gross, ltl.gross, 1);
  const barW = PAGE.CONTENT;
  const mo = (annual: number) => formatGbp(Math.round(annual / 12));
  const neg = (annual: number) => `−${formatGbp(annual)}`;
  const negMo = (annual: number) => `−${formatGbp(Math.round(annual / 12))}`;

  const ltlNetMonthly = Math.round(ltl.net / 12);
  const peak = monthly.reduce((a, b) => (b.net > a.net ? b : a), monthly[0]);
  const quiet = monthly.reduce((a, b) => (b.net < a.net ? b : a), monthly[0]);
  const lowestGain = monthly.reduce((a, b) => (b.vsLtl < a.vsLtl ? b : a), monthly[0]);

  return (
    <Sheet chrome={chrome} nav={nav}>
      <Eyebrow>{eyebrow(nav)}</Eyebrow>
      <View style={{ marginTop: 4 }}>
        <Headline>Where every pound goes</Headline>
        <Lead>Both options drawn on the same scale, so the gap is exactly as big as it looks.</Lead>
      </View>

      {/* ── Twin bars ── */}
      <View style={{ marginTop: 18 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={T.label}>{`SHORT-TERM LET · GROSS ${formatGbp(stl.gross)}`}</Text>
          <Text style={T.label}>{`YOU KEEP ${formatGbp(stl.net)}`}</Text>
        </View>
        <View style={{ marginTop: 5 }}>
          <SegmentedBar
            values={[stl.net, stl.platformFee, stl.managementFee, stl.cleaning]}
            colors={[SEGMENTS.net, SEGMENTS.platform, SEGMENTS.management, SEGMENTS.cleaning]}
            scaleMax={scale}
            width={barW}
            height={26}
          />
        </View>

        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 14 }}>
          <Text style={T.label}>{`LONG-TERM LET · GROSS ${formatGbp(ltl.gross)}`}</Text>
          <Text style={T.label}>{`YOU KEEP ${formatGbp(ltl.net)}`}</Text>
        </View>
        <View style={{ marginTop: 5 }}>
          <SegmentedBar
            values={[ltl.net, ltl.agentFee]}
            colors={[C.MUTED, SEGMENTS.agent]}
            scaleMax={scale}
            width={barW}
            height={26}
          />
        </View>
      </View>

      {/* ── The two ledgers ── */}
      <View style={{ flexDirection: "row", gap: 22, marginTop: 20 }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row" }}>
            <Text style={[T.tableHead, { flex: 1 }]}>SHORT-TERM LET</Text>
            <Text style={[T.tableHead, { width: 62, textAlign: "right" }]}>ANNUAL</Text>
            <Text style={[T.tableHead, { width: 52, textAlign: "right" }]}>MONTH</Text>
          </View>
          <Rule style={{ marginTop: 4 }} />
          <CostRow label="Gross revenue" amount={formatGbp(stl.gross)} monthly={mo(stl.gross)} />
          <CostRow label="Platform fees" pct={`${stl.platformPct}%`} amount={neg(stl.platformFee)} monthly={negMo(stl.platformFee)} color={SEGMENTS.platform} />
          {/* Self-managed removes the fee rather than showing a zero row. */}
          {stl.selfManaged ? null : (
            <CostRow label="Management" pct={`${stl.managementPct}%`} amount={neg(stl.managementFee)} monthly={negMo(stl.managementFee)} color={SEGMENTS.management} />
          )}
          <CostRow label="Cleaning & laundry" pct={`${stl.cleaningPct}%`} amount={neg(stl.cleaning)} monthly={negMo(stl.cleaning)} color={SEGMENTS.cleaning} />
          <Rule />
          <CostRow label="Net income" pct={`${100 - stl.totalCostsPct}%`} amount={formatGbp(stl.net)} monthly={mo(stl.net)} color={SEGMENTS.net} bold />
        </View>

        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row" }}>
            <Text style={[T.tableHead, { flex: 1 }]}>LONG-TERM LET</Text>
            <Text style={[T.tableHead, { width: 62, textAlign: "right" }]}>ANNUAL</Text>
            <Text style={[T.tableHead, { width: 52, textAlign: "right" }]}>MONTH</Text>
          </View>
          <Rule style={{ marginTop: 4 }} />
          <CostRow label="Gross rent" amount={formatGbp(ltl.gross)} monthly={mo(ltl.gross)} />
          <CostRow label="Letting agent" pct="10%" amount={neg(ltl.agentFee)} monthly={negMo(ltl.agentFee)} color={SEGMENTS.agent} />
          <Rule />
          <CostRow label="Net income" pct="90%" amount={formatGbp(ltl.net)} monthly={mo(ltl.net)} color={C.MUTED} bold />

          <View style={{ backgroundColor: C.INK, borderRadius: 3, padding: 12, marginTop: 14 }}>
            <Text style={T.labelOnDark}>DIFFERENCE</Text>
            <Text style={[T.figureAccent, { marginTop: 4 }]}>
              {`${formatGbpSigned(strVsLtl.annualDiff)} / yr`}
            </Text>
          </View>
        </View>
      </View>

      {/* ── Twelve months ── */}
      <View style={{ marginTop: "auto", paddingTop: 16 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={T.label}>12-MONTH NET INCOME FORECAST</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 7, height: 7, backgroundColor: RAMP[1] }} />
            <Text style={T.metaMuted}>Short-term let</Text>
            <Text style={[T.metaMuted, { marginLeft: 6 }]}>
              {`- - -  Long-term let ${formatGbp(ltlNetMonthly)}`}
            </Text>
          </View>
        </View>
        <View style={{ marginTop: 6 }}>
          {/* The chart marks the one best month. `peak` in the data flags the
              top three, which is right for the tables but makes the point
              three times over here. */}
          <ColumnChart
            months={monthly.map((m) => ({ ...m, peak: m.month === peak.month }))}
            baseline={ltlNetMonthly}
            width={PAGE.CONTENT}
            height={152}
          />
        </View>
        <Rule style={{ marginTop: 6 }} />
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
          <Text style={T.metaMuted}>{`PEAK · ${peak.month.slice(0, 3).toUpperCase()} ${formatGbp(peak.net)}`}</Text>
          <Text style={T.metaMuted}>{`QUIETEST · ${quiet.month.slice(0, 3).toUpperCase()} ${formatGbp(quiet.net)}`}</Text>
          <Text style={T.metaMuted}>{`LOWEST GAIN VS LONG-LET · ${formatGbpSigned(lowestGain.vsLtl)}`}</Text>
        </View>
      </View>
    </Sheet>
  );
}
