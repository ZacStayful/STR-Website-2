import 'server-only';

/**
 * The first-week checklist: reading what a member has done, recording each
 * step the first time it shows up, and paying its £1.
 *
 * Idempotent from end to end, so it can run on every page a new member opens:
 *   - a step's row is inserted once (primary key (user, step), insert does nothing on conflict)
 *   - its grant carries source_ref 'checklist:<step>:<user>', and credit_grants'
 *     unique source_ref means a second grant — a retry, two tabs, two
 *     requests racing — hands back the first instead of paying again
 * A step, once recorded, stays done: undoing a keep afterwards does not take
 * back what was paid for doing it.
 *
 * Rules are in checklist.ts: the seven-day window, who is paid, the wording.
 */
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { grant } from '../credit/ledger';
import { teamOf } from '../team';
import { parseMarketGoals } from '../market/goals';
import { CHECKLIST_STEPS, checklistVisible, inWindow, isStepKey, rewardEligibility, rewardLine, rewardRef, STEP_REWARD_PENCE, stepsDone, type Eligibility, type Evidence, type StepKey } from './checklist';

type Admin = ReturnType<typeof createAdminClient>;

export interface ChecklistView {
  visible: boolean;
  /** Whether the £1 rewards apply to this account (and so are mentioned). */
  rewarded: boolean;
  steps: { key: StepKey; label: string; href: string; done: boolean }[];
  doneCount: number;
  /** "+£1 credit — 2 of 5 done": steps paid since the member last saw the checklist. Null when none. */
  reward: string | null;
}

const HIDDEN: ChecklistView = { visible: false, rewarded: false, steps: [], doneCount: 0, reward: null };

type StepRow = { step: string; grant_id: string | null; skipped_reason: string | null; seen_at: string | null };

/**
 * Brings the member's checklist up to date and returns what to show. With
 * `markSeen`, any "+£1" it returns is stamped as seen, so it is shown once.
 * Never throws: a missing table (schema not run) or a failed read hides the
 * card rather than breaking the page it sits on.
 */
export async function syncChecklist(userId: string, opts: { markSeen?: boolean; now?: Date } = {}): Promise<ChecklistView> {
  if (!hasServiceRole()) return HIDDEN;
  const now = opts.now ?? new Date();
  try {
    const admin = createAdminClient();
    const { data: profile, error } = await admin.from('profiles').select('created_at, market_goals, welcome_checked_at, welcome_withheld_reason').eq('id', userId).maybeSingle();
    if (error || !profile) return HIDDEN;
    const p = profile as { created_at: string | null; market_goals: unknown; welcome_checked_at: string | null; welcome_withheld_reason: string | null };
    // After the first week the card is gone for good, and so is the offer:
    // nothing is read, recorded or paid.
    if (!inWindow(p.created_at, now)) return HIDDEN;

    const [evidence, team, existing] = await Promise.all([evidenceFor(admin, userId, p.market_goals), teamOf(userId), stepRows(admin, userId)]);
    if (existing === null) return HIDDEN;
    const eligibility = rewardEligibility({ welcomeCheckedAt: p.welcome_checked_at, welcomeWithheldReason: p.welcome_withheld_reason, teamMember: team.role === 'member' });
    const skip = eligibility.kind === 'never' ? eligibility.reason : null;

    // ── Record steps seen done for the first time ──
    const recorded = new Set(existing.map((r) => r.step));
    const fresh = stepsDone(evidence).filter((k) => !recorded.has(k));
    if (fresh.length > 0) {
      const { error: insErr } = await admin
        .from('checklist_steps')
        .upsert(fresh.map((step) => ({ user_id: userId, step, completed_at: now.toISOString(), skipped_reason: skip })), { onConflict: 'user_id,step', ignoreDuplicates: true });
      if (insErr) console.error('[checklist] step insert failed:', insErr.message);
    }

    // ── Pay what is owed ──
    const rows = fresh.length > 0 ? (await stepRows(admin, userId)) ?? existing : existing;
    await settle(admin, userId, rows, eligibility);
    const final = (await stepRows(admin, userId)) ?? rows;

    const done = new Set(final.map((r) => r.step).filter(isStepKey));
    const unseen = eligibility.kind === 'never' ? [] : final.filter((r) => r.grant_id && !r.seen_at);
    if (opts.markSeen && unseen.length > 0) {
      const { error: seenErr } = await admin.from('checklist_steps').update({ seen_at: now.toISOString() }).eq('user_id', userId).in('step', unseen.map((r) => r.step)).is('seen_at', null);
      if (seenErr) console.warn('[checklist] seen stamp failed:', seenErr.message);
    }
    return {
      visible: checklistVisible({ createdAt: p.created_at, doneCount: done.size, newlyPaid: unseen.length, now }),
      rewarded: eligibility.kind !== 'never',
      steps: CHECKLIST_STEPS.map((s) => ({ ...s, done: done.has(s.key) })),
      doneCount: done.size,
      reward: rewardLine(unseen.length, done.size),
    };
  } catch (err) {
    console.error('[checklist] sync failed:', (err as Error)?.message ?? err);
    return HIDDEN;
  }
}

