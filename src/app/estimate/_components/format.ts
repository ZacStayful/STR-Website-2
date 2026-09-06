export function gbp(value: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
}
export function gbpSigned(value: number): string {
  return `${value < 0 ? '−' : '+'}${gbp(Math.abs(value))}`;
}
export function pct0(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${Math.round(value)}%`;
}
export function num0(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : new Intl.NumberFormat('en-GB').format(Math.round(value));
}
