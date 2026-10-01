/**
 * The welcome decision at a member's first signed-in visit (Batch 21, G3):
 * pure, so the order that decides who gets money is tested. The facts are
 * gathered by src/lib/credit/welcome.ts, which only writes what this says.
 *
 *   team_member          a team seat spends the team's credit: stamped, no credit
 *   open_invite          decided later, when they join or the invite lapses: nothing written
 *   disposable_email     withheld (stamped), as is
 *   mobile_already_used  withheld (stamped): the number already collected credit
 *   postpone             the starter-pack cutover could not be read: nothing
 *                        written, the next sign-in decides
 *   pack                 a pack account (created at or after the cutover), or
 *                        one with a pack bought or being paid for (B45):
 *                        stamped, offered the pack instead
 *   grant                the £20 welcome credit
 */
export interface WelcomeFacts {
  teamMember: boolean;
  openInvite: boolean;
  disposableEmail: boolean;
  mobileAlreadyUsed: boolean;
  /** billing_settings.starter_pack_from was read (set or empty); false when the read failed. */
  cutoverKnown: boolean;
  /** isPackAccount(created_at, the cutover). */
  packAccount: boolean;
  /** A reserved or granted starter_pack_purchases row for this account. */
  hasPack: boolean;
}

export type WelcomeOutcome = 'team_member' | 'open_invite' | 'disposable_email' | 'mobile_already_used' | 'postpone' | 'pack' | 'grant';

export function welcomeOutcome(f: WelcomeFacts): WelcomeOutcome {
  if (f.teamMember) return 'team_member';
  if (f.openInvite) return 'open_invite';
  if (f.disposableEmail) return 'disposable_email';
  if (f.mobileAlreadyUsed) return 'mobile_already_used';
  if (!f.cutoverKnown) return 'postpone';
  if (f.packAccount || f.hasPack) return 'pack';
  return 'grant';
}

/** The withheld reason stamped on the profile for an outcome, or null when nothing is withheld. */
export function withheldReason(outcome: WelcomeOutcome): 'team_member' | 'disposable_email' | 'mobile_already_used' | null {
  return outcome === 'team_member' || outcome === 'disposable_email' || outcome === 'mobile_already_used' ? outcome : null;
}
