/**
 * Short-let suitability: the one filter every daily pick passes, whatever
 * the member's own filter says. A pick must be something a member could
 * actually run as a short let, so these never go out:
 *
 *   - rooms, house shares, bedsits, lodger lets;
 *   - shared-ownership sales (a share of a home, no letting rights) and any
 *     sale priced too low to be a whole property;
 *   - retirement / age-restricted homes, park homes and holiday-park lodges;
 *   - leasehold sales UNLESS the listing text says short-term letting is
 *     permitted (most English flats are leasehold, so a flat with no tenure
 *     stated is treated as leasehold until the page says otherwise);
 *   - rentals whose text says sub-letting or short lets are not allowed.
 *
 * Two entry points: `suitabilityFromListing` judges a search-result listing
 * (cheap, may answer 'unknown' when only the listing page can tell), and
 * `suitabilityFromSnapshot` judges the fetched page (the verdict). Pure:
 * no network, no `server-only`.
 */
import type { SourcedListing, SourcingKind } from './sourcing.ts';
import type { ListingSnapshot } from './types.ts';

export const SUITABILITY_REASONS = {
  room: 'Room or house share',
  shared_ownership: 'Shared ownership',
  age_restricted: 'Retirement or age-restricted',
  park_home: 'Park home or holiday-park lodge',
  low_price: 'Sale price too low for a whole property',
  leasehold: 'Leasehold with no short-let permission',
  no_short_lets: 'Listing says short lets or sub-letting are not allowed',
} as const;

export type UnsuitableReason = keyof typeof SUITABILITY_REASONS;
/** 'unknown' = only the listing page can decide (leasehold flat, tenure not stated). */
export type Suitability = 'ok' | 'unknown' | UnsuitableReason;

export function isUnsuitableReason(v: unknown): v is UnsuitableReason {
  return typeof v === 'string' && v in SUITABILITY_REASONS;
}

/** Below this a "sale" is a share, a plot, a garage or an auction guide, never a whole home. */
export const MIN_SALE_PRICE = 50_000;

const TOPIC = /short[- ]?(?:term|stay)s?(?:\s+(?:let|lets|letting|rental|rentals|accommodation))?|short[- ]?lets?\b|holiday[- ]?(?:let|lets|letting|rental|rentals|home)|serviced accommodation|air ?bnb|serviced (?:let|lets|apartment)|sub-?let(?:ting|s)?\b/i;
const NEGATIVE = /\b(?:no|not|non|never|cannot|can't|won't|unable|prohibit(?:ed|s)?|forbid(?:den|s)?|restrict(?:ed|ion|ions|s)?|exclud(?:ed|es)|without)\b/i;
const POSITIVE = /\b(?:permitted|permission|permits|allowed|allows|welcome|suitable|ideal|perfect|opportunity|potential|consent|granted|possible|can be|could be|would (?:suit|make)|investors?|investment|currently (?:run|operated|let)|established|successful|ready|already)\b/i;

/**
 * Does the listing text say short-term letting is allowed? `true` when a
 * sentence about short lets / holiday lets / Airbnb / sub-letting reads as
 * permission, `false` when it reads as a prohibition (a prohibition anywhere
 * wins), `null` when the text is silent.
 */
export function shortLetsAllowed(text: string | null | undefined): boolean | null {
  if (!text) return null;
  const plain = stripHtml(text);
  let positive = false;
  for (const sentence of plain.split(/(?<=[.!?;])\s+|\n+|\s\|\s|•/)) {
    if (!TOPIC.test(sentence)) continue;
    if (NEGATIVE.test(sentence)) return false;
    if (POSITIVE.test(sentence)) positive = true;
  }
  return positive ? true : null;
}

