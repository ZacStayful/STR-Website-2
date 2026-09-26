/**
 * The first-week checklist on the Today screen: five steps that get a new
 * member using the product, each ticked from what they actually did (never a
 * box they tick themselves) and each worth £1 of credit, once, in their first
 * seven days.
 *
 * The £1 is a welcome-kind grant: it spends at face value like the welcome
 * credit, not at the top-up rate. Accounts whose welcome credit was withheld
 * (the abuse checks in src/lib/credit/welcome.ts already ruled on them) and
 * team members (whose spending is their team owner's) see the steps but earn
 * nothing from them.
 *
 * Pure, so the rules are tested rather than trusted. The reads, writes and
 * grants are in checklist-server.ts.
 */

export type StepKey = 'goals' | 'keep3' | 'open' | 'report' | 'share';

export interface ChecklistStep {
  key: StepKey;
  label: string;
  /** Where to do it. */
  href: string;
}

export const CHECKLIST_STEPS: readonly ChecklistStep[] = [
  { key: 'goals', label: 'Tell us what you’re looking for', href: '/markets?goals=1' },
  { key: 'keep3', label: 'Keep 3 deals', href: '/deals' },
  { key: 'open', label: 'Open a deal', href: '/deals' },
  { key: 'report', label: 'Run a full report', href: '/estimate' },
  { key: 'share', label: 'Share a deal', href: '/deals' },
];

export const STEP_KEYS: readonly StepKey[] = CHECKLIST_STEPS.map((s) => s.key);

export function isStepKey(v: unknown): v is StepKey {
  return typeof v === 'string' && (STEP_KEYS as readonly string[]).includes(v);
}

/** How long the checklist runs, from sign-up. The reward ends with it. */
export const CHECKLIST_DAYS = 7;
export const STEP_REWARD_PENCE = 100;
export const KEEPS_NEEDED = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What the member has actually done, read from their own records. */
export interface Evidence {
  /** market_goals is set, however it got there (the welcome questions, the goals modal, a lead form). */
  goals: boolean;
  /** Deals currently on their kept list. */
  keeps: number;
  /** A deal they opened themselves (not the daily pick's automatic open). */
  opened: boolean;
  /** A full report they ran. */
  reported: boolean;
  /** A marketplace deal or a pipeline listing they shared. */
  shared: boolean;
}

/** The steps this evidence shows done, in checklist order. */
export function stepsDone(e: Evidence): StepKey[] {
  const done: Record<StepKey, boolean> = { goals: e.goals, keep3: e.keeps >= KEEPS_NEEDED, open: e.opened, report: e.reported, share: e.shared };
  return STEP_KEYS.filter((k) => done[k]);
}

/** Inside the member's first seven days. An unknown sign-up date is outside: no reward is ever guessed. */
export function inWindow(createdAt: string | null | undefined, now: Date): boolean {
  const t = createdAt ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t < CHECKLIST_DAYS * DAY_MS && now.getTime() >= t - DAY_MS;
}

export type Eligibility = { kind: 'eligible' } | { kind: 'pending' } | { kind: 'never'; reason: 'welcome_withheld' | 'team_member' };

/**
 * Whether this account is paid for its steps. The welcome check's own verdict
 * decides it: withheld is never paid (the same abuse rules, not new ones),
 * not yet checked waits (a member with an open team invite is decided when
 * they join or it lapses), and a team member is never paid because their
 * credit belongs to the team owner.
 */
export function rewardEligibility(p: { welcomeCheckedAt: string | null; welcomeWithheldReason: string | null; teamMember: boolean }): Eligibility {
  if (p.teamMember || p.welcomeWithheldReason === 'team_member') return { kind: 'never', reason: 'team_member' };
  if (p.welcomeWithheldReason) return { kind: 'never', reason: 'welcome_withheld' };
  if (!p.welcomeCheckedAt) return { kind: 'pending' };
  return { kind: 'eligible' };
}

/** The grant's reference: one per account per step, so credit_grants' unique source_ref can only ever pay it once. */
export function rewardRef(step: StepKey, userId: string): string {
  return `checklist:${step}:${userId}`;
}

/** "+£1 credit — 2 of 5 done" (or "+£2" when two steps landed since the last look). */
export function rewardLine(newlyPaid: number, doneCount: number): string | null {
  if (newlyPaid <= 0) return null;
  return `+£${newlyPaid} credit — ${doneCount} of ${STEP_KEYS.length} done`;
}

/**
 * Shown in the first seven days until every step is done, and once more
 * after that to say the last one landed. Then never again.
 */
export function checklistVisible(p: { createdAt: string | null; doneCount: number; newlyPaid: number; now: Date }): boolean {
  if (!inWindow(p.createdAt, p.now)) return false;
  return p.doneCount < STEP_KEYS.length || p.newlyPaid > 0;
}
