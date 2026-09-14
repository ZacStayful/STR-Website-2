/**
 * The one place that turns market and sub-market data into display names, so
 * every card, breadcrumb, table, source line, e-mail and PDF says the same
 * thing:
 *
 *   Market      title "Leicester"                   subtitle "LE postcode area · East Midlands"
 *   Sub-market  title "Leicester · Clarendon Park"  subtitle "LE2 postcode district · also Knighton, Stoneygate"
 *               (no locality on file)  "Leicester LE2"          "LE2 postcode district"
 *
 * Titles are places; codes live in the subtitle. `districtLabel` is the short
 * form for menus and table cells ("Clarendon Park (LE2)", or "LE2").
 */
export interface NamedArea {
  code: string;
  name: string;
  region: { name: string };
}

export interface NamedDistrict {
  code: string;
  /** Lead locality, or null when the district has none on file. */
  locality: string | null;
  /** Every locality on file, lead first; empty when none. */
  localities: string[];
}

/** How many "also …" localities a subtitle lists before "& N more". */
export const MAX_ALSO = 3;

export function marketTitle(a: Pick<NamedArea, 'name'>): string {
  return a.name;
}

export function marketSubtitle(a: NamedArea): string {
  return `${a.code} postcode area · ${a.region.name}`;
}

export function subMarketTitle(a: Pick<NamedArea, 'name'>, d: Pick<NamedDistrict, 'code' | 'locality'>): string {
  return d.locality ? `${a.name} · ${d.locality}` : `${a.name} ${d.code}`;
}

export function subMarketSubtitle(d: NamedDistrict, max = MAX_ALSO): string {
  const base = `${d.code} postcode district`;
  const also = d.localities.slice(1);
  if (also.length === 0) return base;
  const shown = also.slice(0, max).join(', ');
  const more = also.length - max;
  return `${base} · also ${shown}${more > 0 ? ` & ${more} more` : ''}`;
}

/** Short form for a district in a menu, table cell or breadcrumb. */
export function districtLabel(d: Pick<NamedDistrict, 'code' | 'locality'>): string {
  return d.locality ? `${d.locality} (${d.code})` : d.code;
}

/** True when a lower-cased search term matches the district's code or one of its localities. */
export function districtMatches(d: NamedDistrict, q: string): boolean {
  if (!q) return true;
  if (d.code.toLowerCase().startsWith(q)) return true;
  return d.localities.some((l) => l.toLowerCase().includes(q));
}
