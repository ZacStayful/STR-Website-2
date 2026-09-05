import 'server-only';

import { mondayQuery } from '../apis/monday';

/**
 * Postcode areas where Stayful already manages properties, read from the
 * Monday "Properties" board (status Listed or Onboarding, postcode area parsed
 * from the Full Address column). Powers the "Stayful manages here" badge.
 *
 * Failure of any kind → an empty set: the badge is simply absent. Cached by
 * the caller (see cached.ts) for an hour alongside the area cards.
 */

const BOARD_ID = process.env.MONDAY_PROPERTIES_BOARD_ID || '4997066443';
const STATUS_COL = 'status';
const ADDRESS_COL = 'text';
const MANAGED_STATUSES = new Set(['Listed', 'Onboarding']);
const UK_POSTCODE_RE = /\b([A-Z]{1,2})\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/i;

export function postcodeAreaOf(address: string | null | undefined): string | null {
  if (!address) return null;
  const m = address.match(UK_POSTCODE_RE);
  return m ? m[1].toUpperCase() : null;
}

interface ItemsPage {
  boards: {
    items_page: {
      cursor: string | null;
      items: { id: string; column_values: { id: string; text: string | null }[] }[];
    };
  }[];
}

export async function getManagedAreas(): Promise<Set<string>> {
  const out = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const query: string = cursor
      ? `query ($cursor: String!, $cols: [String!]) { boards(ids: [${BOARD_ID}]) { items_page(limit: 200, cursor: $cursor) { cursor items { id column_values(ids: $cols) { id text } } } } }`
      : `query ($cols: [String!]) { boards(ids: [${BOARD_ID}]) { items_page(limit: 200) { cursor items { id column_values(ids: $cols) { id text } } } } }`;
    const data: ItemsPage | null = await mondayQuery<ItemsPage>(query, { cursor, cols: [STATUS_COL, ADDRESS_COL] });
    const pageData: ItemsPage['boards'][number]['items_page'] | undefined = data?.boards?.[0]?.items_page;
    if (!pageData) break;
    for (const item of pageData.items) {
      const status = item.column_values.find((c: { id: string }) => c.id === STATUS_COL)?.text ?? '';
      if (!MANAGED_STATUSES.has(status)) continue;
      const area = postcodeAreaOf(item.column_values.find((c: { id: string }) => c.id === ADDRESS_COL)?.text);
      if (area) out.add(area);
    }
    cursor = pageData.cursor;
    if (!cursor) break;
  }
  return out;
}