export function stripHtml(s: string): string {
  return s
    .replace(/<\/p>|<\/li>|<\/h\d>/gi, '. ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export type Tenure = 'freehold' | 'leasehold' | null;

/** "Leasehold (975 years remaining)" / "Share of Freehold" / "Tenure: Freehold" → the kind that matters here. */
export function tenureOf(...values: (string | null | undefined)[]): Tenure {
  for (const v of values) {
    if (!v) continue;
    const t = v.toLowerCase();
    if (!/tenure|freehold|leasehold|commonhold/.test(t)) continue;
    if (/share of (?:the )?freehold|freehold|commonhold/.test(t)) return 'freehold';
    if (/leasehold/.test(t)) return 'leasehold';
  }
  return null;
}

const FLAT = /\b(?:flat|apartment|maisonette|penthouse|studio|duplex)\b/i;

/** Flat-like by the portal's type or the title: what "no flats" / "no houses" feedback keys on. */
export function isFlatLike(rawType: string | null | undefined, title: string | null | undefined): boolean {
  return FLAT.test(`${rawType ?? ''} ${title ?? ''}`);
}
const ROOM = /house ?share|flat ?share|home ?share|\broom(?:s)? (?:to rent|to let|in a|in an|available|for rent)|\b(?:single|double|en-?suite) room\b|\blodgers?\b|\bbedsit\b|student room|\bshared (?:house|flat|accommodation)\b/i;
const SHARED_OWNERSHIP = /shared[- ]ownership|shared[- ]equity|\b\d{1,2}\s?%\s*share\b|\bshare\b[^.]{0,20}\bof (?:a|the|this) (?:home|property|house|flat)|part[- ]buy[- ,]?part[- ]rent|resale share|rent to buy/i;
const AGE_RESTRICTED = /\bretirement\b|over[- ]?55s?\b|over[- ]?60s?\b|age[- ]restricted|age[- ]exclusive|sheltered (?:housing|accommodation)|assisted living|later living|mccarthy/i;
const PARK_HOME = /park home|holiday park|holiday lodge|leisure park|lodge park|caravan|mobile home|static home|residential park|chalet park|touring/i;

export interface SuitabilityFacts {
  kind: SourcingKind;
  text: string; // title, type, qualifier, features, tenure line: whatever the source shows
  tenure: Tenure;
  flatLike: boolean;
  salePrice: number | null;
  /** `true` from the page's own flag; `false` when the page was read and carries no flag; `null` = page not read. */
  sharedOwnership: boolean | null;
  /** From the page description; `null` when silent or not read. */
  shortLetsPermitted: boolean | null;
  /** Whether the listing page itself has been read (the description is only there). */
  pageChecked: boolean;
}

/** The verdict from whatever facts are in hand. */
export function judge(f: SuitabilityFacts): Suitability {
  const text = f.text.toLowerCase();
  if (ROOM.test(text)) return 'room';
  if (f.sharedOwnership === true || SHARED_OWNERSHIP.test(text)) return 'shared_ownership';
  if (AGE_RESTRICTED.test(text)) return 'age_restricted';
  if (PARK_HOME.test(text)) return 'park_home';
  const permitted = f.shortLetsPermitted ?? shortLetsAllowed(f.text);
  if (permitted === false) return 'no_short_lets';
  if (f.kind === 'rent') return 'ok';
  if (f.salePrice !== null && f.salePrice < MIN_SALE_PRICE) return 'low_price';
  const leasehold = f.tenure === 'leasehold' || (f.tenure === null && f.flatLike);
  if (!leasehold) return 'ok';
  if (permitted === true) return 'ok';
  // Leasehold and the text says nothing: only the page's description can rescue it.
  return f.pageChecked ? 'leasehold' : 'unknown';
}

/** Judge a search-result listing. 'unknown' means "fetch the page before sending". */
export function suitabilityFromListing(l: SourcedListing): Suitability {
  const features = l.features ?? [];
  const tenureLine = features.find((x) => /tenure/i.test(x)) ?? null;
  return judge({
    kind: l.kind,
    text: [l.title, l.rawType, l.priceQualifier ?? null, l.tenure ?? null, ...features].filter(Boolean).join(' | '),
    tenure: tenureOf(l.tenure, tenureLine),
    flatLike: isFlatLike(l.rawType, l.title),
    salePrice: l.kind === 'sale' && l.price?.period === 'total' ? l.price.amount : null,
    sharedOwnership: l.sharedOwnership ?? null,
    shortLetsPermitted: l.shortLetsPermitted ?? null,
    pageChecked: l.sharedOwnership !== null && l.sharedOwnership !== undefined,
  });
}

/** Judge the fetched page: the final word before a pick is sent. Never 'unknown'. */
export function suitabilityFromSnapshot(s: ListingSnapshot, kind: SourcingKind): Exclude<Suitability, 'unknown'> {
  const v = judge({
    kind,
    text: [s.title, s.rawType ?? null, s.price?.qualifier ?? null, s.tenure ?? null, ...s.features].filter(Boolean).join(' | '),
    tenure: tenureOf(s.tenure, ...s.features.filter((x) => /tenure/i.test(x))),
    flatLike: isFlatLike(s.rawType, s.title),
    salePrice: kind === 'sale' && s.price?.period === 'total' ? s.price.amount : null,
    sharedOwnership: s.sharedOwnership ?? false,
    shortLetsPermitted: s.shortLetsPermitted ?? null,
    pageChecked: true,
  });
  return v === 'unknown' ? 'leasehold' : v;
}
