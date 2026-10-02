/**
 * Header items are decided by Zac. No batch removes, merges or renames one without his approval.
 *
 * The members' navigation: one config object. Batch 22e set the order Zac
 * wants: the Stayful Intelligence eye ("Talk to Stayful Intelligence",
 * drawn by AppSwitcher, not a NAV_TARGETS item), then Home, Today, My deals,
 * Browse, Market Explorer, Analyser and Account (Leads before Account for a
 * team that owns a funnel).
 *
 * Every members-only surface still announces itself with the section name it
 * always used (`Section`, the AppShell `active` prop), and `NAV_FOR_SECTION`
 * says which item that section lights up — so a page with no item of its
 * own (daily picks, the profile page) still highlights the item it lives
 * under. My deals (/my-deals) announces itself as `reports`, the section it
 * replaced.
 *
 * Below the nav itself: the few other "where does this live" rules that more
 * than one page needs, so each is decided once (Batch 11).
 *
 * Pure, so the mapping is tested rather than trusted.
 */
export const NAV_TARGETS = {
  // Batch 22e: where a member lands after logging in (HOME_PATH, src/lib/auth/landing.ts).
  home: { label: 'Home', href: '/home' },
  today: { label: 'Today', href: '/today' },
  // Batch 22: the three tools back in the strip. Batch 21h took the marketing
  // menu off /markets, which was the last visible way to the Market Explorer.
  browse: { label: 'Browse', href: '/deals' },
  markets: { label: 'Market Explorer', href: '/markets' },
  analyser: { label: 'Analyser', href: '/estimate' },
  myDeals: { label: 'My deals', href: '/my-deals' },
  account: { label: 'Account', href: '/account' },
} as const;

export type NavKey = keyof typeof NAV_TARGETS;

/** Left to right, after the eye (Batch 22e). */
export const NAV_ORDER: readonly NavKey[] = ['home', 'today', 'myDeals', 'browse', 'markets', 'analyser', 'account'];

/** The eye's item: first in the header, opening the Stayful Intelligence view. Never called anything else to a member. */
export const EYE_NAV = { label: 'Talk to Stayful Intelligence', shortLabel: 'Talk', href: '/intelligence' } as const;

/** Leads stays a nav item only for members whose team owns a funnel. */
export const LEADS_NAV = { label: 'Leads', href: '/leads' } as const;

/** The section a members-only layout announces (AppShell's `active`). Unchanged from the seven-item nav. */
export type Section = 'home' | 'today' | 'estimate' | 'markets' | 'deals' | 'picks' | 'reports' | 'leads' | 'account' | 'profile';

export type ActiveNav = NavKey | 'leads';

export const NAV_FOR_SECTION: Record<Section, ActiveNav> = {
  home: 'home',
  today: 'today',
  estimate: 'analyser',
  markets: 'markets',
  deals: 'browse',
  picks: 'today',
  reports: 'myDeals',
  leads: 'leads',
  account: 'account',
  // The profile page (Batch 12) is a header shortcut, not a nav item: it lights up Account, where it is also linked from.
  profile: 'account',
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

// ── Links that point to the right place (Batch 11) ──

/**
 * "What you're looking for": the profile page (Batch 12), where every quiz
 * answer is shown and can be changed. The old goals editor's URL
 * (/markets?goals=1) is in emails already sent, so /markets redirects it here.
 */
export const GOALS_EDITOR_HREF = '/profile';

/** The profile quiz itself: the questions, one per screen. `?q=<id>` opens one question to change it. */
export const PROFILE_QUIZ_HREF = '/welcome';

/** Today's list of cards (and the empty-day box in their place): what the first-week checklist points at. */
export const TODAY_LIST_ID = 'today-list';
export const TODAY_LIST_HREF = `${NAV_TARGETS.today.href}#${TODAY_LIST_ID}`;

/**
 * The element id to scroll to when following `href` would stay on the page at
 * `pathname` (`#id`, or `/today#id` while on /today); null when it is a real
 * navigation or has no fragment. A query string on the link counts as the
 * same page only when the path matches: the fragment is what is followed.
 */
export function samePageAnchor(href: string, pathname: string): string | null {
  const at = href.indexOf('#');
  if (at < 0) return null;
  const id = href.slice(at + 1);
  if (!id) return null;
  const path = href.slice(0, at).split('?')[0];
  return path === '' || path === pathname ? id : null;
}

/** Where a member lands after joining a team: its Leads, when the team has a funnel to work, else Home (Batch 22e). */
export function joinLandingPath(teamOwnsFunnel: boolean): string {
  return teamOwnsFunnel ? LEADS_NAV.href : NAV_TARGETS.home.href;
}

// ── Destinations (Batch 22e, for Batch 26's "take me there") ──

/** The My deals stages a link can open (their section ids on /my-deals are `stage-<stage>`). */
export type MyDealsStage = 'watching' | 'contacted' | 'viewing' | 'offer' | 'secured';

/**
 * Every place Stayful Intelligence can send a member, built one way. Only
 * internal paths; a deal or area id is encoded, never trusted as a path.
 */
export const NAV_DESTINATIONS = {
  home: (): string => NAV_TARGETS.home.href,
  today: (): string => NAV_TARGETS.today.href,
  marketArea: (code: string): string => `${NAV_TARGETS.markets.href}/${encodeURIComponent(code.trim().toLowerCase())}`,
  deal: (id: string): string => `${NAV_TARGETS.browse.href}/${encodeURIComponent(id)}`,
  myDealsStage: (stage: MyDealsStage, profileId?: string | null): string =>
    `${NAV_TARGETS.myDeals.href}${profileId ? `?profile=${encodeURIComponent(profileId)}` : ''}#stage-${stage}`,
  analyser: (): string => NAV_TARGETS.analyser.href,
} as const;

export type DestinationKey = keyof typeof NAV_DESTINATIONS;

// ── Account's "More" (Batch 11) ──

/**
 * The quieter links at the foot of Account, in order: the doors only. What
 * each one says beside it (and any price) is the page's.
 */
export const ACCOUNT_MORE = {
  team: { label: 'Team', href: '/account/team' },
  leads: LEADS_NAV,
  extension: { label: 'Browser extension', href: '/extension/connect' },
  markets: { label: 'Market Explorer', href: '/markets' },
  picks: { label: 'Daily picks', href: '/picks' },
  // Batch 18: what the member has sent us, and where it has got to.
  feedback: { label: 'Your feedback', href: '/account/feedback' },
  // Batch 23: calls from and to Stayful Intelligence (owners: calls go to the account owner).
  calls: { label: 'Your calls', href: '/account/calls' },
} as const;

export type AccountMoreKey = keyof typeof ACCOUNT_MORE;

/**
 * Which of them a person sees: Team only for someone who owns their account
 * (a member's team is the owner's to manage), Leads only while their team owns
 * a funnel (the nav's own rule), and the rest for everyone, "Your feedback"
 * (Batch 18) included. "Your calls" (Batch 23) only for an owner: calls go
 * to the account owner.
 */
export function accountMoreLinks(p: { teamMember: boolean; teamOwnsFunnel: boolean }): AccountMoreKey[] {
  const keys: AccountMoreKey[] = [];
  if (!p.teamMember) keys.push('team');
  if (p.teamOwnsFunnel) keys.push('leads');
  keys.push('extension', 'markets', 'picks', 'feedback');
  if (!p.teamMember) keys.push('calls');
  return keys;
}
