/**
 * Whether the welcome questions (/welcome) are due for a member.
 *
 * They are due until the member has answered them (market_goals is set) or
 * has tapped "Skip for now" MAX_WELCOME_SKIPS times. Team members never see
 * them: they were invited to work someone else's account. Closing the tab
 * mid-way counts as nothing, so the screen simply comes back next sign-in.
 *
 * Pure, so the rule is tested rather than trusted.
 */
export const MAX_WELCOME_SKIPS = 3;

export type TeamRole = 'owner' | 'member';

export interface WelcomeState {
  hasGoals: boolean;
  skips: number;
  teamRole: TeamRole;
}

/** A stored skip count, tolerant of null / strings / junk (all read as 0). */
export function skipsFrom(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw) : raw;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function welcomeDue(s: WelcomeState): boolean {
  if (s.hasGoals) return false;
  if (s.teamRole === 'member') return false;
  return skipsFrom(s.skips) < MAX_WELCOME_SKIPS;
}
