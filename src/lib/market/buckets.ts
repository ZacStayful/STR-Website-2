/**
 * Quantile buckets for the map legend. Splits the visible areas into up to
 * four bands at the (nicely rounded) 25th, 50th and 75th percentiles so the
 * legend reads "< £20k · £20k – £26k · £26k – £31k · ≥ £31k" instead of a
 * continuous ramp. Thresholds are deduped and clipped to the data range so
 * no band is ever empty: with thin data (a handful of districts, identical
 * values) the scale degrades to three, two or one band rather than lying.
 */

export interface BucketScale {
  /** Ascending, strictly increasing; a value v falls in band `thresholds.filter(t => v >= t).length`. */
  thresholds: number[];
  /** One label per band (thresholds.length + 1). */
  labels: string[];
}

/** Thresholds at the rounded quartiles, strictly increasing and inside (min, max]. */
export function quantileThresholds(values: number[], step = 1): number[] {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < 2) return [];
  const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  const nice = (x: number) => (step > 0 ? Math.round(x / step) * step : x);
  const out: number[] = [];
  for (const raw of [q(0.25), q(0.5), q(0.75)]) {
    const t = nice(raw);
    if (t <= v[0] || t > v[v.length - 1]) continue; // would leave an empty band
    if (out.length === 0 || t > out[out.length - 1]) out.push(t);
  }
  return out;
}

/** Index of the band a value falls in (0 = lowest). */
export function bucketIndex(value: number, thresholds: number[]): number {
  let i = 0;
  for (const t of thresholds) if (value >= t) i += 1;
  return i;
}

export function bucketLabels(thresholds: number[], format: (v: number) => string): string[] {
  if (thresholds.length === 0) return ['All areas'];
  const labels = [`< ${format(thresholds[0])}`];
  for (let i = 1; i < thresholds.length; i += 1) labels.push(`${format(thresholds[i - 1])} – ${format(thresholds[i])}`);
  labels.push(`≥ ${format(thresholds[thresholds.length - 1])}`);
  return labels;
}

export function buildBuckets(values: number[], step: number, format: (v: number) => string): BucketScale {
  const thresholds = quantileThresholds(values, step);
  return { thresholds, labels: bucketLabels(thresholds, format) };
}

/**
 * Pick `n` swatches from a light→dark palette so a short scale still spans
 * the full contrast (two bands = lightest + darkest, not the two lightest).
 */
export function spreadPalette<T>(palette: T[], n: number): T[] {
  if (n <= 0) return [];
  if (n >= palette.length) return palette.slice(0, n);
  if (n === 1) return [palette[palette.length - 1]];
  return Array.from({ length: n }, (_, i) => palette[Math.round((i * (palette.length - 1)) / (n - 1))]);
}
