import React from "react";
import { View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { PDF_COLORS, DEFAULT_PDF_BRAND, type PdfBrand } from "../theme";

const C = PDF_COLORS;

export const formatGbp = (value: number): string =>
  `£${Math.round(value).toLocaleString("en-GB")}`;

export const formatGbpSigned = (value: number): string => {
  const abs = Math.abs(Math.round(value)).toLocaleString("en-GB");
  const sign = value >= 0 ? "+" : "−";
  return `${sign}£${abs}`;
};

export const formatPercent = (value: number): string =>
  `${Math.round(value * 100)}%`;

export const formatRating = (value: number): string =>
  value > 0 ? `${value.toFixed(1)} ★` : "—";

const chromeStyles = StyleSheet.create({
  headerBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 34,
    backgroundColor: C.DARK_GREEN,
    paddingHorizontal: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerBrand: {
    color: C.WHITE,
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 2,
  },
  headerMeta: {
    color: C.CREAM,
    fontSize: 8,
  },
  footerBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 24,
    backgroundColor: C.CREAM,
    paddingHorizontal: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  footerLeft: {
    fontSize: 7,
    color: C.DARK_GREY,
  },
  footerRight: {
    fontSize: 7,
    color: C.DARK_GREY,
  },
});

const logoStyle = { height: 16, width: "auto" as const, objectFit: "contain" as const };

/**
 * The bar at the top of every page. `brand` is absent for the members-only
 * report, which keeps the Stayful wordmark; a funnel passes its customer's,
 * and the colours are overridden with a style array rather than by rebuilding
 * the StyleSheet.
 */
export function HeaderBar({ brand = DEFAULT_PDF_BRAND }: { brand?: PdfBrand }) {
  return (
    <View fixed style={[chromeStyles.headerBar, { backgroundColor: brand.primary }]}>
      {brand.logoDataUri ? (
        /* This is react-pdf's <Image>, a PDF drawing primitive, not an HTML
           <img>. Its prop types have no `alt`, and a PDF has no alt-text
           slot to put one in, so the a11y rule does not apply here. */
        // eslint-disable-next-line jsx-a11y/alt-text
        <Image src={brand.logoDataUri} style={logoStyle} />
      ) : (
        <Text style={[chromeStyles.headerBrand, { color: brand.onPrimary }]}>{brand.companyName}</Text>
      )}
      <Text style={[chromeStyles.headerMeta, { color: brand.onPrimary, opacity: 0.85 }]}>
        Property Income Analysis · Confidential
      </Text>
    </View>
  );
}

export function FooterBar({ brand = DEFAULT_PDF_BRAND }: { brand?: PdfBrand }) {
  return (
    <View fixed style={chromeStyles.footerBar}>
      <Text style={chromeStyles.footerLeft}>{brand.contactLine}</Text>
      <Text
        style={chromeStyles.footerRight}
        render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      />
    </View>
  );
}
