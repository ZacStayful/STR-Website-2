/** Display formatting helpers for Market Explorer. */

export function gbp(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Compact GBP, e.g. £28k, £1.2m — for tight stat rows.
 * Implemented manually (not Intl `notation: 'compact'`) so the output is
 * identical on the Node server and in the browser — Intl compact formatting
 * can differ between ICU versions and caused a hydration mismatch (React #418)
 * when rendered inside the client-side card grid.
 */
export function gbpCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}£${trim(abs / 1_000_000)}m`;
  if (abs >= 1_000) return `${sign}£${trim(abs / 1_000)}k`;
  return `${sign}£${Math.round(abs)}`;
}

/** One decimal place, but drop a trailing ".0" (28.0 → "28", 1.25 → "1.3"). */
function trim(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export function pct(value: number | null | undefined, dp = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(dp)}%`;
}
