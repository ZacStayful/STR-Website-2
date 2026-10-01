/**
 * The Monday sales-funnel board (Batch 20, Part F): "Stayful Intelligence
 * enquiries", every id the site uses on it, and the few numbers that shape
 * how it is written. This is the only place a Monday id appears; the old
 * MONDAY_COL_* and MONDAY_ENQUIRY_* overrides are gone.
 *
 * Checked against the live board on 30 Sep 2026: every group, every column
 * and the Route and Next deal labels.
 *
 * Pure: no network, no database, no server-only.
 */

export const FUNNEL_BOARD_ID = '18413002067';

/** The funnel's stages, plus the two groups the site never moves anyone into or out of by its own choice. */
export const GROUPS = {
  free: 'topics',
  pack: 'group_mm7mrgb0',
  lowCredit: 'group_mm7m5v84',
  payg: 'group_mm7mhp5w',
  starter: 'group_mm7mfxyf',
  pro: 'group_mm7mp5jr',
  scale: 'group_mm7mpw9y',
  reengage: 'group_mm7mdnsg',
  paused: 'group_mm3app6t',
  cancelled: 'group_mm769zhv',
  paymentIssues: 'group_mm3a1jys',
  /** Duplicate and internal accounts: never moved in or out; their members are left alone entirely. */
  excluded: 'group_mm7mweat',
  /** Legacy: left alone unless the member's real state is known. */
  toConfirm: 'group_mm3ak8fg',
} as const;

export type FunnelGroup = keyof typeof GROUPS;

export const GROUP_TITLES: Readonly<Record<FunnelGroup, string>> = {
  free: '1. Free sign-up',
  pack: '2. £10 starter pack',
  lowCredit: '3. Low credit – decision',
  payg: '4. Pay as you go',
  starter: '5. Starter plan',
  pro: '6. Pro plan',
  scale: '7. Scale plan',
  reengage: 'Re-engage (14+ days inactive)',
  paused: 'Paused plan',
  cancelled: 'Cancelled',
  paymentIssues: 'Payment issues',
  excluded: 'Excluded – duplicate & internal accounts',
  toConfirm: 'Customer – plan to confirm',
};

/** The group a Monday group id is, or null for one the site does not know. */
export function groupOf(groupId: string | null | undefined): FunnelGroup | null {
  if (!groupId) return null;
  for (const [key, id] of Object.entries(GROUPS)) if (id === groupId) return key as FunnelGroup;
  return null;
}

const FIXED_COLUMNS = {
  name: 'text_mm3ad9y7',
  email: 'text_mm3a8s7c',
  mobile: 'text_mm3ah0bk',
  signedUp: 'date_mm3cny59',
  firstPayment: 'date_mm3cp4k3',
  cancelDate: 'date_mm3ctqag',
  topups: 'numeric_mm76h465',
  route: 'color_mm7mgb43',
  nextDeal: 'color_mm7mjd7g',
  plan: 'text_mm7mb780',
  credit: 'numeric_mm7mhs1f',
  totalPaid: 'numeric_mm7mcxec',
  monthlyValue: 'numeric_mm7mr33f',
  lastTopup: 'date_mm7mefj6',
  billingStatus: 'text_mm7mrd0k',
  hitZero: 'date_mm7m765b',
  lastActive: 'date_mm7mnc2f',
  activeDays: 'numeric_mm7mp6d1',
  activeWeeks: 'numeric_mm7mkpq5',
  adSource: 'text_mm7m9h2h',
  emailOk: 'boolean_mm7mek5x',
  smsOk: 'boolean_mm7m4tvb',
  reengageSince: 'date_mm7mzn1p',
} as const;

