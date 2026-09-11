/** Shared price formatting for listing prices (one place, every surface). */
export function formatListingPrice(price: { amount: number; period: string } | null | undefined, compact = false): string {
  if (!price) return '—';
  const amount = compact && price.amount >= 1000 ? `£${(price.amount / 1000).toFixed(price.amount >= 100_000 ? 0 : 1).replace(/\.0$/, '')}k` : `£${Math.round(price.amount).toLocaleString('en-GB')}`;
  const suffix = price.period === 'pcm' ? ' pcm' : price.period === 'pw' ? ' pw' : price.period === 'night' ? ' / night' : '';
  return `${amount}${suffix}`;
}
