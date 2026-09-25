import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { ACCESS_COLUMNS, isPaused, isSubscriber } from '../access';
import { sendEmail } from '../email/send';
import { inviteEmail, memberJoinedEmail, joinBlockedByCreditEmail } from '../email/team';
import { retentionDate } from '../leads/retention';
import { siteUrl } from '../url';
import { inviteExpiry, joinBlocker, normaliseEmail, periodEnd, JOIN_BLOCKER_COPY, type JoinBlocker } from './rules';
import { chargeSeat } from './seats';
import { personName, teamName } from './index';

/**
 * Invitations. The emailed token is the credential, so only its sha256 is
 * stored — the same shape as API keys (src/lib/api/keys.ts). A resend mints
 * a new token and withdraws the old one: at most one open invite per owner
 * per address (a partial unique index backs that up).
 */

const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function joinUrl(token: string): string {
  return `${siteUrl()}/team/join?token=${encodeURIComponent(token)}`;
}

export interface InviteRow {
  id: string;
  owner_id: string;
  email: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

const INVITE_COLUMNS = 'id, owner_id, email, created_at, expires_at, accepted_at, revoked_at';

export async function inviteByToken(token: string): Promise<InviteRow | null> {
  if (!TOKEN.test(token) || !hasServiceRole()) return null;
  const { data } = await createAdminClient()
    .from('team_invites')
    .select(INVITE_COLUMNS)
    .eq('token_hash', hashToken(token))
    .maybeSingle();
  return (data as InviteRow | null) ?? null;
}

/** Sends (or re-sends) an invite. Returns an error message, or null when sent. */
export async function createInvite(ownerId: string, rawEmail: unknown): Promise<string | null> {
  if (!hasServiceRole()) return 'Invites are not available just now.';
  const email = normaliseEmail(rawEmail);
  if (!email) return 'Enter a valid email address.';
  const admin = createAdminClient();

  const { data: owner } = await admin.from('profiles').select('full_name, email').eq('id', ownerId).maybeSingle();
  if ((owner?.email as string | null)?.trim().toLowerCase() === email) return 'That is your own address.';

  // Already in this team? Then there is nothing to invite them to.
  const { data: existing } = await admin.from('profiles').select('id').ilike('email', email.replace(/[%_\\]/g, '\\$&')).limit(1);
  const existingId = (existing?.[0] as { id: string } | undefined)?.id;
  if (existingId) {
    const { data: m } = await admin.from('team_members').select('owner_id').eq('member_id', existingId).maybeSingle();
    if ((m as { owner_id: string } | null)?.owner_id === ownerId) return 'They are already on your team.';
  }

  // Withdraw any open invite to the same address, then mint a fresh one.
  await admin
    .from('team_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('owner_id', ownerId)
    .eq('email', email)
    .is('accepted_at', null)
    .is('revoked_at', null);

  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = inviteExpiry(now);
  const { error } = await admin.from('team_invites').insert({
    owner_id: ownerId,
    email,
    token_hash: hashToken(token),
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
  });
  if (error) {
    console.error('[team] invite insert failed:', error.message);
    return 'We could not create that invite. Please try again.';
  }

  const mail = inviteEmail({
    teamName: await teamName(ownerId),
    inviterName: personName(owner as { full_name: string | null; email: string | null } | null),
    url: joinUrl(token),
    expiresOn: retentionDate(expires),
  });
  const sent = await sendEmail({ to: email, subject: mail.subject, html: mail.html, text: mail.text });
  if (!sent.sent) return 'The invite was saved but the email could not be sent. Try resending it.';
  return null;
}

export async function revokeInvite(ownerId: string, inviteId: string): Promise<boolean> {
  if (!hasServiceRole() || !/^[0-9a-f-]{36}$/i.test(inviteId)) return false;
  const { data } = await createAdminClient()
    .from('team_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('owner_id', ownerId)
    .eq('id', inviteId)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .select('id');
  return (data ?? []).length > 0;
}

/** Why this person cannot join with this token, or null when they can. */
export async function joinCheck(user: { id: string; email: string | null }, token: string): Promise<{ invite: InviteRow | null; blocker: JoinBlocker | null }> {
  const invite = await inviteByToken(token);
  if (!invite || !hasServiceRole()) return { invite, blocker: 'invalid' };
  const admin = createAdminClient();
  const [{ data: m }, { count: funnels }, { count: members }, { data: profile }] = await Promise.all([
    admin.from('team_members').select('member_id').eq('member_id', user.id).maybeSingle(),
    admin.from('funnels').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    admin.from('team_members').select('member_id', { count: 'exact', head: true }).eq('owner_id', user.id),
    admin.from('profiles').select(ACCESS_COLUMNS).eq('id', user.id).maybeSingle(),
  ]);
  const p = (profile ?? {}) as Parameters<typeof isSubscriber>[0];
  const blocker = joinBlocker({
    invite: { expiresAt: invite.expires_at, acceptedAt: invite.accepted_at, revokedAt: invite.revoked_at, email: invite.email, ownerId: invite.owner_id },
    userId: user.id,
    userEmail: user.email,
    isMember: Boolean(m),
    ownsTeamData: (funnels ?? 0) > 0 || (members ?? 0) > 0,
    hasSubscription: isSubscriber(p) || isPaused(p),
  });
  return { invite, blocker };
}

export type AcceptResult = { ok: true; teamName: string } | { ok: false; error: string };

/**
 * Accepts an invite for the signed-in person.
 *
 * Order matters. The membership row goes in first — its primary key is the
 * one-team-per-login guard, so a double-click or a second tab cannot join
 * twice. Then the first seat is charged; if the owner cannot cover it the
 * membership is taken out again and the owner is told why their colleague
 * could not join. Only then is the invite marked used.
 */
export async function acceptInvite(user: { id: string; email: string | null }, token: string): Promise<AcceptResult> {
  const { invite, blocker } = await joinCheck(user, token);
  if (blocker || !invite) return { ok: false, error: JOIN_BLOCKER_COPY[blocker ?? 'invalid'] };
  const admin = createAdminClient();
  const now = new Date();

  const { data: profile } = await admin.from('profiles').select('full_name, email, created_at').eq('id', user.id).maybeSingle();
  const createdAt = (profile as { created_at?: string } | null)?.created_at;
  // A login made after the invite went out exists for this team, and is
  // deleted if the member is removed. An older account only ever leaves.
  const createdViaInvite = Boolean(createdAt && new Date(createdAt).getTime() >= new Date(invite.created_at).getTime());

  const { error: joinErr } = await admin.from('team_members').insert({
    member_id: user.id,
    owner_id: invite.owner_id,
    created_via_invite: createdViaInvite,
    joined_at: now.toISOString(),
    seat_paid_until: periodEnd(now).toISOString(),
  });
  if (joinErr) {
    if (joinErr.code === '23505') return { ok: false, error: JOIN_BLOCKER_COPY.already_member };
    console.error('[team] join insert failed:', joinErr.message);
    return { ok: false, error: 'We could not add you to the team just now. Please try again.' };
  }

  const memberName = personName(profile as { full_name: string | null; email: string | null } | null);
  const charge = await chargeSeat({ ownerId: invite.owner_id, memberId: user.id, memberName, periodStart: now });
  if (charge !== 'charged' && charge !== 'already_paid') {
    await admin.from('team_members').delete().eq('member_id', user.id).eq('owner_id', invite.owner_id);
    const { data: owner } = await admin.from('profiles').select('email').eq('id', invite.owner_id).maybeSingle();
    if (charge === 'insufficient') {
      const ownerEmail = (owner as { email: string | null } | null)?.email;
      if (ownerEmail) {
        const mail = joinBlockedByCreditEmail({ memberEmail: invite.email });
        await sendEmail({ to: ownerEmail, subject: mail.subject, html: mail.html, text: mail.text });
      }
      return { ok: false, error: 'The team’s balance doesn’t cover your seat yet. We’ve let the account owner know — try the link again once they’ve topped up.' };
    }
    return { ok: false, error: 'We could not add you to the team just now. Please try again.' };
  }

  await admin.from('team_invites').update({ accepted_at: now.toISOString() }).eq('id', invite.id).is('accepted_at', null);
  // A member spends the team's credit, not their own: no welcome credit.
  await admin
    .from('profiles')
    .update({ welcome_checked_at: now.toISOString(), welcome_withheld_reason: 'team_member' })
    .eq('id', user.id)
    .is('welcome_checked_at', null);

  const name = await teamName(invite.owner_id);
  const { data: owner } = await admin.from('profiles').select('email').eq('id', invite.owner_id).maybeSingle();
  const ownerEmail = (owner as { email: string | null } | null)?.email;
  if (ownerEmail) {
    const mail = memberJoinedEmail({ memberName, nextChargeOn: retentionDate(periodEnd(now)) });
    await sendEmail({ to: ownerEmail, subject: mail.subject, html: mail.html, text: mail.text });
  }
  return { ok: true, teamName: name };
}