/**
 * Batch 21 (E2, Q11): "Weeks since sign-up", counted as Active weeks is (ISO
 * weeks, Monday to Sunday, UK time), for the board's Engagement % to divide
 * by instead of its ROUNDUP(days / 7). The board has no such column yet:
 * create a Numbers column, put its id in MONDAY_FUNNEL_WEEKS_COLUMN and point
 * the Engagement % formula at it. Until then the column does not exist here
 * at all: never read from the board, never written.
 */
const WEEKS_COLUMN = process.env.MONDAY_FUNNEL_WEEKS_COLUMN?.trim() || null;

/** The only columns the site writes. */
export const COLUMNS: typeof FIXED_COLUMNS & { readonly weeksSinceSignup?: string } = {
  ...FIXED_COLUMNS,
  ...(WEEKS_COLUMN ? { weeksSinceSignup: WEEKS_COLUMN } : {}),
};

export type ColumnKey = keyof typeof COLUMNS;

/** The PDF column: written only by the report upload (src/lib/apis/monday.ts), never by the funnel. */
export const REPORTS_COLUMN = 'file_mm3aevrs';

/** Never written by the site: Monday's own formulas, the old Status and Site Visits, and the reports. */
export const NEVER_WRITTEN: readonly string[] = ['formula_mm7m1jef', 'formula_mm7mjdrc', 'color_mm3a4gp9', 'text_mm3aapza', REPORTS_COLUMN];

/** How each column is written and read. */
export const COLUMN_TYPES: Readonly<Record<ColumnKey, 'text' | 'numbers' | 'date' | 'status' | 'checkbox'>> = {
  name: 'text',
  email: 'text',
  mobile: 'text',
  signedUp: 'date',
  firstPayment: 'date',
  cancelDate: 'date',
  topups: 'numbers',
  route: 'status',
  nextDeal: 'status',
  plan: 'text',
  credit: 'numbers',
  totalPaid: 'numbers',
  monthlyValue: 'numbers',
  lastTopup: 'date',
  billingStatus: 'text',
  hitZero: 'date',
  lastActive: 'date',
  activeDays: 'numbers',
  activeWeeks: 'numbers',
  adSource: 'text',
  emailOk: 'checkbox',
  smsOk: 'checkbox',
  reengageSince: 'date',
  weeksSinceSignup: 'numbers',
};

/** Written only when the row has none: who they are, and the two "first" dates. */
export const SET_ONCE: ReadonlySet<ColumnKey> = new Set<ColumnKey>(['name', 'email', 'mobile', 'signedUp', 'firstPayment']);

/** The Route column's labels (they exist on the board; the site never creates labels). */
export const ROUTE_LABELS = { free: 'Free sign-up', pack: '£10 starter pack' } as const;

/** profiles.about_you.nextDeal → the Next deal column's labels. "Not sure" and no answer leave it blank. */
export const NEXT_DEAL_LABELS: Readonly<Record<string, string>> = {
  this_month: 'This month',
  '1-3m': '1–3 months',
  '3-6m': '3–6 months',
  exploring: 'Just exploring',
};

/** The Plan column's words, by plan code. */
export const PLAN_LABELS: Readonly<Record<string, string>> = { starter: 'Starter', pro: 'Pro', pro_annual: 'Pro (annual)', scale: 'Scale' };
export const NO_PLAN_LABEL = 'Pay as you go';

/** Rows per write request (aliased mutations), items per read page, and how long a Monday call may take. */
export const WRITE_BATCH = 25;
export const READ_PAGE = 500;
export const REQUEST_TIMEOUT_MS = 8_000;
/** Below this much of the minute's complexity budget left, the run stops and leaves the rest for the next one. */
export const MIN_COMPLEXITY_LEFT = 200_000;
/** A member's row is created by the nightly or the backfill only once the account is this old: sign-up's own row gets there first. */
export const CREATE_MIN_AGE_MS = 60 * 60 * 1000;

/** MONDAY_FUNNEL_ENABLED=true lets the sync write to Monday. Dry runs work either way. */
export function funnelEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.MONDAY_FUNNEL_ENABLED === 'true';
}
