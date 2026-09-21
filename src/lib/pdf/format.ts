/**
 * Formatting helpers for the PDF documents.
 *
 * These used to live in `components/Chrome.tsx`, which meant a test could not
 * reach them: `npm test` runs `node --test 'src/**\/*.test.ts'` and Node strips
 * types but does not transform JSX, so nothing under test can import a `.tsx`.
 * They are pure, so they live here and Chrome re-exports them for the two
 * legacy documents that already import them from there.
 */

export const formatGbp = (value: number): string =>
  `£${Math.round(value).toLocaleString("en-GB")}`;

export const formatGbpSigned = (value: number): string => {
  const abs = Math.abs(Math.round(value)).toLocaleString("en-GB");
  const sign = value >= 0 ? "+" : "−";
  return `${sign}£${abs}`;
};

export const formatPercent = (value: number): string => `${Math.round(value * 100)}%`;

/** Legacy: the star is kept for the deal sheet and area report. */
export const formatRating = (value: number): string =>
  value > 0 ? `${value.toFixed(1)} ★` : "—";

/**
 * The new report prints ratings bare. Neither DM Sans nor Helvetica carries
 * U+2605, so a star would render as a blank box.
 */
export const formatRatingPlain = (value: number): string =>
  value > 0 ? value.toFixed(1) : "—";

/** Axis labels: `£0`, `£0.5k`, `£2k`. Keeps a 12-column chart legible. */
export function formatGbpCompact(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) < 1000) return `£${Math.round(value)}`;
  const k = value / 1000;
  const body = Number.isInteger(k) ? String(k) : k.toFixed(1).replace(/\.0$/, "");
  return `£${body}k`;
}

/**
 * `DD.MM.YYYY` for the footer and the masthead.
 *
 * Takes the report's own creation date, never the clock: `/r/[token]/pdf`
 * re-renders on every click, so a wall-clock date would change each time a
 * prospect reopened the same link.
 */
export function formatIssued(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

const UK_POSTCODE =
  /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;

/** `LE1 6TE` → `LE1`. Empty string when there is nothing usable. */
export function outwardCode(postcode: string | null | undefined): string {
  if (!postcode) return "";
  const trimmed = postcode.trim().toUpperCase();
  if (!trimmed) return "";
  const outward = trimmed.split(/\s+/)[0];
  return /^[A-Z]{1,2}\d[A-Z\d]?$/.test(outward) ? outward : "";
}

const NOT_A_TOWN = new Set([
  "UK", "U.K.", "UNITED KINGDOM", "GREAT BRITAIN", "GB",
  "ENGLAND", "SCOTLAND", "WALES", "NORTHERN IRELAND",
]);

/**
 * Splits `22 Princess Road West, Leicester, LE1 6TE, UK` into the street line
 * and the town, for the page-1 headline and the running header.
 *
 * A best-effort fallback only. When the analysis carries a geocoded locality
 * that is used instead — this exists so reports saved before locality was
 * captured still show a town rather than a bare address.
 */
export function splitAddress(
  address: string,
  postcode?: string | null,
): { line1: string; locality: string } {
  const cleaned = (address ?? "").replace(UK_POSTCODE, "").trim();
  const parts = cleaned
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !NOT_A_TOWN.has(p.toUpperCase()));

  if (parts.length === 0) return { line1: (address ?? "").trim(), locality: "" };
  if (parts.length === 1) {
    return { line1: parts[0], locality: outwardCode(postcode) };
  }
  return { line1: parts.slice(0, -1).join(", "), locality: parts[parts.length - 1] };
}
