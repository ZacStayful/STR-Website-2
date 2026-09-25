/**
 * The rules of a team, as pure functions so they run under `node --test`.
 *
 * A team is an owner and the colleagues they invite. Members use the owner's
 * funnels, leads and — from the whole-app change — the owner's credit. Each
 * member's seat is a flat £10 of the owner's displayed credit, charged when
 * they join and every 30 days after. An unpaid renewal suspends the seat
 * until the owner's balance covers it again.
 */

const DAY_MS = 86_400_000;

/** £10 of displayed credit (debited with credit_debit_face, not at spend rates). */
export const SEAT_PRICE_PENCE = 1000;
export const SEAT_PERIOD_DAYS = 30;
/** How long an emailed invite link works. */
export const INVITE_DAYS = 7;

export type TeamRole = 'owner' | 'member';

export function periodEnd(start: Date | string): Date {
  const s = start instanceof Date ? start : new Date(start);
  return new Date(s.getTime() + SEAT_PERIOD_DAYS * DAY_MS);
}

export function inviteExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + INVITE_DAYS * DAY_MS);
}

/** True when the seat's paid period has run out and a renewal is owed. */
export function seatDue(paidUntil: Date | string, now: Date = new Date()): boolean {
  const t = (paidUntil instanceof Date ? paidUntil : new Date(paidUntil)).getTime();
  return Number.isFinite(t) && t <= now.getTime();
}

export function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  // Deliberately loose: the invite email is the real test of an address.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254 ? e : null;
}

/** Everything that decides whether a signed-in person may accept an invite. */
export interface JoinFacts {
  invite: { expiresAt: string; acceptedAt: string | null; revokedAt: string | null; email: string; ownerId: string } | null;
  userId: string;
  userEmail: string | null;
  /** Already a member of some team (this one or another). */
  isMember: boolean;
  /** Owns funnels or has members of their own. */
  ownsTeamData: boolean;
  /** Pays for a subscription of their own. */
  hasSubscription: boolean;
}

export type JoinBlocker =
  | 'invalid'
  | 'expired'
  | 'used'
  | 'wrong_email'
  | 'own_team'
  | 'already_member'
  | 'owns_data'
  | 'subscribed';

export const JOIN_BLOCKER_COPY: Record<JoinBlocker, string> = {
  invalid: 'This invite link is not valid. Ask for a new one.',
  expired: 'This invite has expired. Ask the person who invited you to send a new one.',
  used: 'This invite has already been used or withdrawn.',
  wrong_email: 'This invite was sent to a different email address. Sign in with that address to accept it.',
  own_team: 'You cannot join your own team.',
  already_member: 'You are already a member of a team. Leave it first to join another.',
  owns_data: 'This account has its own funnels or team members, so it cannot join another team. Use a different email address.',
  subscribed: 'This account has its own subscription. Cancel it first, or join with a different email address.',
};

/** The first reason this person cannot join, or null when they can. */
export function joinBlocker(f: JoinFacts, now: Date = new Date()): JoinBlocker | null {
  const inv = f.invite;
  if (!inv) return 'invalid';
  if (inv.acceptedAt || inv.revokedAt) return 'used';
  if (new Date(inv.expiresAt).getTime() <= now.getTime()) return 'expired';
  if (inv.ownerId === f.userId) return 'own_team';
  if (normaliseEmail(f.userEmail) !== inv.email) return 'wrong_email';
  if (f.isMember) return 'already_member';
  if (f.ownsTeamData) return 'owns_data';
  if (f.hasSubscription) return 'subscribed';
  return null;
}

/** What each role may do. The UI hides what a role cannot; the server refuses it. */
export type Capability =
  | 'leads'          // search, view, stage, export, archive, restore, push to CRM
  | 'funnels'        // create, brand, rules, pause, rotate
  | 'integrations'   // CRM connections
  | 'api_keys'
  | 'billing'        // top-ups, plans, auto top-up
  | 'team';          // invite, remove, see seat charges

const MEMBER_CAN = new Set<Capability>(['leads']);

export function can(role: TeamRole, what: Capability): boolean {
  return role === 'owner' || MEMBER_CAN.has(what);
}
