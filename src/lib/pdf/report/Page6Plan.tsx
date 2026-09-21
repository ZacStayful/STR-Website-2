import React from "react";
import { View, Text, Link } from "@react-pdf/renderer";
import { C, PAGE, RAMP } from "../design/tokens";
import { T } from "../design/typography";
import type { ReportChrome } from "../design/Chrome";
import { Card, Eyebrow, Headline, Lead, Rule, Tick } from "../design/Primitives";
import { Qr, Timeline } from "../design/charts/Charts";
import { encodeQr } from "../qr";
import { formatGbp } from "../format";
import { eyebrow, type Nav } from "../sections";
import { Sheet } from "./Sheet";
import type { PdfReportData } from "../derive";

const STEPS = [
  { title: "Platform launch", body: "Go live on Airbnb and Booking.com. Build early demand, bookings and reviews." },
  { title: "Data collection", body: "Track which guest types, stay lengths and price points perform best." },
  { title: "Direct bookings", body: "Convert repeat guests to lower-cost direct bookings, removing platform fees." },
  { title: "The result", body: "More profitable, repeat, low-friction bookings. Less admin, more income." },
];

const HANDLED = [
  "Listing setup",
  "Guest management",
  "Cleaning coordination",
  "Pricing optimisation",
  "Direct booking growth",
];

const CTA_POINTS = [
  "How we get direct bookings for your property",
  "How we rank in the top 20% of listings on the platforms",
  "How we protect your property from guests",
  "What our service looks like from your side",
];

/** `https://calendly.com/zac-stayful/call` → `calendly.com` + `/zac-stayful/call`. */
function urlLines(url: string): string[] {
  const clean = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const slash = clean.indexOf("/");
  if (slash <= 0) return [clean];
  return [clean.slice(0, slash), clean.slice(slash)];
}

