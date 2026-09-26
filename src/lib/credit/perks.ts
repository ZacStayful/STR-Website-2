/**
 * What each plan includes beyond credit. Mirrors `billing_plans.perks` so the
 * pricing page, the crons and the account page agree; the DB row wins when
 * present (see planPerks() in plans.ts), this is the fallback.
 *
 * Daily picks go to every enrolled member every day, free accounts included:
 * the sourcing cron (src/lib/listing/picks-run.ts) never reads the cadence.
 * The perk is kept so the pricing page states it and older DB rows still parse.
 */

export type SourcingCadence = 'weekly' | 'daily';

export interface PlanPerks {
  sourcingCadence: SourcingCadence;
  priorityRefresh: boolean;
  phoneSupport: boolean;
  quarterlyBriefing: boolean;
}

export type PlanCode = 'starter' | 'pro' | 'scale' | 'pro_annual';

export const FREE_PERKS: PlanPerks = { sourcingCadence: 'daily', priorityRefresh: false, phoneSupport: false, quarterlyBriefing: false };

export const PLAN_PERKS: Record<PlanCode, PlanPerks> = {
  starter: { sourcingCadence: 'daily', priorityRefresh: false, phoneSupport: false, quarterlyBriefing: false },
  pro: { sourcingCadence: 'daily', priorityRefresh: true, phoneSupport: false, quarterlyBriefing: false },
  scale: { sourcingCadence: 'daily', priorityRefresh: true, phoneSupport: true, quarterlyBriefing: true },
  pro_annual: { sourcingCadence: 'daily', priorityRefresh: true, phoneSupport: false, quarterlyBriefing: true },
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

/** The pick line as the pricing page states it. Derived from the perk, so it can never promise more than the row says. */
export function pickLine(cadence: SourcingCadence): string {
  return cadence === 'daily' ? 'One property pick a day by email' : 'One property pick a week by email';
}

export function perkLines(p: PlanPerks): string[] {
  const lines = [pickLine(p.sourcingCadence)];
  if (p.priorityRefresh) lines.push('Priority data refresh');
  if (p.phoneSupport) lines.push('Phone support');
  if (p.quarterlyBriefing) lines.push('Quarterly market briefing');
  return lines;
}
