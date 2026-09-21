import React from "react";
import { View, Text, Svg, Path, Rect, Circle, Line, StyleSheet } from "@react-pdf/renderer";
import { C, RAMP, SIZE } from "../tokens";
import { T } from "../typography";
import {
  arcPath, scaleLinear, padDomain, niceAxisMax, niceTicks,
  bandWidths, mergeRuns, clamp, safe,
} from "./geometry";
import { formatGbpCompact } from "../../format";

/**
 * Every chart in the report.
 *
 * Two rules hold throughout. Labels are real <Text> in absolutely-positioned
 * boxes, never SVG <Text>: react-pdf's SVG text ignores letterSpacing and
 * resolves fonts through a separate path. And there is no text measurement API,
 * so anything centred sits in a fixed-width box with textAlign, never at an
 * offset computed from string length.
 */

const s = StyleSheet.create({
  rel: { position: "relative" },
  centred: { position: "absolute", alignItems: "center" },
  track: { height: 3, borderRadius: 1.5, backgroundColor: C.BORDER, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center" },
});

// ── Progress ring ────────────────────────────────────────────────────────
export function Ring({
  value,
  max = 100,
  size = 62,
  stroke = 5,
  color = C.ACCENT,
  trackColor = "#33402E",
  label,
}: {
  value: number;
  max?: number;
  size?: number;
  stroke?: number;
  color?: string;
  trackColor?: string;
  label?: string;
}) {
  const frac = clamp(safe(value) / (max || 1), 0, 1);
  const r = (size - stroke) / 2;
  const c = size / 2;
  const arc = arcPath(c, c, r, frac);
  return (
    <View style={[s.rel, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={c} cy={c} r={r} stroke={trackColor} strokeWidth={stroke} fill="none" />
        {/* A full ring has identical endpoints, which most renderers draw as
            nothing, so it is a plain circle instead. */}
        {frac >= 0.999 ? (
          <Circle cx={c} cy={c} r={r} stroke={color} strokeWidth={stroke} fill="none" />
        ) : arc ? (
          <Path d={arc} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" />
        ) : null}
      </Svg>
      <View style={[s.centred, { top: 0, left: 0, width: size, height: size, justifyContent: "center" }]}>
        <Text style={[T.figureMd, { color: C.CREAM }]}>{Math.round(safe(value))}</Text>
        {label ? <Text style={[T.micro, { color: C.ACCENT }]}>{label}</Text> : null}
      </View>
    </View>
  );
}

// ── Semicircular risk gauge ──────────────────────────────────────────────
export function Gauge({ value, max = 100, width = 200 }: { value: number; max?: number; width?: number }) {
  const t = clamp(safe(value) / (max || 1), 0, 1);
  const r = width / 2 - 10;
  const cx = width / 2;
  const cy = r + 14;
  const height = cy + 10;

  // The dial is drawn as a fan of radial ticks rather than a solid arc: it
  // reads as an instrument, and the density carries the scale on its own.
  const TICKS = 45;
  return (
    <View style={[s.rel, { width, height }]}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {Array.from({ length: TICKS + 1 }, (_, i) => {
          const f = i / TICKS;
          const a = Math.PI + Math.PI * f;
          const major = i % 5 === 0;
          const inner = r - (major ? 13 : 9);
          const outer = r;
          return (
            <Line
              key={i}
              x1={cx + inner * Math.cos(a)}
              y1={cy + inner * Math.sin(a)}
              x2={cx + outer * Math.cos(a)}
              y2={cy + outer * Math.sin(a)}
              // Ticks up to the reading are solid; past it they fade back.
              stroke={f <= t ? RAMP[1] : RAMP[3]}
              strokeWidth={major ? 1.3 : 0.9}
            />
          );
        })}
        <Line
          x1={cx}
          y1={cy}
          x2={cx + (r - 16) * Math.cos(Math.PI + Math.PI * t)}
          y2={cy + (r - 16) * Math.sin(Math.PI + Math.PI * t)}
          stroke={C.INK}
          strokeWidth={1.2}
        />
        <Circle cx={cx} cy={cy} r={3.4} fill={C.INK} />
      </Svg>
      <View style={{ position: "absolute", top: cy - 1, left: 0, width }}>
        <View style={[s.row, { justifyContent: "space-between" }]}>
          <Text style={T.micro}>LOW</Text>
          <Text style={T.micro}>HIGH</Text>
        </View>
      </View>
    </View>
  );
}

// ── Nightly rate against occupancy ───────────────────────────────────────
export interface ScatterPoint {
  nightly: number;
  occupancy: number;
  top: boolean;
}

export function Scatter({
  points,
  subject,
  width,
  height = 130,
}: {
  points: ScatterPoint[];
  subject: { nightly: number; occupancy: number; label: string };
  width: number;
  height?: number;
}) {
  const PAD_L = 30;
  const PAD_B = 18;
  const PAD_T = 8;
  const plotW = width - PAD_L - 8;
  const plotH = height - PAD_B - PAD_T;

  // The subject is inside the domain so its marker can never be clipped.
  const rates = [...points.map((p) => p.nightly), subject.nightly].filter(Number.isFinite);
  const [x0, x1] = padDomain(Math.min(...rates), Math.max(...rates));
  const sx = scaleLinear(x0, x1, PAD_L, PAD_L + plotW);
  const sy = scaleLinear(0, 1, PAD_T + plotH, PAD_T);

  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const xTicks = niceTicks(x0, x1, 4);
  const subX = sx(subject.nightly);
  const subY = sy(clamp(subject.occupancy, 0, 1));
  // Flip the callout when the marker sits far right, so it stays on the page.
  const flip = subX > PAD_L + plotW * 0.62;

  return (
    <View style={[s.rel, { width, height }]}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {yTicks.map((t) => (
          <Line key={t} x1={PAD_L} y1={sy(t)} x2={PAD_L + plotW} y2={sy(t)} stroke={C.BORDER} strokeWidth={0.5} />
        ))}
        {xTicks.map((v, i) => (
          <Line key={i} x1={sx(v)} y1={PAD_T} x2={sx(v)} y2={PAD_T + plotH} stroke={C.BORDER} strokeWidth={0.4} strokeDasharray="1 2" />
        ))}
        {points.map((p, i) => (
          <Circle
            key={i}
            cx={sx(p.nightly)}
            cy={sy(clamp(p.occupancy, 0, 1))}
            r={2.6}
            fill={p.top ? C.INK : "none"}
            stroke={p.top ? C.INK : C.MUTED}
            strokeWidth={0.9}
          />
        ))}
        <Circle cx={subX} cy={subY} r={7.5} fill="none" stroke={C.INK} strokeWidth={0.7} strokeDasharray="1.5 1.5" />
        <Circle cx={subX} cy={subY} r={4} fill={RAMP[1]} />
        <Line
          x1={flip ? subX - 9 : subX + 9}
          y1={subY}
          x2={flip ? subX - 26 : subX + 26}
          y2={subY - 12}
          stroke={C.INK}
          strokeWidth={0.6}
        />
      </Svg>

      {yTicks.map((t) => (
        <Text key={t} style={[T.micro, { position: "absolute", left: 0, top: sy(t) - 3, width: PAD_L - 5, textAlign: "right" }]}>
          {Math.round(t * 100)}%
        </Text>
      ))}
      {xTicks.map((v, i) => (
        <Text key={i} style={[T.micro, { position: "absolute", left: sx(v) - 20, top: PAD_T + plotH + 4, width: 40, textAlign: "center" }]}>
          £{Math.round(v)}
        </Text>
      ))}
      <Text
        style={[
          T.micro,
          {
            position: "absolute",
            top: subY - 22,
            width: 150,
            color: C.INK,
            ...(flip ? { left: subX - 176, textAlign: "right" } : { left: subX + 26, textAlign: "left" }),
          },
        ]}
      >
        {subject.label.toUpperCase()}
      </Text>
    </View>
  );
}

// ── Twelve-month column chart ────────────────────────────────────────────
export function Columns({
  months,
  baseline,
  width,
  height = 150,
}: {
  months: Array<{ month: string; net: number; peak: boolean }>;
  baseline: number;
  width: number;
  height?: number;
}) {
  const PAD_L = 34;
  const PAD_B = 16;
  const PAD_T = 14;
  const plotW = width - PAD_L - 6;
  const plotH = height - PAD_B - PAD_T;
  // The axis maximum comes from the data, so "£2k" is derived, never assumed.
  const yMax = niceAxisMax(Math.max(...months.map((m) => safe(m.net)), safe(baseline)));
  const yOf = (v: number) => PAD_T + plotH - (clamp(safe(v) / yMax, 0, 1) * plotH);
  const colW = plotW / Math.max(1, months.length);
  const barW = colW * 0.56;
  const xOf = (i: number) => PAD_L + i * colW + (colW - barW) / 2;
  const gridlines = [0, 0.25, 0.5, 0.75, 1];

  return (
    <View style={[s.rel, { width, height }]}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {gridlines.map((g) => (
          <Line key={g} x1={PAD_L} y1={yOf(yMax * g)} x2={PAD_L + plotW} y2={yOf(yMax * g)} stroke={C.BORDER} strokeWidth={0.5} />
        ))}
        {months.map((m, i) => (
          <Rect
            key={i}
            x={xOf(i)}
            y={yOf(m.net)}
            width={barW}
            height={Math.max(0, PAD_T + plotH - yOf(m.net))}
            fill={m.peak ? C.INK : RAMP[1]}
          />
        ))}
        {baseline > 0 ? (
          <Line x1={PAD_L} y1={yOf(baseline)} x2={PAD_L + plotW} y2={yOf(baseline)} stroke={C.INK} strokeWidth={0.8} strokeDasharray="3 2" />
        ) : null}
      </Svg>

      {gridlines.map((g) => (
        <Text key={g} style={[T.micro, { position: "absolute", left: 0, top: yOf(yMax * g) - 3, width: PAD_L - 6, textAlign: "right" }]}>
          {formatGbpCompact(yMax * g)}
        </Text>
      ))}
      {months.map((m, i) => (
        <React.Fragment key={i}>
          {/* Fixed-width centred boxes: there is no way to measure text. */}
          <Text style={[T.micro, { position: "absolute", left: xOf(i) - 8, top: Math.max(0, yOf(m.net) - 9), width: barW + 16, textAlign: "center", color: C.INK }]}>
            £{Math.round(safe(m.net)).toLocaleString("en-GB")}
          </Text>
          <Text style={[T.micro, { position: "absolute", left: xOf(i) - 8, top: PAD_T + plotH + 4, width: barW + 16, textAlign: "center" }]}>
            {m.month.slice(0, 3).toUpperCase()}
          </Text>
        </React.Fragment>
      ))}
    </View>
  );
}

// ── Segmented bar ────────────────────────────────────────────────────────
export function SegmentedBar({
  values,
  colors,
  scaleMax,
  width,
  height = 22,
}: {
  values: number[];
  colors: string[];
  scaleMax: number;
  width: number;
  height?: number;
}) {
  const widths = bandWidths(values, scaleMax, width);
  return (
    <View style={{ flexDirection: "row", width, height, borderRadius: 2, overflow: "hidden" }}>
      {widths.map((w, i) =>
        // A zero-width segment (self-managed removes the management fee)
        // would otherwise render as a hairline sliver.
        w > 0.4 ? <View key={i} style={{ width: w, height, backgroundColor: colors[i] }} /> : null,
      )}
    </View>
  );
}

// ── Property value range ─────────────────────────────────────────────────
export function RangeAxis({ low, high, width }: { low: number; high: number; width: number }) {
  const [d0, d1] = padDomain(low, high, 0.35);
  const x = scaleLinear(d0, d1, 0, width);
  const ticks = Array.from({ length: 21 }, (_, i) => (i / 20) * width);
  return (
    <View style={{ width, height: 16, position: "relative" }}>
      <View style={{ position: "absolute", top: 7.5, left: 0, width, height: 0.7, backgroundColor: C.INK }} />
      {ticks.map((t, i) => (
        <View
          key={i}
          style={{
            position: "absolute",
            left: t,
            top: i % 5 === 0 ? 3 : 5,
            width: 0.7,
            height: i % 5 === 0 ? 9 : 5,
            backgroundColor: C.INK,
          }}
        />
      ))}
      <View style={{ position: "absolute", left: x(low), top: 2, width: 1.4, height: 11, backgroundColor: C.INK }} />
      <View style={{ position: "absolute", left: x(high), top: 2, width: 1.4, height: 11, backgroundColor: C.INK }} />
    </View>
  );
}

// ── QR code ──────────────────────────────────────────────────────────────
export function Qr({ matrix, size, dark = C.INK, light = C.CREAM }: {
  matrix: { size: number; rows: boolean[][] };
  size: number;
  dark?: string;
  light?: string;
}) {
  // The spec's minimum quiet zone. Without it, scanners struggle.
  const quiet = 4;
  const cell = size / (matrix.size + quiet * 2);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* The field is always light and the modules dark, even on a dark panel. */}
      <Rect x={0} y={0} width={size} height={size} fill={light} />
      {matrix.rows.map((row, y) =>
        mergeRuns(row).map(([x0, len]) => (
          <Rect
            key={`${y}:${x0}`}
            x={(x0 + quiet) * cell}
            y={(y + quiet) * cell}
            /* The slight overlap hides the hairline seams renderers leave
               between exactly-adjacent rectangles. */
            width={len * cell + 0.06}
            height={cell + 0.06}
            fill={dark}
          />
        )),
      )}
    </Svg>
  );
}

// ── Four-step timeline ───────────────────────────────────────────────────
export function Timeline({ steps, width }: { steps: string[]; width: number }) {
  const n = Math.max(1, steps.length);
  const colW = width / n;
  const cy = 6;
  return (
    <Svg width={width} height={14} viewBox={`0 0 ${width} 14`}>
      <Line x1={colW / 2} y1={cy} x2={width - colW / 2} y2={cy} stroke={C.INK} strokeWidth={0.8} />
      {steps.map((_, i) => (
        <Circle
          key={i}
          cx={colW / 2 + i * colW}
          cy={cy}
          r={4}
          fill={i === steps.length - 1 ? C.INK : C.PAGE}
          stroke={C.INK}
          strokeWidth={1}
        />
      ))}
    </Svg>
  );
}

/** A thin progress track, for the risk factors and the occupancy stat. */
export function Meter({ value, max = 100, width, color = RAMP[1] }: {
  value: number; max?: number; width: number; color?: string;
}) {
  const w = clamp(safe(value) / (max || 1), 0, 1) * width;
  return (
    <View style={[s.track, { width }]}>
      <View style={{ width: w, height: 3, backgroundColor: color }} />
    </View>
  );
}

export const CHART_FONT_SIZE = SIZE.micro;