export function Page6Plan({
  data, chrome, nav,
}: {
  data: PdfReportData;
  chrome: ReportChrome;
  nav: Nav;
}) {
  const { growth } = data;
  const company = chrome.brand.companyName;
  const bookingUrl = chrome.brand.bookingUrl;
  const ctaEmail = chrome.brand.ctaEmail;

  // A payload too long for the encoder is not worth risking on a printed page:
  // the CTA simply drops the code.
  let qr: { size: number; rows: boolean[][] } | null = null;
  if (bookingUrl) {
    try {
      qr = encodeQr(bookingUrl);
    } catch {
      qr = null;
    }
  }

  const cards: Array<[string, string, string]> = [
    [`${growth.directBookingPctMonth36}%`, "Direct bookings by month 36", "Platform fee removed on that share of your revenue"],
    [
      growth.repeatCustomers !== null ? String(growth.repeatCustomers) : "—",
      "Repeat guests",
      growth.repeatCustomers !== null
        ? `Built organically over three years, at ${growth.avgStayNights} nights a stay`
        : "Not estimated — the comparable set reported no booking counts",
    ],
    [`${growth.platformFeeSavingsPct}%`, "Platform fee saved", "On every direct booking"],
    [`+${formatGbp(growth.extraMonthlyProfitYr3)}`, "Extra monthly profit", "By year 3, above the year-1 baseline"],
  ];

  return (
    <Sheet chrome={chrome} nav={nav}>
      <Eyebrow>{eyebrow(nav)}</Eyebrow>
      <View style={{ marginTop: 4 }}>
        <Headline>{`How ${company} grows your returns`}</Headline>
        <Lead>We build direct bookings systematically, without any extra effort from you.</Lead>
      </View>

      {/* ── The four steps ── */}
      <View style={{ marginTop: 16 }}>
        <Timeline steps={STEPS.map((s) => s.title)} width={PAGE.CONTENT} />
        <View style={{ flexDirection: "row", marginTop: 8 }}>
          {STEPS.map((step, i) => (
            <View key={step.title} style={{ flex: 1, paddingRight: 12 }}>
              <Text style={T.metaMuted}>{`STEP 0${i + 1}`}</Text>
              <Text style={[T.bodyBold, { fontSize: 11, marginTop: 4 }]}>{step.title}</Text>
              <Text style={[T.body, { marginTop: 4, lineHeight: 1.45 }]}>{step.body}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── Where it gets to ── */}
      <View style={{ marginTop: 16 }}>
        <Text style={T.label}>36-MONTH INCOME GROWTH PROJECTION</Text>
        <View style={{ flexDirection: "row", gap: 9, marginTop: 6 }}>
          {cards.map(([figure, label, sub]) => (
            <Card key={label} style={{ flex: 1 }}>
              <Text style={[T.figureLg, { color: RAMP[0] }]}>{figure}</Text>
              <Text style={[T.bodyBold, { marginTop: 5 }]}>{label}</Text>
              <Text style={[T.body, { marginTop: 3, color: C.TEXT_MUTED, lineHeight: 1.4 }]}>{sub}</Text>
            </Card>
          ))}
        </View>
      </View>

      {/* ── What we handle ── */}
      <View style={{ marginTop: 16 }}>
        <Text style={T.label}>{`${company.toUpperCase()} HANDLES EVERYTHING`}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 6 }}>
          {HANDLED.map((item) => (
            <View key={item} style={{ width: "33.33%", paddingRight: 12 }}>
              <Rule />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6 }}>
                <Tick />
                <Text style={T.body}>{item}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* ── The ask ── */}
      <View style={{ marginTop: "auto", paddingTop: 14 }}>
        <View style={{ backgroundColor: C.INK, borderRadius: 3, padding: 18, flexDirection: "row", gap: 18 }}>
          <View style={{ flex: 1 }}>
            <Text style={T.labelOnDark}>NEXT STEP · FREE 30-MINUTE CALL</Text>
            <Text style={[T.bodyOnDark, { fontSize: 16, fontWeight: 600, marginTop: 6, lineHeight: 1.3 }]}>
              Book your Airbnb Profitability Action Plan
            </Text>
            <View style={{ marginTop: 9, gap: 5 }}>
              {CTA_POINTS.map((p) => (
                <View key={p} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Tick color={C.ACCENT} />
                  <Text style={T.bodyOnDark}>{p}</Text>
                </View>
              ))}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginTop: 12 }}>
              {bookingUrl ? (
                <Link src={bookingUrl} style={{ textDecoration: "none" }}>
                  <View style={{ backgroundColor: C.ACCENT, borderRadius: 2, paddingVertical: 8, paddingHorizontal: 14 }}>
                    <Text style={[T.bodyBold, { color: C.INK }]}>Book your call  →</Text>
                  </View>
                </Link>
              ) : null}
              {ctaEmail ? (
                <Link src={`mailto:${ctaEmail}`} style={{ textDecoration: "none" }}>
                  <Text style={[T.bodyOnDark, { textDecoration: "underline" }]}>{ctaEmail}</Text>
                </Link>
              ) : null}
            </View>
          </View>

          {/* Without a booking link there is no divider and no code — a
              customer's report never carries ours. */}
          {qr ? (
            <>
              <View style={{ width: 0.7, backgroundColor: C.CREAM, opacity: 0.3 }} />
              <View style={{ alignItems: "center", width: 126 }}>
                <Qr matrix={qr} size={92} />
                <Text style={[T.labelOnDark, { marginTop: 7 }]}>SCAN TO BOOK</Text>
                {/* Split at the first slash so the link can wrap. Hyphenation
                    is switched off document-wide to protect the headlines,
                    which leaves a URL as one unbreakable token that would
                    otherwise run straight off the panel. */}
                {urlLines(bookingUrl as string).map((line) => (
                  <Text
                    key={line}
                    style={[T.micro, { color: C.ACCENT, letterSpacing: 0, textAlign: "center" }]}
                  >
                    {line}
                  </Text>
                ))}
              </View>
            </>
          ) : null}
        </View>
      </View>
    </Sheet>
  );
}
