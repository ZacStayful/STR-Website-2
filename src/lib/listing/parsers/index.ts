import type { ListingSnapshot, ListingSource } from '../types.ts';
import { parseRightmove, RIGHTMOVE_PARSER_VERSION } from './rightmove.ts';
import { parseOnTheMarket, ONTHEMARKET_PARSER_VERSION } from './onthemarket.ts';
import { parseAirbnb, AIRBNB_PARSER_VERSION } from './airbnb.ts';
import { parseZoopla, ZOOPLA_PARSER_VERSION } from './zoopla.ts';
import { parseBooking, BOOKING_PARSER_VERSION } from './booking.ts';
import type { ParseContext } from './shared.ts';

export type { ParseContext } from './shared.ts';

export const PARSER_VERSIONS: Record<ListingSource, number> = {
  rightmove: RIGHTMOVE_PARSER_VERSION,
  onthemarket: ONTHEMARKET_PARSER_VERSION,
  airbnb: AIRBNB_PARSER_VERSION,
  zoopla: ZOOPLA_PARSER_VERSION,
  booking: BOOKING_PARSER_VERSION,
};

/**
 * Parses a listing page for the given source. Never throws: a parser that
 * blows up on unexpected markup yields null, which the caller reports as
 * "could not read this listing" and logs with the parser version.
 */
export function parseListing(source: ListingSource, html: string, ctx: ParseContext): ListingSnapshot | null {
  try {
    switch (source) {
      case 'rightmove':
        return parseRightmove(html, ctx);
      case 'onthemarket':
        return parseOnTheMarket(html, ctx);
      case 'airbnb':
        return parseAirbnb(html, ctx);
      case 'zoopla':
        return parseZoopla(html, ctx);
      case 'booking':
        return parseBooking(html, ctx);
    }
  } catch (err) {
    console.error(`[listing] ${source} parser v${PARSER_VERSIONS[source]} threw:`, err);
    return null;
  }
}
