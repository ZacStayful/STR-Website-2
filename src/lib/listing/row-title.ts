/**
 * A My deals row's title, and the address rule (src/lib/listing/tracked.ts):
 * a marketplace deal shows its address only once it is opened; until then
 * only what its card shows (town, area, outcode). A listing the member added
 * themselves is theirs, address and all. Shared by My deals' rows and Batch
 * 22d's Start again tick list and Cleared deals, so they can never differ.
 *
 * Pure: no network, no database, no server-only.
 */
import { areaMetaForCode } from '../market/areas.ts';

export interface RowTitleCard {
  town: string | null;
  postcode_area: string | null;
  outcode: string | null;
}

export interface RowTitleItem {
  opened: boolean;
  listing: { title: string; address: string | null } | null;
}

/** Where a marketplace deal is, as its unopened card says it: never the address. */
export function dealWhere(card: RowTitleCard): string {
  const area = card.postcode_area ? areaMetaForCode(card.postcode_area) : null;
  return [card.town, area?.name && area.name !== card.town ? area.name : null, card.outcode].filter(Boolean).join(' · ') || 'Location on the sheet';
}

/** `address`: an opened deal's address when it has no pipeline row of its own (TrackedLoad.addresses). */
export function dealRowTitle(item: RowTitleItem, card: RowTitleCard | null, address: string | null): string {
  if (card) return item.opened ? (item.listing?.address ?? address ?? dealWhere(card)) : dealWhere(card);
  return item.listing?.address ?? item.listing?.title ?? 'Listing';
}
