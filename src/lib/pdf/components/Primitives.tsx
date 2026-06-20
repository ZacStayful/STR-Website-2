import React from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_COLORS } from "../theme";

const C = PDF_COLORS;

const primStyles = StyleSheet.create({
  // Centred section headings — the brief mandates TA_CENTER for all H1/H2/H3
  h1: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: C.DARK_GREEN,
    textAlign: "center",
    marginBottom: 4,
  },
  h2: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: C.DARK_GREEN,
    textAlign: "center",
    marginTop: 10,
    marginBottom: 8,
  },
  h3: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: C.DARK_GREEN,
    textAlign: "center",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 9,
    color: C.DARK_GREY,
    textAlign: "center",
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: C.DARK_GREY,
    letterSpacing: 1,
    textAlign: "center",
    marginTop: 4,
    marginBottom: 6,
  },
  divider: {
    height: 1,
    backgroundColor: C.CREAM,
    marginVertical: 8,
  },
  // Metric card: DARK_GREEN accent bar on top, CREAM border, rounded corners
  metricCardWrap: {
    flex: 1,
    backgroundColor: C.WHITE,
    borderColor: C.CREAM,
    borderWidth: 1,
    borderRadius: 6,
    overflow: "hidden",
  },
  metricAccent: {
    height: 3,
    backgroundColor: C.DARK_GREEN,
  },
  metricBody: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
  },
  metricLabel: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: C.LIGHT_GREY,
    letterSpacing: 1,
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: C.DARK_GREEN,
    marginBottom: 2,
  },
  metricSub: {
    fontSize: 8,
    color: C.DARK_GREY,
  },
  // Pill (e.g. risk label, HIGH impact tag)
  pillBase: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1,
  },
});

export function H1({ children }: { children: React.ReactNode }) {
  return <Text style={primStyles.h1}>{children}</Text>;
}

export function H2({ children }: { children: React.ReactNode }) {
  return <Text style={primStyles.h2}>{children}</Text>;
}

export function H3({ children }: { children: React.ReactNode }) {
  return <Text style={primStyles.h3}>{children}</Text>;
}

export function Subtitle({ children }: { children: React.ReactNode }) {
  return <Text style={primStyles.subtitle}>{children}</Text>;
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={primStyles.sectionLabel}>{children}</Text>;
}

export function Divider() {
  return <View style={primStyles.divider} />;
}

export function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <View style={primStyles.metricCardWrap}>
      <View style={primStyles.metricAccent} />
      <View style={primStyles.metricBody}>
        <Text style={primStyles.metricLabel}>{label.toUpperCase()}</Text>
        <Text style={primStyles.metricValue}>{value}</Text>
        {sub ? <Text style={primStyles.metricSub}>{sub}</Text> : null}
      </View>
    </View>
  );
}

export function Pill({
  children,
  background,
  color,
}: {
  children: React.ReactNode;
  background: string;
  color: string;
}) {
  return (
    <Text style={[primStyles.pillBase, { backgroundColor: background, color }]}>
      {children}
    </Text>
  );
}

/**
 * Base `styles` object re-exported for per-page style composition.
 * Pages can extend these via StyleSheet.create at their own scope.
 */
export const BASE_PAGE_STYLES = StyleSheet.create({
  page: {
    backgroundColor: C.OFF_WHITE,
    paddingTop: 52,
    paddingBottom: 40,
    paddingHorizontal: 40,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: C.DARK_GREY,
  },
  row: {
    flexDirection: "row",
  },
  gap8: {
    gap: 8,
  },
  gap6: {
    gap: 6,
  },
});
