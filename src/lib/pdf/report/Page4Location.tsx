import React from "react";
import { View, Text } from "@react-pdf/renderer";
import { C, RAMP, PAGE } from "../design/tokens";
import { T } from "../design/typography";
import type { ReportChrome } from "../design/Chrome";
import { Card, Chip, DotMeter, Eyebrow, Headline, Lead, Pill, Rule } from "../design/Primitives";
import { Gauge, Meter, Ring } from "../design/charts/Charts";
import { eyebrow, type Nav } from "../sections";
import { Sheet } from "./Sheet";
import type { PdfReportData } from "../derive";

/**
 * The card headings are a fixed width, so the long-form category names the
 * analysis uses ("Educational Institutions") run under the impact pill.
 */
function shortDriver(type: string): string {
  const t = type.toUpperCase();
  if (t.includes("TRANSPORT")) return "TRANSPORT";
  if (t.includes("EVENT")) return "EVENTS";
  if (t.includes("EDUCATION") || t.includes("UNIVERSIT")) return "EDUCATION";
  if (t.includes("HEALTH") || t.includes("HOSPITAL")) return "HEALTHCARE";
  return t;
}

function bookingBand(score: number): { label: string; sentence: string } {
  if (score >= 75) return { label: "EXCELLENT", sentence: "take 30–50% of bookings direct" };
  if (score >= 50) return { label: "GOOD", sentence: "take 20–35% of bookings direct" };
  if (score >= 25) return { label: "MODERATE", sentence: "take 10–25% of bookings direct" };
  return { label: "LIMITED", sentence: "take up to 15% of bookings direct" };
}

function AmenityRow({ name, score }: { name: string; score: number }) {
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 4 }}>
        <Text style={[T.body, { flex: 1 }]}>{name}</Text>
        <DotMeter score={score} />
        <Text style={[T.metaMuted, { width: 24, textAlign: "right" }]}>{`${score}/5`}</Text>
      </View>
      <Rule />
    </View>
  );
}

