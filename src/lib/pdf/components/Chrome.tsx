import React from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_COLORS } from "../theme";

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

export function HeaderBar() {
  return (
    <View fixed style={chromeStyles.headerBar}>
      <Text style={chromeStyles.headerBrand}>STAYFUL</Text>
      <Text style={chromeStyles.headerMeta}>
        Property Income Analysis · Confidential
      </Text>
    </View>
  );
}

export function FooterBar() {
  return (
    <View fixed style={chromeStyles.footerBar}>
      <Text style={chromeStyles.footerLeft}>
        © 2026 Stayful · stayful.co.uk · 07471 321 997
      </Text>
      <Text
        style={chromeStyles.footerRight}
        render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      />
    </View>
  );
}
