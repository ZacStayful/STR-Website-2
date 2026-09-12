/**
 * What each plan includes beyond credit. Mirrors `billing_plans.perks` so the
 * pricing page, the crons and the account page agree; the DB row wins when
 * present (see planPerks() in plans.ts), this is the fallback.
 */

export type SourcingCadence = 'weekly' | 'daily';

export interface PlanPerks {
  sourcingCadence: SourcingCadence;
  priorityRefresh: boolean;
  phoneSupport: boolean;
  quarterlyBriefing: boolean;
}

export type PlanCode = 'starter' | 'pro' | 'scale' | 'pro_annual';

export const FREE_PERKS: PlanPerks = { sourcingCadence: 'weekly', priorityRefresh: false, phoneSupport: false, quarterlyBriefing: false };

export const PLAN_PERKS: Record<PlanCode, PlanPerks> = {
  starter: { sourcingCadence: 'weekly', priorityRefresh: false, phoneSupport: false, quarterlyBriefing: false },
  pro: { sourcingCadence: 'weekly', priorityRefresh: true, phoneSupport: false, quarterlyBriefing: false },
  scale: { sourcingCadence: 'daily', priorityRefresh: true, phoneSupport: true, quarterlyBriefing: true },
  pro_annual: { sourcingCadence: 'weekly', priorityRefresh: true, phoneSupport: false, quarterlyBriefing: true },
};

export function perksFor(planCode: string | null | undefined, fromDb?: Partial<PlanPerks> | null): PlanPerks {
  const base = planCode && planCode in PLAN_PERKS ? PLAN_PERKS[planCode as PlanCode] : FREE_PERKS;
  if (!fromDb) return base;
  return {
    sourcingCadence: fromDb.sourcingCadence === 'daily' ? 'daily' : fromDb.sourcingCadence === 'weekly' ? 'weekly' : base.sourcingCadence,
    priorityRefresh: typeof fromDb.priorityRefresh === 'boolean' ? fromDb.priorityRefresh : base.priorityRefresh,
    phoneSupport: typeof fromDb.phoneSupport === 'boolean' ? fromDb.phoneSupport : base.phoneSupport,
    quarterlyBriefing: typeof fromDb.quarterlyBriefing === 'boolean' ? fromDb.quarterlyBriefing : base.quarterlyBriefing,
  };
}

/** Whether a member on this cadence gets a sourcing run today (weekly = Mondays, UTC). */
export function sourcingRunsToday(cadence: SourcingCadence, now: Date = new Date()): boolean {
  return cadence === 'daily' || now.getUTCDay() === 1;
}

export function perkLines(p: PlanPerks): string[] {
  const lines = [p.sourcingCadence === 'daily' ? 'Daily deal-sourcing digest' : 'Weekly deal-sourcing digest'];
  if (p.priorityRefresh) lines.push('Priority data refresh');
  if (p.phoneSupport) lines.push('Phone support');
  if (p.quarterlyBriefing) lines.push('Quarterly market briefing');
  return lines;
}
