/**
 * The facts the next-step slot needs, taken from what My deals and the deal
 * page already hold, so filling the slot adds no reads there.
 *
 * THE ADDRESS RULE (Batch 5): the address is only passed on for a deal the
 * member may see the whole of. An unopened marketplace deal gets no address
 * here whatever the caller holds, and the slot shows nothing for it anyway.
 *
 * Pure: no network, no database, no `server-only`.
 */
import type { ViewerDeal } from '../listing/tracked.ts';
import type { DealFacts } from './facts.ts';

/** The card columns My deals loads for a marketplace deal (TrackedCard / DealCard). */
export interface CardFacts {
  kind: string;
  town: string | null;
  bedrooms: number | null;
  price_amount: number | string | null;
  price_period: string | null;
  listed_date: string | null;
  first_seen_at: string | null;
  price_history?: unknown;
  motivation?: unknown;
  status: 'live' | 'retired' | 'pending_verify';
  retired_reason?: string | null;
  last_confirmed_at?: string | null;
  postcode_area: string | null;
}

function price(amount: number | string | null, period: string | null): DealFacts['price'] {
  const n = amount === null ? NaN : Number(amount);
  return Number.isFinite(n) ? { amount: n, period: period ?? 'total' } : null;
}

/** A marketplace deal: on My deals (card + address) or on its own page (row + sheet address). */
export function factsFromCard(card: CardFacts, opened: boolean, address: string | null): DealFacts {
  return {
    kind: card.kind,
    address: opened ? address : null,
    town: card.town,
    bedrooms: card.bedrooms,
    price: price(card.price_amount, card.price_period),
    listedDate: card.listed_date,
    firstSeenAt: card.first_seen_at,
    priceHistory: card.price_history,
    motivation: card.motivation,
    dealStatus: card.status,
    retiredReason: card.retired_reason ?? null,
    lastConfirmedAt: card.last_confirmed_at ?? null,
    postcodeArea: card.postcode_area,
    marketplace: true,
  };
}

/** One My deals item: a marketplace deal when there is a card, else a listing the member added. */
export function factsFromTracked(item: Pick<ViewerDeal, 'kind' | 'opened' | 'price' | 'area' | 'listing'>, card: CardFacts | null, address: string | null): DealFacts {
  if (card) return factsFromCard(card, item.opened, item.listing?.address ?? address);
  return {
    kind: item.kind,
    address: item.opened ? item.listing?.address ?? null : null,
    town: null,
    bedrooms: item.listing?.bedrooms ?? null,
    price: item.price,
    listedDate: null,
    firstSeenAt: null,
    dealStatus: null,
    retiredReason: null,
    lastConfirmedAt: null,
    postcodeArea: item.area,
    marketplace: false,
  };
}
