import React from "react";
import { View, Text } from "@react-pdf/renderer";
import { C, PAGE } from "../design/tokens";
import { T } from "../design/typography";
import type { ReportChrome } from "../design/Chrome";
import { Card, Chip, Eyebrow, Headline, Lead, Rule } from "../design/Primitives";
import { formatGbp } from "../format";
import { eyebrow, type Nav } from "../sections";
import { Sheet } from "./Sheet";
import type { PdfDiligence, PdfLiquidity } from "../derive";

/**
 * The due diligence page: what the public registers say about the property
 * (EPC, flood risk, planning designations, listed buildings, council tax,
 * stamp duty) and how easily it would sell or let on if short-letting
 * stopped. Present only when the analysis carried any of it, so reports
 * saved before PropertyData supplied these keep their page count.
 */

function LiquidityBlock({ title, verb, data }: { title: string; verb: string; data: PdfLiquidity | null }) {
  const rows: Array<[string, string]> = data
    ? [
        ["Days on market", data.daysOnMarket !== null ? `${Math.round(data.daysOnMarket)} days` : "—"],
        [`On the market now`, data.total !== null ? `${data.total.toLocaleString("en-GB")}` : "—"],
        [`${verb} a month`, data.perMonth !== null ? `${data.perMonth.toLocaleString("en-GB")}` : "—"],
        ["Months of stock", data.monthsOfInventory !== null ? `${data.monthsOfInventory}` : "—"],
      ]
    : [];
  return (
    <View style={{ flex: 1 }}>
      <Text style={T.label}>{title}</Text>
      <Text style={[T.figureMd, { marginTop: 5 }]}>{data?.rating ?? "No data"}</Text>
      <Rule style={{ marginTop: 6 }} />
      {rows.map(([label, value]) => (
        <View key={label}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3.4 }}>
            <Text style={T.body}>{label}</Text>
            <Text style={T.bodyBold}>{value}</Text>
          </View>
          <Rule />
        </View>
      ))}
    </View>
  );
}

function StatusChip({ status }: { status: "inside" | "outside" | "unknown" }) {
  if (status === "inside") return <Chip solid>YES</Chip>;
  if (status === "outside") return <Chip>NO</Chip>;
  return <Chip>NO DATA</Chip>;
}

