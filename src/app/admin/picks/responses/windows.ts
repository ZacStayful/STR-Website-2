/**
 * The time windows the responses page and its CSV export share, so the two
 * can never drift and the download always matches what is on screen.
 */
export const WINDOWS = [
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "365", label: "12 months", days: 365 },
  { key: "all", label: "All time", days: null },
] as const;

export type ResponseWindow = (typeof WINDOWS)[number];

export const DEFAULT_WINDOW: ResponseWindow = WINDOWS[1];

/**
 * The window a `days` query param names. An unknown value (including an
 * inherited object key such as `toString`, which a bare `in` check would
 * wrongly accept and then multiply into NaN) falls back to the default.
 */
export function windowFor(key: unknown): ResponseWindow {
  return WINDOWS.find((w) => w.key === key) ?? DEFAULT_WINDOW;
}

/** Next hands a repeated query param as an array; every filter here wants one string. */
export function oneOf(v: string | string[] | undefined | null): string | null {
  if (typeof v === "string") return v;
  return Array.isArray(v) && typeof v[0] === "string" ? v[0] : null;
}
