import React from "react";
import { View, Text, StyleSheet, Svg, Path } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import { C, RAMP, SIZE } from "./tokens";
import { T } from "./typography";

/**
 * The report's building blocks.
 *
 * New file rather than a rewrite of `components/Primitives.tsx`: that one is
 * still imported by the deal sheet and the area report, which keep the older
 * chrome.
 */

const s = StyleSheet.create({
  card: {
    backgroundColor: C.SURFACE,
    borderWidth: 0.8,
    borderColor: C.BORDER,
    borderRadius: 2,
    padding: 10,
  },
  darkPanel: { backgroundColor: C.INK, borderRadius: 3, padding: 16 },
  chip: {
    borderWidth: 0.8,
    borderColor: C.INK,
    borderRadius: 2,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  chipSolid: { backgroundColor: C.INK, borderRadius: 2, paddingVertical: 4, paddingHorizontal: 8 },
  pill: { backgroundColor: C.INK, borderRadius: 2, paddingVertical: 2, paddingHorizontal: 5 },
  row: { flexDirection: "row", alignItems: "center" },
  swatch: { width: 5, height: 5, borderRadius: 1, marginRight: 5 },
  dot: { width: 8, height: 4, borderRadius: 1, marginLeft: 2 },
  hairline: { height: 0.6, backgroundColor: C.BORDER },
  notice: {
    borderWidth: 0.8,
    borderColor: C.INK,
    borderRadius: 2,
    backgroundColor: C.SURFACE,
    padding: 10,
    flexDirection: "row",
    gap: 8,
  },
});

export const Eyebrow = ({ children }: { children: string }) => (
  <Text style={T.eyebrow}>{children.toUpperCase()}</Text>
);

export const Display = ({ children, size }: { children: string; size?: number }) => (
  <Text style={[T.display, size ? { fontSize: size } : {}]}>{children}</Text>
);

export const Headline = ({ children }: { children: string }) => (
  <Text style={T.headline}>{children}</Text>
);

export const Lead = ({ children }: { children: string }) => (
  <Text style={[T.lead, { marginTop: 4 }]}>{children}</Text>
);

export const Rule = ({ style }: { style?: Style }) => <View style={[s.hairline, style ?? {}]} />;

export const Card = ({ children, style }: { children: React.ReactNode; style?: Style }) => (
  <View style={[s.card, style ?? {}]}>{children}</View>
);

export const DarkPanel = ({ children, style }: { children: React.ReactNode; style?: Style }) => (
  <View style={[s.darkPanel, style ?? {}]}>{children}</View>
);

/** An outlined spec chip, or a solid one for the single emphasised item. */
export function Chip({ children, solid }: { children: string; solid?: boolean }) {
  return (
    <View style={solid ? s.chipSolid : s.chip}>
      <Text style={solid ? T.labelOnDark : T.label}>{children.toUpperCase()}</Text>
    </View>
  );
}

/** The small dark badge used for HIGH / TOP markers. */
export function Pill({ children }: { children: string }) {
  return (
    <View style={s.pill}>
      <Text style={[T.labelOnDark, { fontSize: SIZE.micro }]}>{children.toUpperCase()}</Text>
    </View>
  );
}

/** The colour key that ties a table row to its segment in the bar above it. */
export const Swatch = ({ color }: { color: string }) => (
  <View style={[s.swatch, { backgroundColor: color }]} />
);

/**
 * A five-segment meter. Used for amenity penetration, where the score is how
 * many nearby listings already have the thing.
 */
export function DotMeter({ score, max = 5 }: { score: number; max?: number }) {
  const filled = Math.max(0, Math.min(max, Math.round(score)));
  return (
    <View style={s.row}>
      {Array.from({ length: max }, (_, i) => (
        <View
          key={i}
          style={[s.dot, { backgroundColor: i < filled ? RAMP[1] : C.BORDER }]}
        />
      ))}
    </View>
  );
}

/**
 * A tick. Drawn rather than typeset: neither DM Sans nor Helvetica carries
 * U+2713, so a checkmark character would come out as a blank box.
 */
export function Tick({ size = 7, color = C.INK }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 10 10">
      <Path
        d="M 1.5 5.2 L 4 7.8 L 8.5 2.2"
        stroke={color}
        strokeWidth={1.4}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function TickRow({ children, color }: { children: string; color?: string }) {
  return (
    <View style={[s.row, { gap: 6 }]}>
      <Tick color={color} />
      <Text style={color ? T.bodyOnDark : T.body}>{children}</Text>
    </View>
  );
}

/** A stat tile: small label, big figure, one line of context. */
export function StatCard({
  label,
  value,
  sub,
  children,
  style,
}: {
  label: string;
  value: string;
  sub?: string;
  children?: React.ReactNode;
  style?: Style;
}) {
  return (
    <Card style={{ flex: 1, ...(style ?? {}) }}>
      <Text style={T.label}>{label.toUpperCase()}</Text>
      <Text style={[T.figureLg, { marginTop: 5 }]}>{value}</Text>
      {children}
      {sub ? <Text style={[T.body, { marginTop: 4, color: C.MUTED }]}>{sub}</Text> : null}
    </Card>
  );
}

/** The bordered "indicative estimate" caveat on the setup page. */
export function Notice({ title, children }: { title: string; children: string }) {
  return (
    <View style={s.notice}>
      <View
        style={{
          width: 11,
          height: 11,
          borderRadius: 5.5,
          borderWidth: 0.8,
          borderColor: C.INK,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={[T.label, { fontSize: 6.5 }]}>i</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={T.label}>{title.toUpperCase()}</Text>
        <Text style={[T.body, { marginTop: 3 }]}>{children}</Text>
      </View>
    </View>
  );
}

export const Columns = ({
  children,
  gap = 10,
  style,
}: {
  children: React.ReactNode;
  gap?: number;
  style?: Style;
}) => <View style={[{ flexDirection: "row", gap }, style ?? {}]}>{children}</View>;