export function PageDiligence({
  data, chrome, nav,
}: {
  data: PdfDiligence;
  chrome: ReportChrome;
  nav: Nav;
}) {
  const { epc, floodRisk, councilTax, stampDuty, designations, listed, liquidity, growth } = data;
  const colWidth = (PAGE.CONTENT - 20) / 2;

  return (
    <Sheet chrome={chrome} nav={nav}>
      <Eyebrow>{eyebrow(nav)}</Eyebrow>
      <View style={{ marginTop: 4 }}>
        <Headline>Before you commit</Headline>
        <Lead>What the public registers say about the property, and how easily it would sell or let on if short-letting stopped.</Lead>
      </View>

      {/* ── Four facts ── */}
      <View style={{ flexDirection: "row", gap: 9, marginTop: 14 }}>
        <Card style={{ flex: 1 }}>
          <Text style={T.label}>EPC RATING</Text>
          <Text style={[T.figureMd, { marginTop: 5 }]}>{epc ? epc.rating : "—"}</Text>
          <Text style={[T.body, { marginTop: 3, color: C.TEXT_MUTED }]}>
            {epc
              ? `${epc.score !== null ? `Score ${epc.score}` : "Score unknown"}${epc.inspected ? ` · inspected ${epc.inspected}` : ""}`
              : "No certificate matched this address"}
          </Text>
        </Card>
        <Card style={{ flex: 1 }}>
          <Text style={T.label}>FLOOD RISK</Text>
          <Text style={[T.figureMd, { marginTop: 5 }]}>{floodRisk ? floodRisk.level : "—"}</Text>
          <Text style={[T.body, { marginTop: 3, color: C.TEXT_MUTED }]}>
            {floodRisk ? (floodRisk.high ? "Get flood cover quoted before exchange" : "Environment Agency band for the postcode") : "No data for this postcode"}
          </Text>
        </Card>
        <Card style={{ flex: 1 }}>
          <Text style={T.label}>COUNCIL TAX</Text>
          <Text style={[T.figureMd, { marginTop: 5 }]}>{councilTax ? `Band ${councilTax.band}` : "—"}</Text>
          <Text style={[T.body, { marginTop: 3, color: C.TEXT_MUTED }]}>
            {councilTax ? `${formatGbp(councilTax.annual)} a year${councilTax.council ? ` · ${councilTax.council}` : ""}` : "Band not on record"}
          </Text>
        </Card>
        <Card style={{ flex: 1 }}>
          <Text style={T.label}>STAMP DUTY</Text>
          <Text style={[T.figureMd, { marginTop: 5 }]}>{stampDuty ? formatGbp(stampDuty.amount) : "—"}</Text>
          <Text style={[T.body, { marginTop: 3, color: C.TEXT_MUTED }]}>
            {stampDuty
              ? `${stampDuty.name}${stampDuty.ratePct !== null ? ` · ${stampDuty.ratePct}% effective` : ""}${stampDuty.live ? " · live rate" : ""}`
              : "No purchase price on this report"}
          </Text>
        </Card>
      </View>

      {/* ── Designations and liquidity ── */}
      <View style={{ flexDirection: "row", gap: 20, marginTop: 16 }}>
        <View style={{ width: colWidth }}>
          <Text style={T.label}>PLANNING DESIGNATIONS</Text>
          <Rule style={{ marginTop: 6, backgroundColor: C.INK }} />
          {designations.map((d) => (
            <View key={d.label}>
              <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 4, gap: 6 }}>
                <View style={{ flex: 1 }}>
                  <Text style={T.bodyBold}>{d.label}</Text>
                  {d.detail ? <Text style={[T.metaMuted, { marginTop: 1 }]}>{d.detail}</Text> : null}
                </View>
                <StatusChip status={d.status} />
              </View>
              <Rule />
            </View>
          ))}

          <Text style={[T.label, { marginTop: 12 }]}>LISTED BUILDINGS NEARBY</Text>
          <Rule style={{ marginTop: 6, backgroundColor: C.INK }} />
          {listed && listed.nearest.length > 0 ? (
            listed.nearest.map((b) => (
              <View key={`${b.name}-${b.distance}`}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3.4, gap: 6 }}>
                  <Text style={[T.body, { flex: 1, maxLines: 1, textOverflow: "ellipsis" }]}>{b.name}</Text>
                  <Text style={T.metaMuted}>{`${b.grade ? `GRADE ${b.grade} · ` : ""}${b.distance}`}</Text>
                </View>
                <Rule />
              </View>
            ))
          ) : (
            <Text style={[T.body, { marginTop: 6, color: C.TEXT_MUTED }]}>{listed ? "None on record nearby" : "No data for this postcode"}</Text>
          )}
          {listed?.possiblyListed ? (
            <Text style={[T.bodyBold, { marginTop: 6 }]}>One sits within about 80 metres: the property itself may be listed.</Text>
          ) : null}
        </View>

        <View style={{ width: colWidth }}>
          <Text style={T.label}>EXIT LIQUIDITY</Text>
          <Text style={[T.metaMuted, { marginTop: 3 }]}>{`OUTCODE MARKET · IF SHORT-LETTING STOPS`}</Text>
          {liquidity ? (
            <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
              <LiquidityBlock title="SELLING" verb="Sales" data={liquidity.sale} />
              <LiquidityBlock title="LETTING LONG-TERM" verb="Lets" data={liquidity.rent} />
            </View>
          ) : (
            <Text style={[T.body, { marginTop: 8, color: C.TEXT_MUTED }]}>No market data for this outcode</Text>
          )}

          {growth ? (
            <View style={{ marginTop: 14, borderWidth: 0.8, borderColor: C.INK, borderRadius: 2, padding: 9 }}>
              <Text style={T.label}>{`CAPITAL GROWTH · ${growth.outcode}`}</Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                {([["1 YR", growth.g1y], ["3 YRS", growth.g3y], ["5 YRS", growth.g5y], ["7 YRS", growth.g7y]] as Array<[string, number | null]>).map(([label, v]) => (
                  <View key={label} style={{ flex: 1 }}>
                    <Text style={T.metaMuted}>{label}</Text>
                    <Text style={[T.figureMd, { marginTop: 2 }]}>{v === null ? "—" : `${v > 0 ? "+" : ""}${v}%`}</Text>
                  </View>
                ))}
              </View>
              {growth.rangeLine ? <Text style={[T.body, { marginTop: 7, lineHeight: 1.4 }]}>{growth.rangeLine}</Text> : null}
            </View>
          ) : null}
        </View>
      </View>

      <View style={{ marginTop: "auto", paddingTop: 12 }}>
        {data.notes.map((n) => (
          <Text key={n} style={[T.body, { marginTop: 4, color: C.TEXT_MUTED, lineHeight: 1.4 }]}>{n}</Text>
        ))}
      </View>
    </Sheet>
  );
}
