/**
 * The members' navigation: three items, one config object.
 *
 * Every members-only surface still announces itself with the section name it
 * always used (`Section`, the AppShell `active` prop), and `NAV_FOR_SECTION`
 * says which of the three items that section lights up — so a page that
 * leaves the nav (the analyser, the Market Explorer, daily picks) still
 * highlights the item it lives under. My deals (/my-deals) announces itself
 * as `reports`, the section it replaced.
 *
 * Below the nav itself: the few other "where does this live" rules that more
 * than one page needs, so each is decided once (Batch 11).
 *
 * Pure, so the mapping is tested rather than trusted.
 */
export const NAV_TARGETS = {
  today: { label: 'Today', href: '/today' },
  myDeals: { label: 'My deals', href: '/my-deals' },
  account: { label: 'Account', href: '/account' },
} as const;

export type NavKey = keyof typeof NAV_TARGETS;

/** Left to right. */
export const NAV_ORDER: readonly NavKey[] = ['today', 'myDeals', 'account'];

/** Leads stays a nav item only for members whose team owns a funnel. */
export const LEADS_NAV = { label: 'Leads', href: '/leads' } as const;

/** The section a members-only layout announces (AppShell's `active`). Unchanged from the seven-item nav. */
export type Section = 'today' | 'estimate' | 'markets' | 'deals' | 'picks' | 'reports' | 'leads' | 'account';

export type ActiveNav = NavKey | 'leads';

export const NAV_FOR_SECTION: Record<Section, ActiveNav> = {
  today: 'today',
  estimate: 'today',
  markets: 'today',
  deals: 'today',
  picks: 'today',
  reports: 'myDeals',
  leads: 'leads',
  account: 'account',
};

export function activeNavFor(section: Section): ActiveNav {
  return NAV_FOR_SECTION[section];
}

// ── One list of kept deals (Batch 11) ──

/** My deals with its Passed group open. */
export const MY_DEALS_PASSED_HREF = `${NAV_TARGETS.myDeals.href}?show=passed`;

/**
 * Where an old /deals?view= link goes now that My deals is the one list of
 * kept and passed deals: kept → My deals, passed → its Passed group. Null for
 * the grid's own view (anything else), which stays on /deals.
 */
export function dealsViewRedirect(view: string | null | undefined): string | null {
  if (view === 'kept') return NAV_TARGETS.myDeals.href;
  if (view === 'passed') return MY_DEALS_PASSED_HREF;
  return null;
}

/** My deals' ?show=passed. The first value wins, as the /deals filters read theirs. */
export function myDealsShowsPassed(show: string | string[] | null | undefined): boolean {
  return (Array.isArray(show) ? show[0] : show) === 'passed';
}
