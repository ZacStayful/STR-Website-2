/** Display formatting helpers for Market Explorer. */

export function gbp(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(value);
}

/** Compact GBP, e.g. £28k, £1.2m — for tight stat rows. */
export function gbpCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function pct(value: number | null | undefined, dp = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(dp)}%`;
}