/**
 * Grants the £1 for every recorded, unpaid step — only for an account the
 * welcome check cleared. An account that can never be paid has its steps
 * marked with why; one still waiting on the welcome check is left for a
 * later visit. A grant that fails is retried next time (same reference, so
 * it cannot land twice).
 */
async function settle(admin: Admin, userId: string, rows: StepRow[], eligibility: Eligibility): Promise<void> {
  const unpaid = rows.filter((r) => isStepKey(r.step) && !r.grant_id && !r.skipped_reason);
  if (unpaid.length === 0) return;
  if (eligibility.kind === 'never') {
    const { error } = await admin.from('checklist_steps').update({ skipped_reason: eligibility.reason }).eq('user_id', userId).in('step', unpaid.map((r) => r.step)).is('grant_id', null).is('skipped_reason', null);
    if (error) console.warn('[checklist] skip mark failed:', error.message);
    return;
  }
  if (eligibility.kind === 'pending') return;
  for (const r of unpaid) {
    const step = r.step as StepKey;
    try {
      const grantId = await grant(userId, 'welcome', STEP_REWARD_PENCE, { sourceRef: rewardRef(step, userId), description: `First-week checklist: ${CHECKLIST_STEPS.find((s) => s.key === step)?.label ?? step}` });
      if (!grantId) continue;
      const { error } = await admin.from('checklist_steps').update({ grant_id: grantId }).eq('user_id', userId).eq('step', step).is('grant_id', null);
      if (error) console.warn('[checklist] grant record failed:', error.message);
    } catch (err) {
      console.error('[checklist] grant failed for', step, (err as Error)?.message ?? err);
    }
  }
}

async function stepRows(admin: Admin, userId: string): Promise<StepRow[] | null> {
  const { data, error } = await admin.from('checklist_steps').select('step, grant_id, skipped_reason, seen_at').eq('user_id', userId);
  if (error) {
    console.warn('[checklist] steps read failed (schema behind?):', error.message);
    return null;
  }
  return (data ?? []) as StepRow[];
}

/**
 * Deals this member opened themselves. Not the daily pick's automatic open,
 * not an admin's free look, and — because a team's opens are all recorded
 * against the owner — not one a team member opened on the owner's account:
 * that open's charge carries the member's id, and it was not the owner who
 * did it.
 */
async function ownOpens(admin: Admin, userId: string): Promise<number> {
  const { data, error } = await admin
    .from('deal_opens')
    .select('transaction_id')
    .eq('user_id', userId)
    .eq('status', 'open')
    .not('verified_via', 'in', '(pick,admin)')
    .not('transaction_id', 'is', null)
    .limit(50);
  if (error) {
    console.warn('[checklist] opens read failed:', error.message);
    return 0;
  }
  const ids = ((data ?? []) as { transaction_id: number | string }[]).map((r) => r.transaction_id);
  if (ids.length === 0) return 0;
  const { count, error: txErr } = await admin.from('credit_transactions').select('id', { count: 'exact', head: true }).in('id', ids).is('metadata->>member_id', null);
  if (txErr) {
    console.warn('[checklist] open charges read failed:', txErr.message);
    return 0;
  }
  return count ?? 0;
}

/** What the member's own records show. A read that fails counts as not done — never as done. */
async function evidenceFor(admin: Admin, userId: string, marketGoals: unknown): Promise<Evidence> {
  const exists = async (label: string, q: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> => {
    const { count, error } = await q;
    if (error) {
      console.warn(`[checklist] ${label} read failed:`, error.message);
      return 0;
    }
    return count ?? 0;
  };
  const head = { count: 'exact' as const, head: true };
  const [keeps, opened, reported, dealShares, listingShares] = await Promise.all([
    exists('keeps', admin.from('deal_reactions').select('deal_id', head).eq('user_id', userId).eq('reaction', 'keep')),
    ownOpens(admin, userId),
    exists('reports', admin.from('saved_searches').select('id', head).eq('user_id', userId)),
    exists('deal shares', admin.from('deal_shares').select('token', head).eq('user_id', userId)),
    exists('listing shares', admin.from('checked_listings').select('id', head).eq('user_id', userId).not('share_token', 'is', null)),
  ]);
  return {
    // The same test the welcome questions use for "has answered" (onboarding/server.ts).
    goals: parseMarketGoals(marketGoals) !== null,
    keeps,
    opened: opened > 0,
    reported: reported > 0,
    shared: dealShares + listingShares > 0,
  };
}

