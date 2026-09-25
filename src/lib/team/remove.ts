import 'server-only';

import { createAdminClient, hasServiceRole } from '../supabase/admin';
import { sendEmail } from '../email/send';
import { memberRemovedEmail } from '../email/team';
import { personName, profileNames, teamName } from './index';

/**
 * Takes a member off a team — the owner removing them, or them leaving.
 *
 * Seat charges stop with the membership row (the cron only renews rows that
 * exist). No refund for the rest of the period.
 *
 * A login created to accept the invite exists only for this team and is
 * deleted with it; `profiles` and everything personal cascade from
 * auth.users. An account that existed before the invite just leaves, and
 * keeps its own reports and credit.
 */
export async function removeMember(input: { ownerId: string; memberId: string; by: 'owner' | 'member' }): Promise<{ ok: boolean; loginDeleted: boolean; error?: string }> {
  if (!hasServiceRole()) return { ok: false, loginDeleted: false, error: 'Not available just now.' };
  const admin = createAdminClient();

  const { data: row } = await admin
    .from('team_members')
    .select('member_id, created_via_invite')
    .eq('owner_id', input.ownerId)
    .eq('member_id', input.memberId)
    .maybeSingle();
  if (!row) return { ok: false, loginDeleted: false, error: 'They are not on this team.' };
  const createdViaInvite = Boolean((row as { created_via_invite: boolean }).created_via_invite);

  // Read names and addresses first: after a deletion there is nobody to ask.
  const [names, team] = await Promise.all([profileNames([input.ownerId, input.memberId]), teamName(input.ownerId)]);
  const memberName = personName(names.get(input.memberId));

  const { error } = await admin.from('team_members').delete().eq('owner_id', input.ownerId).eq('member_id', input.memberId);
  if (error) {
    console.error('[team] remove failed:', error.message);
    return { ok: false, loginDeleted: false, error: 'We could not do that just now. Please try again.' };
  }

  let loginDeleted = false;
  if (createdViaInvite) {
    // Reports they ran for the team were paid for by the team: hand them to
    // the owner first, or they would cascade away with the login.
    const { error: moveErr } = await admin
      .from('saved_searches')
      .update({ user_id: input.ownerId })
      .eq('user_id', input.memberId)
      .eq('owner_id', input.ownerId);
    if (moveErr) {
      // Keep the login rather than lose the team's reports. They are off the
      // team either way; the emails below say the login was kept.
      console.error('[team] report hand-over failed; login kept:', moveErr.message);
    } else {
      const { error: delErr } = await admin.auth.admin.deleteUser(input.memberId);
      if (delErr) console.error('[team] login delete failed:', delErr.message);
      else loginDeleted = true;
    }
  }

  for (const to of ['owner', 'member'] as const) {
    const address = names.get(to === 'owner' ? input.ownerId : input.memberId)?.email;
    if (!address) continue;
    const mail = memberRemovedEmail({ to, memberName, teamName: team, by: input.by, loginDeleted });
    const sent = await sendEmail({ to: address, subject: mail.subject, html: mail.html, text: mail.text });
    if (!sent.sent) console.warn('[team] removal email not sent:', sent.reason);
  }
  return { ok: true, loginDeleted };
}
