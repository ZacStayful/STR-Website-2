/**
 * Batch 19: every number, name and wording for cookie consent, the Meta pixel
 * and Conversions API, and sign-up attribution, in one place. Nothing else in
 * the batch hard-codes one of these.
 *
 * Pure: no network, no database, no server-only.
 */

export const TRACKING = {
  /** The essential cookie that remembers the choice (version, choice, time, device id). */
  consentCookie: 'sf_consent',
  /** How long a choice is remembered before we ask again: "6 months". */
  consentDays: 182,
  /** The wording version stored with every choice. New wording → new version. */
  consentVersion: 'cookie-v1',
  /** The same choice from the same device within this is not recorded twice. */
  repeatChoiceSeconds: 60,

  /** First-party cookie holding the first tagged visit, only after Accept (httpOnly). */
  attributionCookie: 'sf_attr',
  /** How long a tagged visit is remembered on a device that accepted. */
  attributionDays: 30,
  /** Meta's click-id cookie (the pixel's own name), written by us after Accept. */
  fbcCookie: '_fbc',
  /** Meta's browser-id cookie, written by the pixel itself. */
  fbpCookie: '_fbp',
  /** How long our _fbc lasts: Meta's own default (2160 hours). */
  fbcDays: 90,

  /** A conversion fires in the browser only this long after it happened (Meta de-duplicates within 48 h). */
  browserWindowHours: 24,
  /** A conversion held for want of consent is sent if the member accepts within this. */
  releaseMinutes: 60,
  /** A Google account this new when /auth/callback runs is a sign-up, not a sign-in. */
  newGoogleAccountMinutes: 15,
  /** The member's last-seen browser details are refreshed at most this often. */
  contextRefreshMinutes: 60,
  /** Pending conversions are checked on a route change at most this often. */
  pendingRecheckSeconds: 30,
  /** After a credit change (a top-up, the profile credit, a report): look again after these. */
  creditChangedRetriesMs: [0, 2000, 5000, 10000] as readonly number[],
  /** After returning from Stripe (?topup=1 / ?subscribed=1): look every so often, for so long. */
  stripeReturnPollMs: 3000,
  stripeReturnPollForMs: 30000,

  /** "% ran a first report within N days" on /admin/signups. */
  firstReportDays: 7,
  /** Rows with fewer sign-ups than this are greyed out on /admin/signups. */
  minRowSignups: 20,
  /** The furthest back /admin/signups can reach for weeks 2–4 (Batch 9's facts go back 52 weeks). */
  maxReportWeeks: 52,

  /** Meta's Graph API version for the Conversions API. */
  graphApiVersion: 'v26.0',
  /** A Conversions API call never waits longer than this. */
  capiTimeoutMs: 3000,
} as const;

/** What the banner and the second-chance checkbox say (version: TRACKING.consentVersion). */
export const CONSENT_WORDING = {
  banner: "We use cookies to keep you signed in. With your OK we'd also like to use Meta's pixel to see which of our Facebook ads bring people here.",
  accept: 'Accept',
  reject: 'Reject',
  policyLink: 'Cookie policy',
  checkbox: "Let Stayful use Meta's pixel to measure which ads brought me here.",
  settingsLink: 'Cookie settings',
} as const;

/** Where the cookie policy lives. */
export const COOKIE_POLICY_HREF = '/privacy#cookies';

/**
 * Pages that may send a PageView (and fire a conversion), with a clean
 * address only. Everything not listed never sends: deny by default.
 */
export const PAGEVIEW_PATHS: readonly string[] = [
  // Marketing
  '/',
  '/features',
  '/pricing',
  '/methodology',
  '/income-calculator',
  '/short-term-vs-long-term-letting',
  '/demo',
  '/extension',
  '/extension/privacy',
  '/privacy',
  '/terms',
  '/upgrade',
  '/short-let-deals',
  '/markets',
  '/markets/map',
  // Members
  '/today',
  '/my-deals',
  '/deals',
  '/deals/opened',
  '/picks',
  '/account',
  '/account/billing',
  '/account/usage',
  '/estimate',
  '/welcome',
];

/**
 * Pages with exactly one more path segment that is a public area name
 * (a town slug, never an id): /short-let-deals/york, /markets/leeds.
 */
export const PAGEVIEW_AREA_PREFIXES: readonly string[] = ['/short-let-deals/', '/markets/'];

/**
 * Pages that show the banner (so a member can choose) but never send
 * anything: forms holding personal details, pages whose address holds an id
 * or a token, and the share pages. Each entry covers the path and everything
 * under it.
 */
export const BANNER_ONLY_PREFIXES: readonly string[] = [
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/account',
  '/profile',
  '/profiles',
  '/leads',
  '/deals',
  '/reports',
  '/my-deals',
  '/d/',
  '/deal/',
  '/p/',
];

/** Tracking tags taken off the address bar before the pixel sends (read first, never sent). */
export const TRACKING_PARAMS: readonly string[] = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'fbclid',
  'gclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'ttclid',
  'mc_cid',
  'mc_eid',
  '_gl',
];

/**
 * Flags a page reads once on load and never again, taken off the address on
 * that page only. `when` limits a flag to one value (the default /welcome
 * return path, so a reload still lands in the same place).
 */
export const ONE_SHOT_PARAMS: readonly { path: string; param: string; when?: string }[] = [
  { path: '/account/billing', param: 'topup' },
  { path: '/account/billing', param: 'subscribed' },
  { path: '/account/billing', param: 'plan' },
  { path: '/welcome', param: 'next', when: '/today' },
  { path: '/signup', param: 'ref' },
];

/** Where a Stripe return lands, and the flags that mark it. */
export const STRIPE_RETURN = { path: '/account/billing', params: ['topup', 'subscribed'] as readonly string[] } as const;

/** Batch 21 (E28): every Stripe return, the starter pack's (/today?pack=1) included, so the browser's Purchase can fire there. */
export const STRIPE_RETURNS: readonly { path: string; params: readonly string[] }[] = [STRIPE_RETURN, { path: '/today', params: ['pack'] }];

/** The page each server event is reported against (never with a query string). */
export const EVENT_SOURCE_PATHS = {
  CompleteRegistration: '/signup',
  ProfileComplete: '/welcome',
  FirstReport: '/estimate',
  Subscribe: '/account/billing',
  Purchase: '/account/billing',
} as const;
