/**
 * Batch 25: how a standout deal is described out loud and in writing. Only
 * public facts ever appear: the town (or postcode area name), bedrooms, the
 * kind of deal and the profit range, rounded. Never an address, a postcode,
 * an exact price or a listing link — a call or a text points to the app.
 *
 * The call's own words are in src/lib/voice/agent/scripts.ts; the texts and
 * emails around a call in src/lib/voice/templates.ts. These are the deal
 * pieces they fill in.
 *
 * Pure.
 */
import { areaMetaForCode } from '../market/areas.ts';
import type { DealType } from '../profile/deal-types.ts';
import type { ProfitBasis } from './rules.ts';

export interface DealDescription {
  bedrooms: number | null;
  propertyKind: 'flat' | 'house' | 'unknown';
  dealType: DealType;
  town: string | null;
  postcodeArea: string | null;
  /** The member's profit range, £ a month (low end first). */
  range: { lowPcm: number; highPcm: number } | null;
  basis: ProfitBasis;
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());

/** "Harrogate": the town, else the postcode area's name, else null (never a postcode). */
export function placeOf(d: Pick<DealDescription, 'town' | 'postcodeArea'>): string | null {
  const town = (d.town ?? '').trim();
  if (town && !/\d/.test(town)) return titleCase(town).slice(0, 40);
  if (d.postcodeArea) {
    const meta = areaMetaForCode(d.postcodeArea);
    if (meta && !/postcode area$/.test(meta.name)) return meta.name;
  }
  return null;
}

/** "2-bed flat to rent", "3-bed project", "2-bed house". */
export function whatOf(d: Pick<DealDescription, 'bedrooms' | 'propertyKind' | 'dealType'>): string {
  const beds = d.bedrooms !== null && d.bedrooms > 0 ? `${Math.min(d.bedrooms, 9)}-bed ` : '';
  if (d.dealType === 'brrr') return `${beds}project`;
  const kind = d.propertyKind === 'unknown' ? 'property' : d.propertyKind;
  return d.dealType === 'r2r' ? `${beds}${kind} to rent` : `${beds}${kind}`;
}

/** "the 2-bed in Harrogate", "the project in Leeds": how a text or callback names it. */
export function dealShort(d: DealDescription): string {
  const place = placeOf(d);
  const beds = d.bedrooms !== null && d.bedrooms > 0 ? `${Math.min(d.bedrooms, 9)}-bed` : d.dealType === 'brrr' ? 'project' : 'deal';
  const what = d.dealType === 'brrr' && beds !== 'project' ? `${beds} project` : beds;
  return place ? `the ${what} in ${place}` : `the ${what} I found`;
}

/** Round to the nearest £50: "around" figures, never the model's own numbers. */
export function roundToFifty(pcm: number): number {
  return Math.round(pcm / 50) * 50;
}

const thousands = (n: number) => n.toLocaleString('en-GB');

function rangeWords(r: { lowPcm: number; highPcm: number }, style: 'speech' | 'text'): string {
  const low = roundToFifty(r.lowPcm);
  const high = Math.max(low, roundToFifty(r.highPcm));
  if (style === 'speech') return low === high ? `around ${thousands(low)} pounds a month` : `around ${thousands(low)} to ${thousands(high)} pounds a month`;
  return low === high ? `around £${thousands(low)} a month` : `around £${thousands(low)}–£${thousands(high)} a month`;
}

const BASIS_TAIL: Record<ProfitBasis, string> = {
  range: '',
  after_works: ' once the works are done',
  after_refinance: " once the works are done and it's refinanced",
};

/**
 * "a 2-bed flat to rent in Harrogate that could make around 1,100 to 1,300
 * pounds a month": the call's headline (speech) and the emails' (text).
 */
export function dealHeadline(d: DealDescription, style: 'speech' | 'text'): string {
  const place = placeOf(d);
  const what = whatOf(d);
  const where = place ? ` in ${place}` : '';
  const money = d.range ? ` that could make ${rangeWords(d.range, style)}${BASIS_TAIL[d.basis]}` : '';
  return `a ${what}${where}${money}`;
}

/** One line for the daily email's "Saved for you": "2-bed flat to rent in Harrogate · could make £1,100–£1,300 a month". */
export function savedForYouLine(d: DealDescription): string {
  const place = placeOf(d);
  const what = whatOf(d);
  const head = `${what.charAt(0).toUpperCase()}${what.slice(1)}${place ? ` in ${place}` : ''}`;
  return d.range ? `${head} · could make ${rangeWords(d.range, 'text').replace(/^around /, '')}${BASIS_TAIL[d.basis]}` : head;
}
