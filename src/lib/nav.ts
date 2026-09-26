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
