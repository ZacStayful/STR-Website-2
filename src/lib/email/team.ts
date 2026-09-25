/**
 * Team emails: invites, joins, seat suspensions and removals.
 *
 * Pure: these build the message, the caller sends it. Same shape as
 * funnel-alerts.ts and lead-retention.ts, free of `server-only` so it runs
 * under `node --test`. Names here are typed by customers, so every one is
 * escaped.
 */
import { escapeHtml as esc } from './escape.ts'
import { siteUrl } from '../url.ts'

export interface Email {
  subject: string
  html: string
  text: string
}

function wrap(heading: string, paragraphs: string[], cta: { label: string; href: string } | null): string {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#2e3d2b;max-width:520px;margin:0 auto;padding:24px">
  <h1 style="font-size:20px;margin:0 0 16px">${esc(heading)}</h1>
  ${paragraphs.map((p) => `<p style="margin:0 0 16px">${esc(p)}</p>`).join('\n  ')}
  ${cta ? `<p style="margin:24px 0 0"><a href="${cta.href}" style="display:inline-block;background:#5d8156;color:#fff;text-decoration:none;padding:10px 20px;border-radius:999px;font-weight:600">${esc(cta.label)}</a></p>` : ''}
  <p style="margin:24px 0 0;font-size:13px;color:#7a8274">Stayful Intelligence</p>
</div>`
}

function build(subject: string, paragraphs: string[], cta: { label: string; href: string } | null): Email {
  return {
    subject,
    html: wrap(subject, paragraphs, cta),
    text: `${paragraphs.join('\n\n')}${cta ? `\n\n${cta.label}: ${cta.href}` : ''}\n`,
  }
}

/** To the invited person. `url` carries the one-time token. */
export function inviteEmail(input: { teamName: string; inviterName: string; url: string; expiresOn: string }): Email {
  return build(
    `${input.inviterName} invited you to join ${input.teamName} on Stayful`,
    [
      `${input.inviterName} has invited you to join ${input.teamName} on Stayful Intelligence, where the team keeps its property enquiries, income reports and analysis.`,
      `The link works until ${input.expiresOn}. If you don't have a Stayful login yet, you'll create one with this email address.`,
      'If you weren’t expecting this, you can ignore it.',
    ],
    { label: 'Join the team', href: input.url },
  )
}

/** To the owner, when an invite is accepted and the first seat charged. */
export function memberJoinedEmail(input: { memberName: string; nextChargeOn: string }): Email {
  return build(
    `${input.memberName} joined your team`,
    [
      `${input.memberName} accepted your invite and now has access to your team's leads.`,
      `Their seat costs £10 a month from your credit. The first £10 has been taken; the next is due on ${input.nextChargeOn}.`,
    ],
    { label: 'Manage your team', href: `${siteUrl()}/account/team` },
  )
}

/** To the owner, when someone tried to accept but the first seat could not be paid. */
export function joinBlockedByCreditEmail(input: { memberEmail: string }): Email {
  return build(
    `${input.memberEmail} couldn't join — top up to add them`,
    [
      `${input.memberEmail} tried to accept your team invite, but your balance doesn't cover the £10 seat.`,
      'Top up, then ask them to open the invite link again. It still works until it expires.',
    ],
    { label: 'Top up', href: `${siteUrl()}/account/billing` },
  )
}

/** A renewal failed. `to` decides the wording; both get one. */
export function seatSuspendedEmail(input: { to: 'owner' | 'member'; memberName: string; teamName: string }): Email {
  if (input.to === 'owner') {
    return build(
      `${input.memberName}'s seat is paused — your balance is too low`,
      [
        `We couldn't take the £10 monthly seat for ${input.memberName}, so their access to your team is paused.`,
        'Top up and it comes back automatically — nothing else to do.',
      ],
      { label: 'Top up', href: `${siteUrl()}/account/billing` },
    )
  }
  return build(
    `Your access to ${input.teamName} is paused`,
    [
      `Your seat on ${input.teamName} couldn't be renewed because the team's balance is too low.`,
      'It comes back automatically as soon as the account owner tops up. You may want to let them know.',
    ],
    null,
  )
}

export function seatRestoredEmail(input: { to: 'owner' | 'member'; memberName: string; teamName: string }): Email {
  if (input.to === 'owner') {
    return build(
      `${input.memberName}'s seat is active again`,
      [`Your top-up covered ${input.memberName}'s £10 seat, so their access to your team is back.`],
      { label: 'Manage your team', href: `${siteUrl()}/account/team` },
    )
  }
  return build(
    `Your access to ${input.teamName} is back`,
    [`Your seat on ${input.teamName} has been renewed. Everything is where you left it.`],
    { label: 'Open Leads', href: `${siteUrl()}/leads` },
  )
}

/**
 * A member left or was removed. `loginDeleted` says whether their login went
 * with it — true for a login created only to join the team.
 */
export function memberRemovedEmail(input: { to: 'owner' | 'member'; memberName: string; teamName: string; by: 'owner' | 'member'; loginDeleted: boolean }): Email {
  if (input.to === 'owner') {
    const lead = input.by === 'member' ? `${input.memberName} left your team.` : `You removed ${input.memberName} from your team.`
    return build(
      input.by === 'member' ? `${input.memberName} left your team` : `${input.memberName} was removed from your team`,
      [
        lead,
        `No further seat charges will be taken for them.${input.loginDeleted ? ' Their Stayful login, created for your team, has been deleted.' : ''}`,
        'Reports they ran for the team stay in your team’s reports.',
      ],
      { label: 'Manage your team', href: `${siteUrl()}/account/team` },
    )
  }
  return build(
    input.by === 'member' ? `You left ${input.teamName}` : `You were removed from ${input.teamName}`,
    [
      input.by === 'member' ? `You've left ${input.teamName} on Stayful.` : `You no longer have access to ${input.teamName} on Stayful.`,
      input.loginDeleted
        ? 'Your login was created for this team, so it has been deleted.'
        : 'Your own Stayful account is unchanged and you can keep using it.',
    ],
    null,
  )
}