export function Page4Location({
  data, chrome, nav,
}: {
  data: PdfReportData;
  chrome: ReportChrome;
  nav: Nav;
}) {
  const { demandDrivers, directBookingScore, risk, amenities, shortLetAnnual } = data;
  const band = bookingBand(directBookingScore);
  const drivers = demandDrivers.slice(0, 4);

  const factors: Array<[string, number]> = [
    ["Revenue consistency", risk.factors.revenueConsistency],
    ["Long-term comparison", risk.factors.longTermComparison],
    ["Seasonal variance", risk.factors.seasonalVariance],
    ["Market demand", risk.factors.marketDemand],
  ];

  const premium = amenities.premium;

  return (
    <Sheet chrome={chrome} nav={nav}>
      <Eyebrow>{eyebrow(nav)}</Eyebrow>
      <View style={{ marginTop: 4 }}>
        <Headline>Why guests will book here</Headline>
        <Lead>Demand drivers within reach of the property, and how steady that demand is.</Lead>
      </View>

      {/* ── Demand drivers ── */}
      {drivers.length > 0 ? (
        <View style={{ flexDirection: "row", gap: 9, marginTop: 14 }}>
          {drivers.map((d) => (
            <Card key={d.type} style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 4 }}>
                {/* flexShrink so a long category cannot run under the pill. */}
                <Text style={[T.label, { flex: 1, flexShrink: 1 }]}>{shortDriver(d.type)}</Text>
                <Pill>{d.impact}</Pill>
              </View>
              <Text style={[T.figureMd, { marginTop: 6 }]}>{d.distance}</Text>
              <Text style={[T.body, { marginTop: 4, maxLines: 2, textOverflow: "ellipsis" }]}>{d.nearest}</Text>
              <Text style={[T.metaMuted, { marginTop: 3 }]}>{d.count}</Text>
            </Card>
          ))}
        </View>
      ) : null}

      {/* ── Direct booking ── */}
      <View style={{ backgroundColor: C.INK, borderRadius: 3, padding: 16, marginTop: 14, flexDirection: "row", alignItems: "center", gap: 18 }}>
        <Ring value={directBookingScore} label="/ 100" />
        <View style={{ flex: 1 }}>
          <Text style={T.labelOnDark}>{`DIRECT BOOKING POTENTIAL · ${band.label}`}</Text>
          <Text style={[T.bodyOnDark, { fontSize: 13, fontWeight: 700, marginTop: 5, lineHeight: 1.35 }]}>
            {`By year 3, properties here typically ${band.sentence}.`}
          </Text>
          <Text style={[T.bodyOnDark, { marginTop: 5 }]}>
            {`That cuts the ${shortLetAnnual.platformPct}% platform fee to near zero on those stays.`}
          </Text>
        </View>
      </View>

      {/* ── Risk, and what to fit ── */}
      <View style={{ flexDirection: "row", gap: 20, marginTop: 16, flex: 1 }}>
        <View style={{ flex: 1 }}>
          <Text style={T.label}>RISK PROFILE</Text>
          <View style={{ alignItems: "center", marginTop: 8 }}>
            <Gauge value={risk.overall} width={190} />
            {/* One Text per run: a nested Text inherits the outer measurement
                and clipped the label at "35-". */}
            <View style={{ flexDirection: "row", alignItems: "baseline", marginTop: 6 }}>
              <Text style={T.figureLg}>{`${risk.label} · ${risk.overall}`}</Text>
              <Text style={[T.metaMuted, { fontSize: 9 }]}>/100</Text>
            </View>
            <Text style={[T.metaMuted, { marginTop: 2 }]}>0 = LOWEST RISK, 100 = HIGHEST</Text>
          </View>
          <View style={{ marginTop: 12 }}>
            {factors.map(([label, score]) => (
              <View key={label} style={{ marginBottom: 9 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={T.bodyBold}>{label}</Text>
                  <Text style={T.metaMuted}>{`${score}/100`}</Text>
                </View>
                <View style={{ marginTop: 4 }}>
                  <Meter value={score} width={(PAGE.CONTENT - 20) / 2} />
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={{ flex: 1 }}>
          <Text style={T.label}>RECOMMENDED AMENITIES</Text>
          {/* Only claimed as a reading of this market when it actually is one. */}
          <Text style={[T.metaMuted, { marginTop: 3 }]}>
            {amenities.derived
              ? "SHARE OF NEARBY LISTINGS THAT HAVE EACH"
              : "STANDING RECOMMENDATION · NO AMENITY DATA FOR THIS COMP SET"}
          </Text>

          {amenities.essential.length > 0 ? (
            <View style={{ marginTop: 8 }}>
              <Text style={[T.label, { color: RAMP[1] }]}>ESSENTIAL</Text>
              <Rule style={{ marginTop: 3 }} />
              {amenities.essential.map((a) => <AmenityRow key={a.name} {...a} />)}
            </View>
          ) : null}

          {amenities.recommended.length > 0 ? (
            <View style={{ marginTop: 10 }}>
              <Text style={[T.label, { color: RAMP[1] }]}>COMPETITIVE EDGE</Text>
              <Rule style={{ marginTop: 3 }} />
              {amenities.recommended.map((a) => <AmenityRow key={a.name} {...a} />)}
            </View>
          ) : null}

          {amenities.differentiators.length > 0 ? (
            <View style={{ marginTop: 12, borderWidth: 0.8, borderColor: C.INK, borderRadius: 2, padding: 9 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={T.label}>DIFFERENTIATORS</Text>
                {premium ? (
                  <Text style={T.metaMuted}>{`+${premium.low}–${premium.high}% RATE`}</Text>
                ) : null}
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 7 }}>
                {amenities.differentiators.map((a) => <Chip key={a.name}>{a.name}</Chip>)}
              </View>
              <Text style={[T.body, { marginTop: 7, lineHeight: 1.4 }]}>
                {premium
                  ? "Listings with at least one of these command measurably higher nightly rates in this market."
                  : "Few listings nearby offer these, so they are the clearest way to stand out."}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Sheet>
  );
}
