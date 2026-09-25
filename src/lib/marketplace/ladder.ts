/**
 * What opening a deal sheet costs, by how much the deal is worth.
 *
 * A member pays to see the address, photos and listing link of a deal on the
 * marketplace. The price is banded on the deal's annual profit — the annual
 * surplus over a long let for a purchase, the annual profit after rent for a
 * rent-to-rent — so a £60k-a-year deal costs more to open than a £10k one. The
 * raw cost of a deal is a fraction of a penny (see the sweep), so this is a
 * value price, not a cost-plus one, and the ladder lives in `billing_settings`
 * (`deal_open_ladder`) so it can be retuned against real usage without a deploy.
 *
 * Pure: no `server-only`, imported by `credit/unit-costs.ts` and the tests.
 */

export interface LadderBand {
  /** Annual profit strictly below this qualifies for the band; null is the top band. */
  upTo: number | null;
  /** Base pence charged to open. */
  pence: number;
}

export type DealOpenLadder = LadderBand[];

/** Ladder D from the pricing work: ~36p weighted average across live deals. */
export const DEFAULT_DEAL_OPEN_LADDER: DealOpenLadder = [
  { upTo: 15_000, pence: 25 },
  { upTo: 25_000, pence: 40 },
  { upTo: 40_000, pence: 60 },
  { upTo: 60_000, pence: 80 },
  { upTo: null, pence: 100 },
];

/**
 * A stored ladder back into a usable one, defensively. Anything malformed —
 * not an array, a band without a positive price, bands out of order, no open
 * top band — falls back to the default rather than mispricing every open.
 */
export function parseLadder(raw: unknown): DealOpenLadder {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_DEAL_OPEN_LADDER;
  const out: DealOpenLadder = [];
  let lastUpTo = -Infinity;
  for (const item of raw) {
    if (!item || typeof item !== 'object') return DEFAULT_DEAL_OPEN_LADDER;
    const o = item as Record<string, unknown>;
    const pence = Number(o.pence);
    if (!Number.isFinite(pence) || pence < 0) return DEFAULT_DEAL_OPEN_LADDER;
    const upTo = o.upTo === null || o.upTo === undefined ? null : Number(o.upTo);
    if (upTo !== null && (!Number.isFinite(upTo) || upTo <= lastUpTo)) return DEFAULT_DEAL_OPEN_LADDER;
    if (lastUpTo === Infinity) return DEFAULT_DEAL_OPEN_LADDER; // a band after the top band
    out.push({ upTo, pence: Math.round(pence * 100) / 100 });
    lastUpTo = upTo === null ? Infinity : upTo;
  }
  if (lastUpTo !== Infinity) return DEFAULT_DEAL_OPEN_LADDER; // no open top band
  return out;
}

/**
 * The open price for a deal, in base pence. A deal with no profit figure (an
 * older row, or one whose screening could not be banded) prices at the lowest
 * band: the member is charged for the least we can vouch for, never the most.
 */
export function openPricePence(annualProfit: number | null | undefined, ladder: DealOpenLadder = DEFAULT_DEAL_OPEN_LADDER): number {
  const profit = typeof annualProfit === 'number' && Number.isFinite(annualProfit) ? annualProfit : -Infinity;
  for (const band of ladder) {
    if (band.upTo === null || profit < band.upTo) return band.pence;
  }
  return ladder[ladder.length - 1]?.pence ?? DEFAULT_DEAL_OPEN_LADDER[0].pence;
}

/** Which band a profit falls in, 0-based, for the admin distribution. */
export function ladderBandIndex(annualProfit: number | null | undefined, ladder: DealOpenLadder = DEFAULT_DEAL_OPEN_LADDER): number {
  const profit = typeof annualProfit === 'number' && Number.isFinite(annualProfit) ? annualProfit : -Infinity;
  for (let i = 0; i < ladder.length; i += 1) {
    const band = ladder[i];
    if (band.upTo === null || profit < band.upTo) return i;
  }
  return ladder.length - 1;
}

const gbp = (pence: number) => (pence >= 100 && pence % 100 === 0 ? `£${pence / 100}` : pence >= 100 ? `£${(pence / 100).toFixed(2)}` : `${Math.round(pence)}p`);

/** "25p", "£1", "£1.20": how a price is shown on the card. */
export function formatOpenPrice(pence: number): string {
  return pence <= 0 ? 'Free' : gbp(pence);
}

/** "under £15k", "£15k–£25k", "£60k+": the band's label for the admin ladder editor. */
export function describeBand(ladder: DealOpenLadder, index: number): string {
  const k = (n: number) => `£${Math.round(n / 1000)}k`;
  const band = ladder[index];
  if (!band) return '';
  const prev = index > 0 ? ladder[index - 1].upTo : null;
  if (band.upTo === null) return prev === null ? 'any profit' : `${k(prev)}+`;
  if (prev === null) return `under ${k(band.upTo)}`;
  return `${k(prev)}–${k(band.upTo)}`;
}
