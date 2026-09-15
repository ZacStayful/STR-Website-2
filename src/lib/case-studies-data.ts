// Forecast-vs-actual record for the six properties Stayful took under
// management in 2025. Ported from the inline SAMPLES array that used to live
// in ReportGallery.tsx.
//
// Metrics are stored as NUMBERS, not formatted strings. Every accuracy claim
// on the site is derived from them via accuracySummary() so that the headline
// figures cannot drift from the per-property rows.
//
// ADR is deliberately absent from the public shape. In the source data the
// forecast and actual ADR columns do not measure the same thing: actual ADR
// x actual occupancy x 365 comes out below actual owner net on several
// properties, which is impossible like-for-like. Until the two definitions
// are reconciled, ADR stays in the full PDF where it has room to be caveated.

export type MetricKey = "ownerNet" | "occupancy";

export interface MetricPair {
  /** What the Analyser projected before the property went live. */
  forecast: number;
  /** What it actually did, from live booking data. */
  actual: number;
}

/** Whose booking data the actual figure comes from. */
export type CaseStudySource = "managed" | "direct" | "owner-reported";

export interface CaseStudy {
  id: string;
  title: string;
  city: string;
  meta: string;
  img: string;
  pdf: string;
  source: CaseStudySource;
  /** Window the actual covers. */
  period: string;
  /** Month the forecast was produced, before onboarding. */
  forecastDate: string;
  metrics: Record<MetricKey, MetricPair>;
}

export const ACCURACY_WINDOW = "Jan–Dec 2025";
export const FORECAST_WINDOW = "Nov 2024 – Feb 2025";

export const CASE_STUDIES: CaseStudy[] = [
  {
    id: "york-park-crescent",
    title: "17 Park Crescent",
    city: "York",
    meta: "3 bed · Sleeps 8",
    img: "/assets/property-york-park-crescent.png",
    pdf: "/assets/case-studies/york-park-crescent.pdf",
    source: "managed",
    period: ACCURACY_WINDOW,
    forecastDate: "2024-11",
    metrics: {
      ownerNet: { forecast: 30940, actual: 34727 },
      occupancy: { forecast: 78, actual: 73.9 },
    },
  },
  {
    id: "leeds-beechwood-mount",
    title: "7 Beechwood Mount",
    city: "Leeds",
    meta: "3 bed · Sleeps 8",
    img: "/assets/property-leeds-beechwood-mount.png",
    pdf: "/assets/case-studies/leeds-beechwood-mount.pdf",
    source: "managed",
    period: ACCURACY_WINDOW,
    forecastDate: "2024-12",
    metrics: {
      ownerNet: { forecast: 23084, actual: 25782 },
      occupancy: { forecast: 54, actual: 50.4 },
    },
  },
  {
    id: "lincoln-museum-court",
    title: "Museum Court",
    city: "Lincoln",
    meta: "2 bed · Sleeps 6",
    img: "/assets/property-lincoln-museum-court.png",
    pdf: "/assets/case-studies/lincoln-museum-court.pdf",
    source: "managed",
    period: ACCURACY_WINDOW,
    forecastDate: "2024-12",
    metrics: {
      ownerNet: { forecast: 32364, actual: 36288 },
      occupancy: { forecast: 68, actual: 64.2 },
    },
  },
  {
    id: "edinburgh-geissler-drive",
    title: "21 Geissler Drive",
    city: "Edinburgh",
    meta: "1 bed · Sleeps 4",
    img: "/assets/property-edinburgh-geissler-drive.png",
    pdf: "/assets/case-studies/edinburgh-geissler-drive.pdf",
    source: "managed",
    period: ACCURACY_WINDOW,
    forecastDate: "2025-01",
    metrics: {
      ownerNet: { forecast: 36175, actual: 46169 },
      occupancy: { forecast: 77, actual: 78.6 },
    },
  },
  {
    id: "manchester-eastbank-tower",
    title: "803 Eastbank Tower",
    city: "Manchester",
    meta: "3 bed · Sleeps 8",
    img: "/assets/property-manchester-eastbank-tower.png",
    pdf: "/assets/case-studies/manchester-eastbank-tower.pdf",
    source: "managed",
    period: ACCURACY_WINDOW,
    forecastDate: "2025-01",
    metrics: {
      ownerNet: { forecast: 32422, actual: 35917 },
      occupancy: { forecast: 73, actual: 68.7 },
    },
  },
  {
    id: "salisbury-west-street",
    title: "West Street, Wilton",
    city: "Salisbury",
    meta: "2 bed · Sleeps 6",
    img: "/assets/property-salisbury-west-street.png",
    pdf: "/assets/case-studies/salisbury-west-street.pdf",
    source: "managed",
    period: ACCURACY_WINDOW,
    forecastDate: "2025-02",
    metrics: {
      ownerNet: { forecast: 29557, actual: 33654 },
      occupancy: { forecast: 70, actual: 65.1 },
    },
  },
];

export const METRIC_LABELS: Record<MetricKey, string> = {
  ownerNet: "Owner net",
  occupancy: "Occupancy",
};

const SOURCE_LABELS: Record<CaseStudySource, string> = {
  managed: "Stayful-managed",
  direct: "Direct bookings",
  "owner-reported": "Owner-reported",
};

export function sourceLabel(source: CaseStudySource): string {
  return SOURCE_LABELS[source];
}

export function formatMetric(key: MetricKey, value: number): string {
  if (key === "occupancy") {
    // Keep one decimal only where the source data carries one.
    return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
  }
  return `£${Math.round(value).toLocaleString("en-GB")}`;
}

/**
 * Signed difference between actual and forecast.
 * Money is a fraction of forecast; occupancy is a difference in points,
 * because a percentage change of a percentage reads as nonsense.
 */
export function variance(key: MetricKey, pair: MetricPair): number {
  if (key === "occupancy") return pair.actual - pair.forecast;
  return (pair.actual - pair.forecast) / pair.forecast;
}

export function formatVariance(key: MetricKey, pair: MetricPair): string {
  const v = variance(key, pair);
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  const abs = Math.abs(v);
  if (key === "occupancy") return `${sign}${abs.toFixed(1)} pts`;
  return `${sign}${(abs * 100).toFixed(1)}%`;
}

export interface MetricAccuracy {
  key: MetricKey;
  label: string;
  /** Signed mean, in the unit variance() returns for this metric. */
  meanVariance: number;
  medianVariance: number;
  meanAbsVariance: number;
  /** Largest miss in either direction, by absolute size. */
  worstVariance: number;
  /** How many of the sample came in above forecast. */
  aboveForecast: number;
  n: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function accuracySummary(
  studies: CaseStudy[] = CASE_STUDIES,
  keys: MetricKey[] = ["ownerNet", "occupancy"],
): MetricAccuracy[] {
  return keys.map((key) => {
    const variances = studies.map((s) => variance(key, s.metrics[key]));
    const worst = variances.reduce(
      (acc, v) => (Math.abs(v) > Math.abs(acc) ? v : acc),
      0,
    );
    return {
      key,
      label: METRIC_LABELS[key],
      meanVariance: variances.reduce((a, b) => a + b, 0) / variances.length,
      medianVariance: median(variances),
      meanAbsVariance:
        variances.reduce((a, b) => a + Math.abs(b), 0) / variances.length,
      worstVariance: worst,
      aboveForecast: variances.filter((v) => v > 0).length,
      n: studies.length,
    };
  });
}
