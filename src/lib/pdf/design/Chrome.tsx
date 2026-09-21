import React from "react";
import { View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { C, PAGE } from "./tokens";
import { T } from "./typography";
import { stampShort, stamp, type Nav } from "../sections";
import type { PdfBrand } from "../theme";

/**
 * The furniture every page carries: registration marks, the masthead or running
 * header, and the footer.
 *
 * Page numbering comes from the section list rather than react-pdf's
 * `pageNumber`, because the setup table may wrap onto a continuation sheet. A
 * physical count would renumber every page after it and disagree with the
 * contents strip on page one.
 */

export interface ReportChrome {
  brand: PdfBrand;
  /** Street line, already split from the town. */
  addressLine: string;
  /** Town or outward code. Empty when neither is known. */
  locality: string;
  /** `DD.MM.YYYY`, or null when the report carries no usable date. */
  issued: string | null;
  /** Who the report was produced for. Omitted entirely when unknown. */
  preparedFor?: string;
}

const s = StyleSheet.create({
  page: {
    backgroundColor: C.PAGE,
    paddingTop: PAGE.HEADER_H,
    paddingBottom: PAGE.FOOTER_H,
    paddingHorizontal: PAGE.M,
  },
  corner: { position: "absolute", width: 7, height: 7 },
  hRule: { height: 0.8, backgroundColor: C.INK, opacity: 0.25 },

  masthead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 10,
  },
  mastheadMeta: { alignItems: "flex-end", gap: 2.5 },

  running: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 9,
  },
  runningCentre: { flex: 1, alignItems: "center" },

  footer: {
    position: "absolute",
    bottom: 18,
    left: PAGE.M,
    right: PAGE.M,
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 7,
  },
  logoLarge: { width: 104, height: 60, objectFit: "contain" },
  logoSmall: { width: 54, height: 31, objectFit: "contain" },
});

/**
 * The corner crosses. Decorative, but they are what makes the document read as
 * a printed specification rather than a web page saved to PDF.
 */
export function RegistrationMarks() {
  const arm = { position: "absolute" as const, backgroundColor: C.INK, opacity: 0.55 };
  const cross = (key: string, style: Record<string, number>) => (
    <View key={key} style={[s.corner, style]}>
      <View style={[arm, { left: 3, top: 0, width: 0.7, height: 7 }]} />
      <View style={[arm, { top: 3, left: 0, height: 0.7, width: 7 }]} />
    </View>
  );
  // The wrapper has to fill the sheet. Left in the flow it only spans the
  // content box, which puts the "bottom" marks in the middle of the page —
  // and the top-right one straight through the issue date.
  return (
    <View fixed style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      {cross("tl", { top: 16, left: 16 })}
      {cross("tr", { top: 16, right: 16 })}
      {cross("bl", { bottom: 16, left: 16 })}
      {cross("br", { bottom: 16, right: 16 })}
    </View>
  );
}

/** Falls back to a text wordmark when there is no logo — white-label, or a
 *  packaging slip that left the PNG out of the bundle. */
function Wordmark({ brand, large }: { brand: PdfBrand; large?: boolean }) {
  if (brand.logoDataUri) {
    /* react-pdf's <Image> is a drawing primitive, not an HTML <img>: it has no
       `alt` prop and a PDF has no alt-text slot, so the a11y rule cannot apply. */
    // eslint-disable-next-line jsx-a11y/alt-text
    return <Image src={brand.logoDataUri} style={large ? s.logoLarge : s.logoSmall} />;
  }
  return (
    <Text style={[T.label, { fontSize: large ? 15 : 9, letterSpacing: 2 }]}>
      {brand.companyName.toUpperCase()}
    </Text>
  );
}

/** Page one only: the large logo and the right-aligned meta block. */
export function CoverMasthead({ chrome }: { chrome: ReportChrome }) {
  const { brand, issued, preparedFor } = chrome;
  return (
    <View>
      <View style={s.masthead}>
        <Wordmark brand={brand} large />
        <View style={s.mastheadMeta}>
          <Text style={T.meta}>PROPERTY INCOME ANALYSIS</Text>
          {issued ? <Text style={T.metaMuted}>ISSUED {issued.replace(/\./g, " ")}</Text> : null}
          {preparedFor ? (
            <Text style={T.metaMuted}>PREPARED FOR [{preparedFor}]</Text>
          ) : null}
        </View>
      </View>
      <View style={s.hRule} />
    </View>
  );
}

/** Pages two onward: small logo, the property, and the section stamp. */
export function RunningHeader({ chrome, nav }: { chrome: ReportChrome; nav: Nav }) {
  const { brand, addressLine, locality } = chrome;
  const title = locality
    ? `${addressLine.toUpperCase()} · ${locality.toUpperCase()}`
    : addressLine.toUpperCase();
  return (
    <View fixed>
      <View style={s.running}>
        <Wordmark brand={brand} />
        <View style={s.runningCentre}>
          <Text style={T.meta}>{title}</Text>
        </View>
        <Text style={T.meta}>{stamp(nav)}</Text>
      </View>
      <View style={s.hRule} />
    </View>
  );
}

/**
 * The footer.
 *
 * `continued` opts a page into the continuation marker; whether it actually
 * shows is decided per sheet at render time, because only react-pdf knows
 * whether a wrapping page produced more than one.
 */
export function PageFooter({
  chrome,
  nav,
  continued,
}: {
  chrome: ReportChrome;
  nav: Nav;
  continued?: boolean;
}) {
  const { brand, issued } = chrome;
  const middle = issued ? `CONFIDENTIAL · ISSUED ${issued}` : "CONFIDENTIAL";
  return (
    <View style={s.footer} fixed>
      <View style={s.hRule} />
      <View style={s.footerRow}>
        <Text style={T.metaMuted}>{brand.contactLine.toUpperCase()}</Text>
        <Text style={T.metaMuted}>{middle}</Text>
        <Text
          style={T.meta}
          render={({ subPageNumber }) =>
            `${stampShort(nav)}${continued && (subPageNumber ?? 1) > 1 ? " (CONT.)" : ""}`
          }
        />
      </View>
    </View>
  );
}

export const sheetStyle = s.page;
