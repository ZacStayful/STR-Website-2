/**
 * The Leads page's filters, as they live in the URL.
 *
 * Kept in the query string (a GET form, not client state) so a search is a
 * link: bookmark it, send it to a colleague, press back and land where you
 * were. The export button reuses the same string, so "download what I am
 * looking at" cannot drift from what is on screen.
 *
 * Pure module so it runs under `node --test`.
 */

import type { LeadQuery } from '../api/leads-query';
import { parseStage, type LeadStage } from './stage.ts';
import { searchTerm, londonDateRange, londonDayStart } from './search.ts';

export type LeadTab = 'qualified' | 'unqualified' | 'queued' | 'archived';
export const LEAD_TABS: { key: LeadTab; label: string }[] = [
  { key: 'qualified', label: 'Qualified' },
  { key: 'unqualified', label: 'Not qualified' },
  { key: 'queued', label: 'Queued' },
  { key: 'archived', label: 'Archived' },
];

export const PAGE_SIZE = 50;

export interface LeadFilters {
  tab: LeadTab;
  q: string | null;
  funnel: string | null;
  from: string | null;
  to: string | null;
  stage: LeadStage | null;
  page: number;
}

const UUID = /^[0-9a-f-]{36}$/i;

type Raw = Record<string, string | string[] | undefined>;

function one(raw: Raw, key: string): string | null {
  const v = raw[key];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.length > 0 ? s : null;
}

/** Anything unrecognised is dropped rather than guessed at. */
export function parseLeadFilters(raw: Raw): LeadFilters {
  const tabRaw = one(raw, 'tab');
  const tab = LEAD_TABS.some((t) => t.key === tabRaw) ? (tabRaw as LeadTab) : 'qualified';
  const funnel = one(raw, 'funnel');
  const from = one(raw, 'from');
  const to = one(raw, 'to');
  const page = Number(one(raw, 'page') ?? '1');
  return {
    tab,
    q: searchTerm(one(raw, 'q')),
    funnel: funnel && UUID.test(funnel) ? funnel : null,
    from: from && londonDayStart(from) ? from : null,
    to: to && londonDayStart(to) ? to : null,
    stage: parseStage(one(raw, 'stage')),
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

/** The shared query for these filters, on a given tab. */
export function queryFor(f: LeadFilters, tab: LeadTab = f.tab, paged = true): LeadQuery {
  const { since, until } = londonDateRange(f.from, f.to);
  return {
    funnelId: f.funnel,
    qualified: null,
    status: null,
    since,
    until,
    search: f.q,
    stage: f.stage,
    archived: tab === 'archived' ? 'only' : 'exclude',
    view: tab === 'archived' ? null : tab,
    limit: PAGE_SIZE,
    offset: paged ? (f.page - 1) * PAGE_SIZE : 0,
  };
}

/** True when anything narrows the list beyond the tab. */
export function isFiltered(f: LeadFilters): boolean {
  return Boolean(f.q || f.funnel || f.from || f.to || f.stage);
}

/**
 * The query string for these filters with some changed. Defaults are left
 * out so the plain page stays `/leads`. Changing any filter goes back to
 * page 1 unless a page is given.
 */
export function filtersQuery(f: LeadFilters, change: Partial<LeadFilters> = {}): string {
  const next: LeadFilters = { ...f, page: 1, ...change };
  const p = new URLSearchParams();
  if (next.tab !== 'qualified') p.set('tab', next.tab);
  if (next.q) p.set('q', next.q);
  if (next.funnel) p.set('funnel', next.funnel);
  if (next.from) p.set('from', next.from);
  if (next.to) p.set('to', next.to);
  if (next.stage) p.set('stage', next.stage);
  if (next.page > 1) p.set('page', String(next.page));
  const s = p.toString();
  return s ? `?${s}` : '';
}
