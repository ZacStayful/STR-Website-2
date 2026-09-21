/**
 * The maths behind every chart in the report.
 *
 * Kept apart from the components that draw them for two reasons: a `.tsx` file
 * cannot be unit-tested here, and a NaN reaching an SVG coordinate makes
 * react-pdf render a blank or throw. Every function below clamps at the source
 * so a degenerate analysis (one comparable, zero occupancy, no bookings)
 * produces a dull chart rather than a broken document.
 */

export const clamp = (v: number, lo: number, hi: number): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

/** A finite number or the given fallback. Guards every external figure. */
export const safe = (v: number | null | undefined, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

export const polar = (
  cx: number,
  cy: number,
  r: number,
  angle: number,
): readonly [number, number] => [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A clockwise arc from 12 o'clock covering `frac` of a circle.
 *
 * Returns null at both extremes: a zero-length arc is undefined, and a
 * full-circle arc has identical start and end points, which most renderers
 * draw as nothing at all. Callers draw a plain <Circle> for the 100% case.
 */
export function arcPath(
  cx: number,
  cy: number,
  r: number,
  frac: number,
): string | null {
  const f = clamp(frac, 0, 1);
  if (f <= 0.001 || f >= 0.999) return null;
  const a0 = -Math.PI / 2;
  const a1 = a0 + 2 * Math.PI * f;
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  return `M ${round2(x0)} ${round2(y0)} A ${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${round2(x1)} ${round2(y1)}`;
}

/** Maps 0..1 onto the top half of a circle, left to right. */
export const gaugeAngle = (t: number): number => Math.PI + Math.PI * clamp(t, 0, 1);

/** An arc along the top half of a circle between two 0..1 positions. */
export function semiArcPath(
  cx: number,
  cy: number,
  r: number,
  t0: number,
  t1: number,
): string | null {
  const a = clamp(t0, 0, 1);
  const b = clamp(t1, 0, 1);
  if (Math.abs(b - a) < 0.001) return null;
  const [x0, y0] = polar(cx, cy, r, gaugeAngle(a));
  const [x1, y1] = polar(cx, cy, r, gaugeAngle(b));
  return `M ${round2(x0)} ${round2(y0)} A ${r} ${r} 0 ${b - a > 0.5 ? 1 : 0} 1 ${round2(x1)} ${round2(y1)}`;
}

/** A tapered needle from the hub to `t` along the gauge. */
export function needlePath(
  cx: number,
  cy: number,
  r: number,
  t: number,
  halfBase = 3,
): string {
  const a = gaugeAngle(t);
  const [tx, ty] = polar(cx, cy, Math.max(0, r - 8), a);
  const [lx, ly] = polar(cx, cy, halfBase, a + Math.PI / 2);
  const [rx, ry] = polar(cx, cy, halfBase, a - Math.PI / 2);
  return `M ${round2(tx)} ${round2(ty)} L ${round2(lx)} ${round2(ly)} L ${round2(rx)} ${round2(ry)} Z`;
}

/**
 * A linear scale. A zero-width domain — every comparable at the same nightly
 * rate — collapses to the midpoint of the range rather than dividing by zero.
 */
export function scaleLinear(
  d0: number,
  d1: number,
  r0: number,
  r1: number,
): (v: number) => number {
  const span = d1 - d0;
  if (!Number.isFinite(span) || Math.abs(span) < 1e-9) {
    const mid = (r0 + r1) / 2;
    return () => mid;
  }
  return (v: number) => r0 + ((safe(v) - d0) / span) * (r1 - r0);
}

/** Pads a domain so plotted points never sit on the axis. */
export function padDomain(
  lo: number,
  hi: number,
  factor = 0.1,
): readonly [number, number] {
  const l = safe(lo);
  const h = safe(hi);
  const pad = (h - l) * factor || Math.max(1, Math.abs(h) * factor || 1);
  return [l - pad, h + pad];
}

/** Rounds up to a friendly axis maximum: 1870 → 2000, 0 → 1. */
export function niceCeil(value: number): number {
  const v = safe(value);
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].find((m) => v <= m * mag);
  return (step ?? 10) * mag;
}

/**
 * Point widths for a set of values against a shared scale.
 *
 * Point widths, not percentages: react-pdf resolves a percentage inside a
 * percentage unpredictably, and these bars nest.
 */
export function bandWidths(
  values: number[],
  scaleMax: number,
  trackWidth: number,
): number[] {
  const max = safe(scaleMax);
  if (max <= 0) return values.map(() => 0);
  return values.map((v) => clamp((safe(v) / max) * trackWidth, 0, trackWidth));
}

/**
 * Collapses consecutive true cells into `[start, length]` runs.
 *
 * A 25×25 QR code is ~370 separate dark modules; merged, it is ~90 rectangles.
 */
export function mergeRuns(row: boolean[]): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i <= row.length; i += 1) {
    if (i < row.length && row[i]) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      runs.push([start, i - start]);
      start = -1;
    }
  }
  return runs;
}

/** Step sizes that produce gridline labels a reader can hold in their head. */
const NICE_STEPS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000];

/**
 * An axis maximum that divides into round gridlines.
 *
 * `niceCeil` alone gives a tidy maximum but arbitrary divisions: 2,500 in four
 * steps labels itself £625, £1.3k, £1.9k, £2.5k. Choosing the step first and
 * multiplying up gives £0.5k, £1k, £1.5k, £2k instead.
 */
export function niceAxisMax(maxValue: number, divisions = 4): number {
  const v = safe(maxValue);
  if (v <= 0) return divisions;
  const step = NICE_STEPS.find((c) => v / c <= divisions)
    ?? Math.ceil(v / divisions);
  return step * divisions;
}

/** Round values spread across a domain, for axis ticks. */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  const a = safe(lo);
  const b = safe(hi);
  const span = b - a;
  if (span <= 0) return [a];
  const raw = span / (count + 1);
  const step = NICE_STEPS.find((c) => c >= raw) ?? raw;
  const first = Math.ceil(a / step) * step;
  const out: number[] = [];
  for (let v = first; v <= b && out.length < count + 2; v += step) out.push(v);
  return out;
}

/**
 * How many months of extra income cover a setup cost. Null when there is no
 * extra income to recover it from — the page then says so rather than printing
 * "Infinity months".
 */
export function paybackMonths(
  setupCost: number,
  monthlyGain: number,
): number | null {
  const cost = safe(setupCost);
  const gain = safe(monthlyGain);
  if (cost <= 0) return 0;
  if (gain <= 0) return null;
  return Math.ceil(cost / gain);
}

/** The median of a list. Returns null for an empty one. */
export function median(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 0 ? (xs[mid - 1] + xs[mid]) / 2 : xs[mid];
}
